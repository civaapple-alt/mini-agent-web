from __future__ import annotations

import asyncio
import tracemalloc
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from server.control.runtime_resources import (
    _HISTORY_FIELDS,
    HISTORY_CAPACITY,
    VIEWER_LEASE_SECONDS,
    RuntimeResourceManager,
    _MetricRing,
)


class FakeClient:
    def __init__(self, *, phase: str = "idle", stop_result: bool = True) -> None:
        self.is_running = True
        self.process_id = 1234
        self.phase = phase
        self.stop_result = stop_result
        self.stop_calls = 0

    async def get_runtime_status(self, _thread_id: str):
        return SimpleNamespace(phase=self.phase)

    async def list_background_tasks(self, _thread_id: str):
        return []

    async def stop(self, *, force: bool, timeout: float):
        assert force is False
        assert timeout == 3.0
        self.stop_calls += 1
        if self.stop_result:
            self.is_running = False
        return self.stop_result


class FakeClientPool:
    def __init__(self, owner):
        self.owner = owner
        self.discarded = []

    def discard_client(self, client):
        self.discarded.append(client)
        for key, bound in list(self.owner._project_clients.items()):
            if bound is client:
                self.owner._project_clients.pop(key)


class FakeOwner:
    def __init__(self, client: FakeClient) -> None:
        self._lock = asyncio.Lock()
        self._project_clients = {("project", "thread"): client}
        self._clients = {"thread": client}
        self._client_projects = {"thread": "project"}
        self._current_project_id = "project"
        self._active_turns_by_project = {}
        self._active_tasks_by_project = {}
        self._client_pool = FakeClientPool(self)
        self._start_lock = asyncio.Lock()
        self.session_catalog_reads = 0

    @asynccontextmanager
    async def runtime_state_lock(self):
        async with self._lock:
            yield

    def runtime_client_bindings(self):
        return dict(self._project_clients)

    def runtime_client_for_thread(self, project_id, thread_id):
        return self._project_clients.get((project_id, thread_id))

    def discard_runtime_client(self, client):
        self._client_pool.discard_client(client)

    def runtime_thread_has_active_work(self, project_id, thread_id):
        key = (project_id, thread_id)
        return (
            key in self._active_turns_by_project or key in self._active_tasks_by_project
        )

    def is_project_restarting(self, _project_id):
        return False

    def list_pending_approvals(self, _project_id: str, _thread_id: str):
        return []

    def get_turn_start_lock(self, _thread_id: str, _project_id: str):
        return self._start_lock

    async def list_child_tasks(self, _thread_id: str, _project_id: str):
        return []

    def read_project_thread(self, _thread_id: str, _project_id: str):
        return {"session": {"session_status": "available"}}

    def read_project_thread_summary(self, _thread_id: str, _project_id: str):
        return {"session_status": "historical", "turn_active": False}

    def list_all_project_sessions(self):
        self.session_catalog_reads += 1
        return []

    def list_all_project_child_sessions(self):
        self.session_catalog_reads += 1
        return []


def test_metric_ring_is_fixed_capacity_and_keeps_numeric_samples_only(monkeypatch):
    ring = _MetricRing(capacity=3)
    monkeypatch.setattr("server.control.runtime_resources.time.time", lambda: 600.0)
    assert len(ring.values) == 3 * len(_HISTORY_FIELDS)
    for timestamp in range(5):
        ring.append(
            (float(timestamp),)
            + tuple(float(timestamp + 1) for _ in _HISTORY_FIELDS[1:])
        )

    data = ring.records()
    assert len(data) == 3
    assert [sample["timestamp"] for sample in data] == [2.0, 3.0, 4.0]
    assert all(set(sample) == set(_HISTORY_FIELDS) for sample in data)
    assert all(
        isinstance(value, (float, type(None)))
        for sample in data
        for value in sample.values()
    )
    assert ring.capacity <= HISTORY_CAPACITY


def test_metric_ring_does_not_return_samples_older_than_ten_minutes(monkeypatch):
    ring = _MetricRing(capacity=3)
    now = [1_000.0]
    monkeypatch.setattr("server.control.runtime_resources.time.time", lambda: now[0])
    for timestamp in (399.0, 400.0, 401.0):
        ring.append((timestamp,) + tuple(1.0 for _ in _HISTORY_FIELDS[1:]))

    assert [sample["timestamp"] for sample in ring.records()] == [400.0, 401.0]


def test_rpc_process_percentiles_merge_method_histograms_by_request_count():
    bounds = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
    quick = [0] * (len(bounds) + 1)
    slow = [0] * (len(bounds) + 1)
    quick[0] = 100
    slow[9] = 1
    totals = RuntimeResourceManager._rpc_totals(
        {
            "latency_bucket_upper_bounds_ms": bounds,
            "methods": {
                "thread/read": {"requests": 100, "latency_buckets": quick},
                "thread/write": {"requests": 1, "latency_buckets": slow},
            },
        }
    )

    assert totals[0] == 101
    assert totals[4] == 1.0
    assert totals[5] == 1.0


def test_two_browser_viewers_share_one_thread_lease_and_expire(monkeypatch):
    manager = RuntimeResourceManager(FakeOwner(FakeClient()))
    first_browser = object()
    second_browser = object()
    now = [100.0]
    monkeypatch.setattr(
        "server.control.runtime_resources.time.monotonic", lambda: now[0]
    )

    manager.update_viewer(first_browser, "project", "thread", True)
    manager.update_viewer(second_browser, "project", "thread", True)
    assert manager._viewer_count(("project", "thread"), now[0]) == 2

    now[0] += 15
    manager.update_viewer(first_browser, "project", "thread", True)
    manager.release_viewer(second_browser)
    assert manager._viewer_count(("project", "thread"), now[0]) == 1

    now[0] += VIEWER_LEASE_SECONDS + 1
    assert manager._viewer_count(("project", "thread"), now[0]) == 0
    assert manager._idle_since[("project", "thread")] == now[0]


@pytest.mark.asyncio
async def test_active_turn_blocks_park_before_process_stop():
    client = FakeClient()
    owner = FakeOwner(client)
    owner._active_turns_by_project[("project", "thread")] = "turn-1"
    manager = RuntimeResourceManager(owner)

    result = await manager.park_thread("project", "thread")

    assert result == {"status": "blocked", "blockers": ["活动 Turn"]}
    assert client.stop_calls == 0


@pytest.mark.asyncio
async def test_unknown_runtime_status_blocks_park():
    client = FakeClient(phase="unrecognized")
    manager = RuntimeResourceManager(FakeOwner(client))

    result = await manager.park_thread("project", "thread")

    assert result["status"] == "blocked"
    assert "App Server 活动状态未知" in result["blockers"]
    assert client.stop_calls == 0


@pytest.mark.asyncio
async def test_unconfirmed_stop_keeps_park_gate_closed():
    client = FakeClient(stop_result=False)
    owner = FakeOwner(client)
    manager = RuntimeResourceManager(owner)

    first = await manager.park_thread("project", "thread")
    second = await manager.park_thread("project", "thread")

    assert first["status"] == "stopping_unconfirmed"
    assert second["status"] == "parking"
    assert manager.is_parking("project", "thread")
    assert client.stop_calls == 1
    assert owner._client_pool.discarded == []
    row = next(
        row
        for row in manager._process_descriptors()
        if row.get("thread_id") == "thread"
    )
    assert row["residency_state"] == "stopping_unconfirmed"


def test_client_activation_clears_stale_park_state_after_old_process_exits():
    manager = RuntimeResourceManager(FakeOwner(FakeClient()))
    key = ("project", "thread")
    old_client = FakeClient()
    old_client.is_running = False
    replacement = FakeClient()
    manager._parking.add(key)
    manager._parking_clients[key] = old_client
    manager._states[key] = "stopping_unconfirmed"
    manager._state_details[key] = ["尚未确认 App Server 退出"]
    manager._retry_after[key] = 123.0
    manager._idle_since[key] = 100.0

    manager.on_client_activated("project", "thread", replacement)

    assert not manager.is_parking(*key)
    assert manager._states[key] == "loaded"
    assert key not in manager._state_details
    assert key not in manager._retry_after
    assert manager._idle_since[key] > 100.0


@pytest.mark.asyncio
async def test_unloaded_park_uses_summary_outside_owner_lock():
    owner = FakeOwner(FakeClient())
    owner._project_clients.clear()
    owner._clients.clear()
    owner._client_projects.clear()
    owner._lock_was_held_during_summary_read = None

    def read_summary(_thread_id: str, _project_id: str):
        owner._lock_was_held_during_summary_read = owner._lock.locked()
        return {"session_status": "historical", "turn_active": False}

    owner.read_project_thread_summary = read_summary
    manager = RuntimeResourceManager(owner)

    result = await manager.park_thread("project", "thread")

    assert result == {"status": "parked", "blockers": []}
    assert owner._lock_was_held_during_summary_read is False


@pytest.mark.asyncio
async def test_unloaded_park_blocks_when_summary_status_is_unknown():
    owner = FakeOwner(FakeClient())
    owner._project_clients.clear()
    owner._clients.clear()
    owner._client_projects.clear()
    owner.read_project_thread_summary = lambda *_args: {"session_status": "unknown"}
    manager = RuntimeResourceManager(owner)

    result = await manager.park_thread("project", "thread")

    assert result == {"status": "blocked", "blockers": ["Session 状态未知"]}


def test_resource_session_catalog_is_cached_and_bounded(monkeypatch):
    owner = FakeOwner(FakeClient())
    manager = RuntimeResourceManager(owner)
    now = [50.0]
    monkeypatch.setattr(
        "server.control.runtime_resources.time.monotonic", lambda: now[0]
    )
    reads = [0]

    def list_sessions():
        reads[0] += 1
        return [
            {
                "project_id": "project",
                "thread_id": f"thread-{index}",
                "updated_at": f"2026-01-{index % 28 + 1:02}",
            }
            for index in range(700)
        ]

    def no_child_sessions():
        reads[0] += 1
        return []

    owner.list_all_project_sessions = list_sessions
    owner.list_all_project_child_sessions = no_child_sessions

    first = manager._session_catalog_snapshot()
    second = manager._session_catalog_snapshot()

    assert len(first) == 512
    assert second is first
    assert reads == [2]
    now[0] += 16
    third = manager._session_catalog_snapshot()
    assert len(third) == 512
    assert third is not first
    assert reads == [4]


@pytest.mark.asyncio
async def test_concurrent_park_requests_share_one_stop_transition():
    stop_started = asyncio.Event()
    allow_stop = asyncio.Event()

    class WaitingClient(FakeClient):
        async def stop(self, *, force: bool, timeout: float):
            assert force is False
            assert timeout == 3.0
            self.stop_calls += 1
            stop_started.set()
            await allow_stop.wait()
            self.is_running = False
            return True

    client = WaitingClient()
    owner = FakeOwner(client)
    manager = RuntimeResourceManager(owner)
    await owner._lock.acquire()
    first = asyncio.create_task(manager.park_thread("project", "thread"))
    second_task = asyncio.create_task(manager.park_thread("project", "thread"))
    await asyncio.sleep(0)
    owner._lock.release()
    await stop_started.wait()
    await asyncio.sleep(0)

    allow_stop.set()
    first_result, second_result = await asyncio.gather(first, second_task)
    assert first_result == {"status": "parked", "blockers": []}
    assert second_result == {"status": "parking", "blockers": []}
    assert client.stop_calls == 1


@pytest.mark.asyncio
async def test_cancelled_park_waits_for_process_exit_confirmation():
    stop_started = asyncio.Event()
    never_finishes = asyncio.Event()

    class CancellableClient(FakeClient):
        async def stop(self, *, force: bool, timeout: float):
            assert force is False
            self.stop_calls += 1
            stop_started.set()
            await never_finishes.wait()
            return False

    client = CancellableClient()
    owner = FakeOwner(client)
    manager = RuntimeResourceManager(owner)
    task = asyncio.create_task(manager.park_thread("project", "thread"))
    await stop_started.wait()
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert manager.is_parking("project", "thread")
    assert manager._states[("project", "thread")] == "stopping_unconfirmed"
    assert owner._project_clients[("project", "thread")] is client

    client.is_running = False
    await manager.reconcile_unconfirmed()

    assert not manager.is_parking("project", "thread")
    assert manager._states[("project", "thread")] == "parked"
    assert owner._project_clients == {}


def test_execution_state_is_unknown_without_authoritative_session_status():
    manager = RuntimeResourceManager(FakeOwner(FakeClient()))

    blockers, state = manager._activity(
        ("project", "thread"), {"session_id": "session-1"}
    )

    assert blockers == []
    assert state == "unknown"


def test_execution_state_uses_a_confirmed_inactive_session_summary():
    manager = RuntimeResourceManager(FakeOwner(FakeClient()))

    blockers, state = manager._activity(
        ("project", "thread"),
        {
            "session_id": "session-1",
            "turn_active": False,
            "session_status": "historical",
        },
    )

    assert blockers == []
    assert state == "idle"


@pytest.mark.asyncio
async def test_snapshot_reuses_the_sampled_process_projection(monkeypatch):
    class FakeProcess:
        def __init__(self, pid):
            self.pid = pid

        def create_time(self):
            return 1_000.0

        def cpu_times(self):
            return SimpleNamespace(user=1.0, system=0.0)

        def ppid(self):
            return 1

        def memory_info(self):
            return SimpleNamespace(rss=1024)

    owner = FakeOwner(FakeClient())
    manager = RuntimeResourceManager(owner)
    monkeypatch.setattr("server.control.runtime_resources.psutil.Process", FakeProcess)
    monkeypatch.setattr(
        "server.control.runtime_resources.psutil.virtual_memory",
        lambda: SimpleNamespace(available=2 * 1024**3, total=8 * 1024**3),
    )

    snapshot = await manager.snapshot()

    assert len(snapshot["processes"]) == 2
    assert owner.session_catalog_reads == 2


@pytest.mark.asyncio
async def test_parked_session_can_read_its_recent_process_history(monkeypatch):
    class FakeProcess:
        def __init__(self, pid):
            self.pid = pid

        def create_time(self):
            return 1_000.0

        def cpu_times(self):
            return SimpleNamespace(user=1.0, system=0.0)

        def ppid(self):
            return 1

        def memory_info(self):
            return SimpleNamespace(rss=1024)

    manager = RuntimeResourceManager(FakeOwner(FakeClient()))
    monkeypatch.setattr("server.control.runtime_resources.psutil.Process", FakeProcess)
    await manager._sample_once()

    alias = manager._session_process_key("project", "thread")
    result = await manager.history(alias)

    assert result["process_key"] == alias
    assert len(result["data"]) == 1
    assert result["data"][0]["rss_bytes"] == 1024.0


@pytest.mark.asyncio
async def test_gateway_and_32_app_server_history_stays_below_two_mib(monkeypatch):
    class FakeProcess:
        def __init__(self, pid):
            self.pid = pid

        def create_time(self):
            return 1_000.0 + self.pid

        def cpu_times(self):
            ticks[self.pid] = ticks.get(self.pid, 0.0) + 0.01
            return SimpleNamespace(user=ticks[self.pid], system=0.0)

        def ppid(self):
            return 1

        def memory_info(self):
            return SimpleNamespace(rss=1024 * 1024)

    ticks = {}
    clients = {
        (f"project-{index}", f"thread-{index}"): SimpleNamespace(
            is_running=True,
            process_id=20_000 + index,
            rpc_metrics={"pending_requests": 0, "methods": {}},
        )
        for index in range(32)
    }
    owner = FakeOwner(FakeClient())
    owner._project_clients = clients
    owner._clients = {}
    owner._client_projects = {}
    manager = RuntimeResourceManager(owner)
    monkeypatch.setattr("server.control.runtime_resources.psutil.Process", FakeProcess)

    tracemalloc.start()
    before = tracemalloc.get_traced_memory()[0]
    for _ in range(2):
        manager._last_sample = 0.0
        await manager._sample_once()
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    assert len(manager._histories) == 33
    assert all(ring.count == 2 for ring in manager._histories.values())
    assert (
        sum(
            ring.values.buffer_info()[1] * ring.values.itemsize
            for ring in manager._histories.values()
        )
        < 2 * 1024**2
    )
    assert current - before < 2 * 1024**2
    assert peak - before < 2 * 1024**2
