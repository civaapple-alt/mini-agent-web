"""Gateway-owned App Server resource sampling and safe Session parking."""

from __future__ import annotations

import asyncio
import logging
import math
import os
import time
from array import array
from collections import OrderedDict
from typing import Any
from urllib.parse import quote

import psutil
from fastapi import WebSocket

SAMPLE_INTERVAL_SECONDS = 2.0
HISTORY_SECONDS = 10 * 60
HISTORY_CAPACITY = HISTORY_SECONDS // int(SAMPLE_INTERVAL_SECONDS)
VIEWER_LEASE_SECONDS = 45.0
IDLE_PARK_SECONDS = 10 * 60.0
PARK_SWEEP_SECONDS = 15.0
MAX_PROCESS_HISTORIES = 512
logger = logging.getLogger("mini_agent.server")

_ACTIVE_RUNTIME_PHASES = frozenset(
    {
        "starting_turn",
        "model",
        "tool",
        "waiting_approval",
        "waiting_for_user_input",
        "stopping",
        "compaction",
        "persisting",
        "goal_verification",
        "goal_continuation_queued",
        "resuming",
    }
)
_ACTIVE_CHILD_STATUSES = frozenset(
    {
        "queued",
        "running",
        "awaiting_approval",
        "awaiting_user_input",
        "in_progress",
        "pausing",
        "cancelling",
    }
)
_ACTIVE_BACKGROUND_STATES = frozenset({"starting", "running", "stopping"})
_HISTORY_FIELDS = (
    "timestamp",
    "cpu_percent",
    "rss_bytes",
    "cpu_time_seconds",
    "requests_per_second",
    "request_bytes_per_second",
    "response_bytes_per_second",
    "errors_per_second",
    "latency_p50_ms",
    "latency_p95_ms",
    "pending_requests",
)


class _MetricRing:
    """Fixed-size numeric ring; process identity is stored outside each sample."""

    def __init__(self, capacity: int = HISTORY_CAPACITY) -> None:
        self.capacity = capacity
        self.width = len(_HISTORY_FIELDS)
        self.values = array("d", [math.nan]) * (capacity * self.width)
        self.next_index = 0
        self.count = 0

    def append(self, sample: tuple[float, ...]) -> None:
        start = self.next_index * self.width
        self.values[start : start + self.width] = array("d", sample)
        self.next_index = (self.next_index + 1) % self.capacity
        self.count = min(self.count + 1, self.capacity)

    def records(self) -> list[dict[str, float | None]]:
        first = (self.next_index - self.count) % self.capacity
        cutoff = time.time() - HISTORY_SECONDS
        result: list[dict[str, float | None]] = []
        for offset in range(self.count):
            index = (first + offset) % self.capacity
            start = index * self.width
            values = self.values[start : start + self.width]
            if not math.isfinite(values[0]) or values[0] < cutoff:
                continue
            result.append(
                {
                    name: value if math.isfinite(value) else None
                    for name, value in zip(_HISTORY_FIELDS, values, strict=True)
                }
            )
        return result


class RuntimeResourceManager:
    """Observe managed subprocesses and park only verified-idle Sessions."""

    def __init__(self, owner: Any) -> None:
        self.owner = owner
        self._residency_task: asyncio.Task[None] | None = None
        self._sample_lock = asyncio.Lock()
        self._last_sample = 0.0
        self._latest_by_process: dict[str, dict[str, Any]] = {}
        self._histories: OrderedDict[str, _MetricRing] = OrderedDict()
        self._history_aliases: OrderedDict[str, str] = OrderedDict()
        self._previous_cpu: dict[str, tuple[float, float]] = {}
        self._previous_rpc: dict[str, tuple[int, int, int, int]] = {}
        self._viewer_leases: dict[WebSocket, tuple[str, str, float]] = {}
        self._idle_since: dict[tuple[str, str], float] = {}
        self._retry_after: dict[tuple[str, str], float] = {}
        self._parking: set[tuple[str, str]] = set()
        self._states: dict[tuple[str, str], str] = {}
        self._state_details: dict[tuple[str, str], list[str]] = {}
        self._shutting_down = False

    async def start(self) -> None:
        self._shutting_down = False
        if self._residency_task is None or self._residency_task.done():
            self._residency_task = asyncio.create_task(self._residency_loop())

    async def stop(self) -> None:
        self._shutting_down = True
        tasks = [self._residency_task] if self._residency_task else []
        self._residency_task = None
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def on_client_activated(self, project_id: str, thread_id: str) -> None:
        key = (project_id, thread_id)
        self._idle_since.setdefault(key, time.monotonic())
        self._states.setdefault(key, "loaded")
        self._last_sample = 0.0

    def is_parking(self, project_id: str, thread_id: str) -> bool:
        return (project_id, thread_id) in self._parking

    def update_viewer(
        self,
        websocket: WebSocket,
        project_id: str | None,
        thread_id: str | None,
        visible: bool,
    ) -> None:
        self.release_viewer(websocket)
        if not visible or not project_id or not thread_id:
            return
        key = (str(project_id), str(thread_id))
        self._viewer_leases[websocket] = (*key, time.monotonic())
        self._idle_since.pop(key, None)
        self._states[key] = "loaded"
        self._state_details.pop(key, None)

    def release_viewer(self, websocket: WebSocket) -> None:
        lease = self._viewer_leases.pop(websocket, None)
        if not lease:
            return
        key = (lease[0], lease[1])
        if self._viewer_count(key, time.monotonic()) == 0:
            self._idle_since[key] = time.monotonic()

    def _viewer_count(self, key: tuple[str, str], now: float) -> int:
        stale = [
            websocket
            for websocket, lease in self._viewer_leases.items()
            if now - lease[2] > VIEWER_LEASE_SECONDS
        ]
        for websocket in stale:
            lease = self._viewer_leases.pop(websocket, None)
            if lease and (lease[0], lease[1]) == key:
                self._idle_since[key] = now
        return sum(
            1
            for project_id, thread_id, expires in self._viewer_leases.values()
            if (project_id, thread_id) == key and now - expires <= VIEWER_LEASE_SECONDS
        )

    async def _sample_once(self) -> None:
        async with self._sample_lock:
            now = time.monotonic()
            if self._last_sample and now - self._last_sample < 0.25:
                return
            if (
                self._last_sample
                and now - self._last_sample > SAMPLE_INTERVAL_SECONDS * 1.5
            ):
                self._previous_cpu.clear()
                self._previous_rpc.clear()
            descriptors = self._process_descriptors()
            cpu_count = max(1, psutil.cpu_count() or 1)
            updated: dict[str, dict[str, Any]] = {}
            for descriptor in descriptors:
                pid = descriptor.get("pid")
                if not isinstance(pid, int) or pid <= 0:
                    updated[descriptor["process_key"]] = descriptor
                    continue
                key = descriptor["process_key"]
                try:
                    process = psutil.Process(pid)
                    create_time = process.create_time()
                    if (
                        descriptor.get("create_time") is not None
                        and abs(create_time - float(descriptor["create_time"])) > 1.0
                    ):
                        descriptor["process_key"] = self._process_key(
                            descriptor.get("project_id"),
                            descriptor.get("thread_id"),
                            pid,
                            create_time,
                        )
                        key = descriptor["process_key"]
                    cpu_times = process.cpu_times()
                    cpu_time = float(cpu_times.user + cpu_times.system)
                    previous = self._previous_cpu.get(key)
                    cpu_percent = None
                    if previous:
                        previous_cpu, previous_at = previous
                        elapsed = max(0.001, now - previous_at)
                        cpu_percent = min(
                            100.0,
                            max(
                                0.0,
                                (cpu_time - previous_cpu) / elapsed / cpu_count * 100,
                            ),
                        )
                    self._previous_cpu[key] = (cpu_time, now)
                    descriptor.update(
                        {
                            "pid": process.pid,
                            "ppid": process.ppid(),
                            "create_time": create_time,
                            "uptime_seconds": max(0.0, time.time() - create_time),
                            "cpu_time_seconds": cpu_time,
                            "cpu_percent": cpu_percent,
                            "rss_bytes": process.memory_info().rss,
                        }
                    )
                    rpc = descriptor.get("rpc") or {}
                    totals = self._rpc_totals(rpc)
                    previous_rpc = self._previous_rpc.get(key)
                    sample_elapsed = (
                        max(0.001, now - previous[1])
                        if previous
                        else SAMPLE_INTERVAL_SECONDS
                    )
                    if previous_rpc:
                        delta = tuple(
                            max(0, current - old)
                            for current, old in zip(
                                totals[:4], previous_rpc, strict=True
                            )
                        )
                    else:
                        delta = (0, 0, 0, 0)
                    self._previous_rpc[key] = totals[:4]
                    sample = (
                        time.time(),
                        cpu_percent if cpu_percent is not None else math.nan,
                        float(descriptor["rss_bytes"]),
                        cpu_time,
                        delta[0] / sample_elapsed,
                        delta[1] / sample_elapsed,
                        delta[2] / sample_elapsed,
                        delta[3] / sample_elapsed,
                        totals[4] if totals[4] is not None else math.nan,
                        totals[5] if totals[5] is not None else math.nan,
                        float(rpc.get("pending_requests") or 0),
                    )
                    ring = self._histories.get(key)
                    if ring is None:
                        ring = _MetricRing()
                        self._histories[key] = ring
                    ring.append(sample)
                    self._histories.move_to_end(key)
                    if descriptor.get("project_id") and descriptor.get("thread_id"):
                        alias = self._session_process_key(
                            descriptor["project_id"], descriptor["thread_id"]
                        )
                        self._history_aliases[alias] = key
                        self._history_aliases.move_to_end(alias)
                    descriptor.update(
                        {
                            "requests_per_second": sample[4],
                            "bytes_per_second": sample[5] + sample[6],
                            "errors_per_second": sample[7],
                        }
                    )
                except (
                    psutil.NoSuchProcess,
                    psutil.AccessDenied,
                    psutil.ZombieProcess,
                    OSError,
                ):
                    descriptor.update(
                        {
                            "pid": None,
                            "cpu_percent": None,
                            "rss_bytes": None,
                            "process_error": "unavailable",
                        }
                    )
                updated[descriptor["process_key"]] = descriptor
            self._latest_by_process = updated
            self._last_sample = now
            while len(self._histories) > MAX_PROCESS_HISTORIES:
                old_key, _ring = self._histories.popitem(last=False)
                self._previous_cpu.pop(old_key, None)
                self._previous_rpc.pop(old_key, None)
                for alias, process_key in list(self._history_aliases.items()):
                    if process_key == old_key:
                        self._history_aliases.pop(alias, None)
            while len(self._history_aliases) > MAX_PROCESS_HISTORIES:
                self._history_aliases.popitem(last=False)

    @staticmethod
    def _process_key(
        project_id: str | None, thread_id: str | None, pid: int, create_time: float
    ) -> str:
        identity = f"{project_id or 'gateway'}/{thread_id or 'gateway'}/{pid}/{int(create_time * 1000)}"
        return quote(identity, safe="")

    @staticmethod
    def _session_process_key(project_id: str, thread_id: str) -> str:
        return f"session:{quote(project_id, safe='')}:{quote(thread_id, safe='')}"

    @staticmethod
    def _rpc_totals(
        rpc: dict[str, Any],
    ) -> tuple[int, int, int, int, float | None, float | None]:
        method_stats = rpc.get("methods", {})
        requests = request_bytes = response_bytes = errors = 0
        bucket_bounds = rpc.get("latency_bucket_upper_bounds_ms", [])
        if not isinstance(bucket_bounds, list):
            bucket_bounds = []
        bucket_counts = [0] * (len(bucket_bounds) + 1)
        if isinstance(method_stats, dict):
            for stats in method_stats.values():
                if not isinstance(stats, dict):
                    continue
                requests += int(stats.get("requests") or 0)
                request_bytes += int(stats.get("request_bytes") or 0) + int(
                    stats.get("notification_bytes_sent") or 0
                )
                response_bytes += int(stats.get("response_bytes") or 0) + int(
                    stats.get("notification_bytes_received") or 0
                )
                errors += int(stats.get("errors") or 0)
                method_buckets = stats.get("latency_buckets")
                if isinstance(method_buckets, list) and len(method_buckets) == len(
                    bucket_counts
                ):
                    for index, value in enumerate(method_buckets):
                        if isinstance(value, int) and value > 0:
                            bucket_counts[index] += value

        def percentile(fraction: float) -> float | None:
            count = sum(bucket_counts)
            if not count:
                return None
            target = max(1, math.ceil(count * fraction))
            seen = 0
            for index, value in enumerate(bucket_counts):
                seen += value
                if seen >= target:
                    return (
                        float(bucket_bounds[index])
                        if index < len(bucket_bounds)
                        else None
                    )
            return None

        return (
            requests,
            request_bytes,
            response_bytes,
            errors,
            percentile(0.50),
            percentile(0.95),
        )

    def _process_descriptors(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        gateway = psutil.Process(os.getpid())
        gateway_create_time = gateway.create_time()
        rows.append(
            {
                "process_key": self._process_key(
                    None, None, gateway.pid, gateway_create_time
                ),
                "process_type": "gateway",
                "name": "Gateway",
                "project_id": None,
                "thread_id": None,
                "session_id": None,
                "pid": gateway.pid,
                "ppid": gateway.ppid(),
                "create_time": gateway_create_time,
                "residency_state": "shared",
                "execution_state": "shared",
                "viewer_count": None,
                "blockers": [],
                "rpc": {"pending_requests": 0, "methods": {}},
            }
        )

        clients: dict[tuple[str, str], Any] = dict(self.owner._project_clients)
        for thread_id, client in self.owner._clients.items():
            project_id = self.owner._client_projects.get(
                thread_id, self.owner._current_project_id
            )
            clients.setdefault((project_id, thread_id), client)

        sessions: dict[tuple[str, str], dict[str, Any]] = {}
        try:
            for session in self.owner.list_all_project_sessions():
                key = (
                    str(session.get("project_id") or ""),
                    str(session.get("thread_id") or ""),
                )
                if all(key):
                    sessions[key] = session
            for session in self.owner.list_all_project_child_sessions():
                key = (
                    str(session.get("project_id") or ""),
                    str(session.get("thread_id") or ""),
                )
                if all(key):
                    sessions[key] = session
        except Exception as error:  # noqa: BLE001
            # Resource sampling must not make the thread catalog unavailable.
            logger.warning(
                "Unable to read Session catalog for resource view: %s", error
            )
            sessions = {}

        for key in sorted(set(clients) | set(sessions)):
            project_id, thread_id = key
            client = clients.get(key)
            session = sessions.get(key, {})
            viewer_count = self._viewer_count(key, time.monotonic())
            blockers, execution_state = self._activity(key, session)
            if client is not None and getattr(client, "is_running", False):
                pid = getattr(client, "process_id", None)
                create_time = None
                if isinstance(pid, int):
                    try:
                        create_time = psutil.Process(pid).create_time()
                    except (psutil.Error, OSError):
                        pass
                process_key = self._process_key(
                    project_id, thread_id, pid or 0, create_time or 0
                )
                state = self._states.get(key, "loaded")
                if key in self._parking:
                    state = "parking"
                elif viewer_count == 0 and state == "loaded":
                    state = "idle_grace"
                client_metrics = getattr(client, "rpc_metrics", {})
                totals = self._rpc_totals(client_metrics)
                rows.append(
                    {
                        "process_key": process_key,
                        "process_type": "app_server",
                        "name": "App Server",
                        "project_id": project_id,
                        "thread_id": thread_id,
                        "session_id": session.get("session_id"),
                        "title": session.get("title") or thread_id,
                        "pid": pid,
                        "ppid": os.getpid(),
                        "create_time": create_time,
                        "residency_state": state,
                        "execution_state": execution_state,
                        "viewer_count": viewer_count,
                        "blockers": self._state_details.get(key, blockers),
                        "rpc": client_metrics,
                        "rpc_totals": {
                            "requests": totals[0],
                            "request_bytes": totals[1],
                            "response_bytes": totals[2],
                            "errors": totals[3],
                            "latency_p50_ms": totals[4],
                            "latency_p95_ms": totals[5],
                        },
                    }
                )
            else:
                external = session.get("session_status") == "locked"
                state = (
                    "external_locked" if external else self._states.get(key, "parked")
                )
                if state in {"loaded", "idle_grace"}:
                    state = "parked"
                rows.append(
                    {
                        "process_key": self._session_process_key(project_id, thread_id),
                        "process_type": "app_server",
                        "name": "App Server",
                        "project_id": project_id,
                        "thread_id": thread_id,
                        "session_id": session.get("session_id"),
                        "title": session.get("title") or thread_id,
                        "pid": session.get("locked_by") if external else None,
                        "ppid": None,
                        "create_time": None,
                        "cpu_percent": None,
                        "rss_bytes": None,
                        "uptime_seconds": None,
                        "cpu_time_seconds": None,
                        "residency_state": state,
                        "execution_state": execution_state,
                        "viewer_count": viewer_count,
                        "blockers": self._state_details.get(key, blockers),
                        "rpc": {"pending_requests": 0, "methods": {}},
                        "rpc_totals": {},
                        "can_wake": not external,
                    }
                )

        return rows

    def _activity(
        self, key: tuple[str, str], session: dict[str, Any]
    ) -> tuple[list[str], str]:
        project_id, thread_id = key
        blockers: list[str] = []
        if (
            key in self.owner._active_turns_by_project
            or key in self.owner._active_tasks_by_project
        ):
            blockers.append("活动 Turn")
        if self.owner.list_pending_approvals(project_id, thread_id):
            blockers.append("等待审批")
        if session.get("turn_active") and "活动 Turn" not in blockers:
            blockers.append("活动 Turn")
        operation = session.get("child_task_state") or {}
        operation_status = str(operation.get("status") or "")
        if operation_status in _ACTIVE_CHILD_STATUSES:
            blockers.append(
                "子操作运行中" if operation_status != "queued" else "子操作排队中"
            )
        if blockers:
            state = "waiting_approval" if "等待审批" in blockers else "running"
        elif (
            isinstance(session.get("turn_active"), bool)
            and session.get("turn_active") is False
            and session.get("session_status") in {"locked", "historical", "paused"}
        ):
            state = "idle"
        else:
            state = "unknown"
        return blockers, state

    async def snapshot(self) -> dict[str, Any]:
        await self._sample_once()
        rows = list(self._latest_by_process.values())
        try:
            memory = psutil.virtual_memory()
            available = int(memory.available)
            total = int(memory.total)
        except (psutil.Error, OSError):
            available = total = 0
        return {
            "sampled_at": time.time(),
            "sample_interval_seconds": SAMPLE_INTERVAL_SECONDS,
            "history_seconds": HISTORY_SECONDS,
            "system_memory": {
                "available_bytes": available,
                "total_bytes": total,
                "warning": bool(
                    total and (available < 1024**3 or available / total < 0.10)
                ),
            },
            "processes": rows,
        }

    async def history(self, process_key: str) -> dict[str, Any]:
        resolved_key = self._history_aliases.get(process_key, process_key)
        ring = self._histories.get(resolved_key)
        if ring is None:
            return {"process_key": process_key, "data": []}
        self._histories.move_to_end(resolved_key)
        return {"process_key": process_key, "data": ring.records()}

    async def park_thread(self, project_id: str, thread_id: str) -> dict[str, Any]:
        return await self._park_one((project_id, thread_id), automatic=False)

    async def _park_one(
        self, key: tuple[str, str], *, automatic: bool
    ) -> dict[str, Any]:
        project_id, thread_id = key
        now = time.monotonic()
        if key in self._parking:
            return {"status": "parking", "blockers": []}
        if automatic:
            if now - self._idle_since.get(key, now) < IDLE_PARK_SECONDS:
                return {"status": "idle_grace", "blockers": []}
            if now < self._retry_after.get(key, 0.0):
                return {
                    "status": "blocked",
                    "blockers": self._state_details.get(key, []),
                }

        async with self.owner._lock:
            # A second caller can pass the optimistic check above while it is
            # waiting for this lock. Keep Park idempotent at the transition.
            if key in self._parking:
                return {"status": "parking", "blockers": []}
            if self._viewer_count(key, time.monotonic()):
                blockers = ["仍有可见查看者"]
                self._state_details[key] = blockers
                self._states[key] = "blocked"
                return {"status": "blocked", "blockers": blockers}
            client = self.owner._project_clients.get(key)
            if client is None:
                catalog = self.owner.read_project_thread(thread_id, project_id)
                session = (catalog or {}).get("session") or {}
                status = (
                    "external_locked"
                    if session.get("session_status") == "locked"
                    else "parked"
                )
                self._states[key] = status
                return {"status": status, "blockers": []}
            if not getattr(client, "is_running", False):
                self.owner._client_pool._discard_client(client)
                self._states[key] = "parked"
                return {"status": "parked", "blockers": []}
            blockers = self._local_blockers(key)
            if blockers:
                self._state_details[key] = blockers
                self._states[key] = "blocked"
                self._retry_after[key] = time.monotonic() + 60
                return {"status": "blocked", "blockers": blockers}
            self._parking.add(key)
            self._states[key] = "checking"

        start_lock: asyncio.Lock | None = None
        start_lock_acquired = False
        stop_started = False
        try:
            start_lock = self.owner.get_turn_start_lock(thread_id, project_id)
            try:
                await asyncio.wait_for(start_lock.acquire(), timeout=10.0)
                start_lock_acquired = True
                blockers = await self._runtime_blockers(key, client)
            except asyncio.TimeoutError:
                blockers = ["Turn 启动尚未确认"]
            async with self.owner._lock:
                blockers.extend(self._local_blockers(key))
                if self._viewer_count(key, time.monotonic()):
                    blockers.append("仍有可见查看者")
                blockers = list(dict.fromkeys(blockers))
                if blockers:
                    self._state_details[key] = blockers
                    self._states[key] = "blocked"
                    self._retry_after[key] = time.monotonic() + 60
                    self._parking.discard(key)
                    return {"status": "blocked", "blockers": blockers}
                if self.owner._project_clients.get(key) is not client:
                    self._parking.discard(key)
                    return {"status": "parked", "blockers": []}
                self._states[key] = "parking"

            stop_started = True
            stopped = await client.stop(force=False, timeout=3.0)
            if not stopped:
                self._states[key] = "stopping_unconfirmed"
                self._state_details[key] = ["尚未确认 App Server 退出"]
                # Keep the park gate closed until the OS process is confirmed gone.
                return {
                    "status": "stopping_unconfirmed",
                    "blockers": self._state_details[key],
                }

            async with self.owner._lock:
                self.owner._client_pool._discard_client(client)
                self._parking.discard(key)
                self._states[key] = "parked"
                self._state_details.pop(key, None)
                self._idle_since.pop(key, None)
                self._retry_after.pop(key, None)
            return {"status": "parked", "blockers": []}
        except Exception as error:  # noqa: BLE001
            logger.warning(
                "Unable to park Session %s/%s: %s", project_id, thread_id, error
            )
            self._parking.discard(key)
            self._states[key] = "blocked"
            self._state_details[key] = ["无法确认 App Server 空闲状态"]
            self._retry_after[key] = time.monotonic() + 60
            return {"status": "blocked", "blockers": self._state_details[key]}
        except asyncio.CancelledError:
            if stop_started:
                self._states[key] = "stopping_unconfirmed"
                self._state_details[key] = ["尚未确认 App Server 退出"]
            else:
                self._parking.discard(key)
                self._states[key] = "loaded"
            raise
        finally:
            self._last_sample = 0.0
            if start_lock is not None and start_lock_acquired:
                start_lock.release()

    def _local_blockers(self, key: tuple[str, str]) -> list[str]:
        project_id, thread_id = key
        blockers = []
        if (
            key in self.owner._active_turns_by_project
            or key in self.owner._active_tasks_by_project
        ):
            blockers.append("活动 Turn")
        if self.owner.list_pending_approvals(project_id, thread_id):
            blockers.append("等待审批")
        return blockers

    async def _runtime_blockers(self, key: tuple[str, str], client: Any) -> list[str]:
        project_id, thread_id = key
        blockers: list[str] = []
        runtime = await client.get_runtime_status(thread_id)
        phase = str(getattr(runtime, "phase", "") or "")
        if phase in _ACTIVE_RUNTIME_PHASES:
            blockers.append("App Server 正在执行 Turn")
        elif phase not in {"idle", "completed", "failed"}:
            blockers.append("App Server 活动状态未知")

        background_tasks = await client.list_background_tasks(thread_id)
        for task in background_tasks:
            state = str(getattr(task, "state", "unknown"))
            if state in _ACTIVE_BACKGROUND_STATES:
                blockers.append("后台 Shell 任务运行中")
                break

        try:
            child_tasks = await self.owner.list_child_tasks(thread_id, project_id)
        except KeyError:
            child_tasks = []
        for child in child_tasks:
            if str(child.get("status") or "") in _ACTIVE_CHILD_STATUSES:
                blockers.append(
                    "子操作运行中"
                    if child.get("status") != "queued"
                    else "子操作排队中"
                )
                break
        return blockers

    async def _residency_loop(self) -> None:
        while not self._shutting_down:
            await asyncio.sleep(PARK_SWEEP_SECONDS)
            await self._reconcile_unconfirmed()
            now = time.monotonic()
            for key in list(self.owner._project_clients):
                if key not in self._idle_since:
                    self._idle_since[key] = now
                if self._viewer_count(key, now):
                    self._idle_since.pop(key, None)
                    self._states[key] = "loaded"
                    continue
                self._states.setdefault(key, "idle_grace")
                if now - self._idle_since.get(key, now) >= IDLE_PARK_SECONDS:
                    await self._park_one(key, automatic=True)

    async def _reconcile_unconfirmed(self) -> None:
        for key, state in list(self._states.items()):
            if state != "stopping_unconfirmed":
                continue
            client = self.owner._project_clients.get(key)
            if client is not None and getattr(client, "is_running", False):
                continue
            async with self.owner._lock:
                client = self.owner._project_clients.get(key)
                if client is not None and not getattr(client, "is_running", False):
                    self.owner._client_pool._discard_client(client)
                self._parking.discard(key)
                self._states[key] = "parked"
                self._state_details.pop(key, None)
