"""
Session and Client Pool Manager.
Manages the MiniAgentClient instance, approval callbacks, WebSocket/SSE broadcasting,
thread metadata caching (titles, summaries), and runtime user settings.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from collections import OrderedDict
from pathlib import Path
from typing import Any

from fastapi import WebSocket
from mini_agent import MiniAgentClient

from server.config import settings
from server.control.approval_bridge import ApprovalBridge
from server.control.client_pool import ClientPool
from server.control.project_registry import ProjectRegistry
from server.control.thread_registry import ThreadRegistry
from server.control.turn_registry import TurnRegistry
from server.control.ws_broker import WebSocketBroker
from server.persistence import to_json_serializable
from server.session_catalog import session_catalog

logger = logging.getLogger("mini_agent.server")

MAX_INTERRUPTED_TURNS = 256
MAX_CHILD_TASKS_PER_PARENT = 2
MAX_CONFIGURED_CHILD_TASKS_PER_PARENT = 8
MAX_CHILD_TASK_PROMPT_BYTES = 32 * 1024
__all__ = ["SessionManager", "session_manager", "to_json_serializable"]


def _attachment_storage_key(value: str) -> str:
    """Create a bounded, stable filesystem key for a Project or Thread identity."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]


class SessionManager:
    """Manages the backend MiniAgentClient, frontend connections, projects, and metadata."""

    def __init__(self) -> None:
        self._client: MiniAgentClient | None = None
        # ``_clients`` remains the active-thread compatibility view used by
        # existing routes/tests.  The real pool is project-qualified so two
        # projects may both own a ``default`` Thread.
        self._clients: dict[str, MiniAgentClient] = {}
        self._client_projects: dict[str, str] = {}
        self._project_clients: dict[tuple[str, str], MiniAgentClient] = {}
        self._active_thread_projects: dict[str, str] = {}
        # Keep the connection's latest project routing context alongside the
        # socket. Runtime notifications are project-scoped; filtering them at
        # the gateway prevents cross-project traffic before it reaches Studio.
        self._active_connections: dict[WebSocket, str | None] = {}
        self._pending_approvals: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._pending_approval_details: dict[str, dict[str, Any]] = {}
        # A bounded tombstone prevents a late approval/request from reopening
        # a Turn after the user has already stopped it. The App Server is the
        # source of execution truth; this is only the Gateway's admission
        # guard for the approval bridge.
        self._interrupted_turns: OrderedDict[tuple[str, str, str], None] = OrderedDict()
        self._lock = asyncio.Lock()
        self._initialized = False
        self._runtime_generation = 0

        # Web owns only this derived project/UI manifest. Session history,
        # checkpoints, and approval grants belong to the App Server SessionStore.
        self._project_registry = ProjectRegistry(self)
        state_dir_env = os.environ.get("MINI_AGENT_WEB_STATE_DIR")
        self._set_state_paths(
            Path(state_dir_env)
            if state_dir_env
            else (Path.home() / ".mini-agent" / "web")
        )

        # Structured project registry: project_id -> project dict
        self._current_project_path: Path = Path.cwd().resolve()
        self._current_project_id: str = self._current_project_path.name
        self._projects_registry: dict[str, dict[str, Any]] = {}
        self._thread_metadata: dict[str, dict[str, Any]] = {}
        self._thread_metadata_by_project: dict[tuple[str, str], dict[str, Any]] = {}
        self._thread_registry = ThreadRegistry(self)
        self._client_pool = ClientPool(self)

        # Active turn & task tracking for responsive interrupts
        self._active_turns: dict[str, str] = {}
        self._active_tasks: dict[str, asyncio.Task[Any]] = {}
        self._active_turns_by_project: dict[tuple[str, str], str] = {}
        self._active_tasks_by_project: dict[tuple[str, str], asyncio.Task[Any]] = {}
        # Serializes child creation admission without serializing the child
        # runtimes themselves. Each child still owns an independent client and
        # App Server process after this short control-plane critical section.
        self._child_task_lock = asyncio.Lock()
        self._thread_builtin_tools: dict[str, list[str]] = {}
        self._thread_builtin_tools_by_project: dict[tuple[str, str], list[str]] = {}
        self._turn_registry = TurnRegistry(self)
        self._approval_bridge = ApprovalBridge(self, MAX_INTERRUPTED_TURNS)
        self._ws_broker = WebSocketBroker(self)

        # Runtime system settings
        self._settings: dict[str, Any] = {
            "host": settings.host,
            "port": settings.port,
            "default_mode": "chat",  # chat | plan | goal
            "reasoning_effort": "high",
            "theme": "light",
            "auto_scroll": True,
            "word_wrap": True,
            "font_size": 13,
            "subagent": {
                "max_concurrent_children": MAX_CHILD_TASKS_PER_PARENT,
                "default_execution_mode": "parallel",
            },
        }

        # Load persisted state or initialize clean default with only the active workspace
        self._load_state()

    def _set_state_paths(self, base_dir: Path) -> None:
        """Configure directory layout for state persistence."""
        self._project_registry.set_state_paths(base_dir)

    @property
    def _state_dir(self) -> Path:
        return self._project_registry.state_dir

    @_state_dir.setter
    def _state_dir(self, val: Path) -> None:
        self._set_state_paths(val)

    def _load_state(self) -> None:
        """Load projects, settings, and session metadata from decoupled files."""
        self._project_registry.load_state()

    def _save_settings(self) -> None:
        """Persist global settings through the project registry's storage boundary."""
        self._project_registry.save_settings()

    def _save_projects(self) -> None:
        """Persist the project registry through its storage boundary."""
        self._project_registry.save_projects()

    def _save_project_threads(self, project_id: str) -> None:
        """Persist one project's Web-side Thread metadata."""
        self._project_registry.save_project_threads(project_id)

    def _save_thread_for_id(self, thread_id: str) -> None:
        self._project_registry.save_thread_for_id(thread_id)

    def _save_all_threads(self) -> None:
        self._project_registry.save_all_threads()

    def _save_state(self) -> None:
        """Persist all state slices through their domain-specific stores."""
        self._project_registry.save_state()

    def get_projects(self) -> dict[str, Any]:
        """Get all projects with active threads summary."""
        return self._project_registry.get_projects()

    def create_project(
        self,
        name: str,
        path: str | None = None,
        source_folders: list[dict[str, Any]] | None = None,
        init_readme: bool = True,
    ) -> dict[str, Any]:
        return self._project_registry.create_project(
            name, path, source_folders, init_readme
        )

    def update_project(
        self, project_id: str, updates: dict[str, Any]
    ) -> dict[str, Any]:
        """Update project name, primary path, source folders, or pinned state."""
        return self._project_registry.update_project(project_id, updates)

    def delete_project(self, project_id: str) -> bool:
        """Remove a project from the workspace registry."""
        return self._project_registry.delete_project(project_id)

    def toggle_pin_project(self, project_id: str) -> dict[str, Any]:
        return self._project_registry.toggle_pin_project(project_id)

    def switch_project(self, project_id_or_path: str) -> dict[str, Any]:
        return self._project_registry.switch_project(project_id_or_path)

    @property
    def current_project_path(self) -> Path:
        """Active project working directory path."""
        return self._project_registry.current_project_path

    @property
    def current_source_folders(self) -> list[dict[str, Any]]:
        """Active project configured multi-source folders."""
        return self._project_registry.current_source_folders

    def _runtime_env(self, project: dict[str, Any] | None = None) -> dict[str, str]:
        """Pass one Project's bounded workspace binding to the Host process."""
        return self._project_registry.runtime_env(project)

    @property
    def client(self) -> MiniAgentClient:
        if self._client is None:
            raise RuntimeError(
                "SessionManager is not started. MiniAgentClient is None."
            )
        return self._client

    def _project_for_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> dict[str, Any]:
        return self._thread_registry.project_for_thread(thread_id, project_id)

    def resolve_thread_project(
        self, thread_id: str, project_id: str | None = None
    ) -> str:
        """Resolve an explicit project identity for thread-scoped controls."""
        return self._thread_registry.resolve_thread_project(thread_id, project_id)

    def _canonical_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> dict[str, Any] | None:
        """Read one canonical Thread, honoring an explicit Project binding."""
        return self._thread_registry.canonical_thread(thread_id, project_id)

    def _activate_thread_client(
        self, thread_id: str, project_id: str, client: MiniAgentClient
    ) -> None:
        self._client_pool.activate_thread_client(thread_id, project_id, client)

    def _all_clients(self) -> list[MiniAgentClient]:
        return self._client_pool.all_clients()

    def live_thread_bindings(self) -> list[tuple[str, str]]:
        return self._client_pool.live_thread_bindings()

    def builtin_tools_for_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> list[str] | None:
        return self._client_pool.builtin_tools_for_thread(thread_id, project_id)

    def set_builtin_tools_for_thread(
        self,
        thread_id: str,
        builtin_tools: list[str],
        project_id: str | None = None,
    ) -> None:
        self._client_pool.set_builtin_tools_for_thread(
            thread_id, builtin_tools, project_id
        )

    async def _create_client(
        self,
        thread_id: str,
        project: dict[str, Any],
        session_mode: str,
        session_id: str | None = None,
    ) -> MiniAgentClient:
        return await self._client_pool.create_client(
            thread_id, project, session_mode, session_id
        )

    async def _get_client_for_thread_locked(
        self, thread_id: str, project_id: str | None = None
    ) -> MiniAgentClient:
        return await self._client_pool.get_client_for_thread_locked(
            thread_id, project_id
        )

    async def get_client_for_thread(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> MiniAgentClient:
        return await self._client_pool.get_client_for_thread(thread_id, project_id)

    async def get_client_for_project(
        self, project_id: str | None = None, thread_id: str | None = None
    ) -> MiniAgentClient:
        return await self._client_pool.get_client_for_project(project_id, thread_id)

    def live_thread_ids(self) -> list[str]:
        return self._client_pool.live_thread_ids()

    def bind_thread_client(
        self,
        thread_id: str,
        client: MiniAgentClient,
        project_id: str | None = None,
    ) -> None:
        self._client_pool.bind_thread_client(thread_id, client, project_id)

    async def fork_thread(
        self,
        source_thread_id: str,
        new_thread_id: str,
        title: str | None = None,
        project_id: str | None = None,
        context_policy: str = "exact",
        operation_id: str | None = None,
        operation_attempt: int | None = None,
        operation_prompt: str | None = None,
        operation_group_id: str | None = None,
        execution_mode: str | None = None,
        group_sequence: int | None = None,
    ) -> dict[str, Any]:
        return await self._client_pool.fork_thread(
            source_thread_id,
            new_thread_id,
            title,
            project_id,
            context_policy,
            operation_id,
            operation_attempt,
            operation_prompt,
            operation_group_id,
            execution_mode,
            group_sequence,
        )

    async def start_child_task(
        self,
        source_thread_id: str,
        new_thread_id: str,
        prompt: str,
        title: str | None = None,
        project_id: str | None = None,
        group_id: str | None = None,
        execution_mode: str | None = None,
        sequence: int | None = None,
    ) -> dict[str, Any]:
        """Create an exact child Session and run one detached child Turn.

        This is the first explicit child-runtime control seam. It keeps the
        Gateway responsible for orchestration only: SessionStore persists the
        child lineage, the child App Server owns execution, and the existing
        runtime notification/replay path remains the source of child events.
        """
        source_thread_id = source_thread_id or "default"
        new_thread_id = new_thread_id.strip()
        prompt = prompt.strip()
        if not new_thread_id:
            raise ValueError("child thread id is required")
        if not prompt:
            raise ValueError("child task prompt is required")
        if len(prompt.encode("utf-8")) > MAX_CHILD_TASK_PROMPT_BYTES:
            raise ValueError(
                f"child task prompt exceeds {MAX_CHILD_TASK_PROMPT_BYTES} bytes"
            )

        resolved_project_id = self.resolve_thread_project(
            source_thread_id, project_id
        )
        subagent = self.get_settings(resolved_project_id).get("subagent") or {}
        try:
            max_children = int(
                subagent.get(
                    "max_concurrent_children", MAX_CHILD_TASKS_PER_PARENT
                )
            )
        except (TypeError, ValueError):
            max_children = MAX_CHILD_TASKS_PER_PARENT
        max_children = max(
            1, min(max_children, MAX_CONFIGURED_CHILD_TASKS_PER_PARENT)
        )
        group_id = group_id.strip() if group_id else None
        if group_id and len(group_id.encode("utf-8")) > 128:
            raise ValueError("child task group id is too long")
        execution_mode = execution_mode or str(
            subagent.get("default_execution_mode", "parallel")
        )
        if execution_mode not in {"parallel", "sequential"}:
            raise ValueError("child execution mode must be parallel or sequential")
        if execution_mode == "sequential" and not group_id:
            raise ValueError("sequential child tasks require a group id")
        if sequence is not None and sequence < 0:
            raise ValueError("child task sequence must be non-negative")
        async with self._child_task_lock:
            parent = self._canonical_thread(source_thread_id, resolved_project_id)
            if not parent:
                raise KeyError(f"Thread '{source_thread_id}' not found")
            parent_session_id = str(parent.get("session", {}).get("session_id") or "")
            if not parent_session_id:
                raise RuntimeError("parent Session persistence is unavailable")
            if parent.get("session", {}).get("parent_session_id"):
                raise RuntimeError("child task depth is limited to one level")

            children = self.list_project_sessions(resolved_project_id, limit=128)[
                "data"
            ]
            active_children = sum(
                1
                for child in children
                if child.get("parent_session_id") == parent_session_id
                and (
                    child.get("turn_active")
                    or child.get("operation_status")
                    in {"queued", "running", "awaiting_approval"}
                    or (
                        resolved_project_id,
                        str(child.get("thread_id") or ""),
                    )
                    in self._active_turns_by_project
                )
            )
            if self._canonical_thread(new_thread_id, resolved_project_id):
                raise RuntimeError(
                    f"child Thread '{new_thread_id}' already exists"
                )

            operation_id = f"child:{new_thread_id}"
            operation_attempt = 1
            same_group_active = any(
                child.get("operation_group_id") == group_id
                and (child.get("operation_status") or child.get("status"))
                in {"queued", "running", "awaiting_approval", "in_progress"}
                for child in children
                if group_id
            )
            queued = active_children >= max_children or (
                execution_mode == "sequential" and same_group_active
            )
            fork_args = (
                source_thread_id,
                new_thread_id,
                title,
                resolved_project_id,
                "exact",
                operation_id,
                operation_attempt,
            )
            if queued or group_id or execution_mode != "parallel" or sequence is not None:
                fork = await self.fork_thread(
                    *fork_args,
                    prompt,
                    group_id,
                    execution_mode,
                    sequence,
                )
            else:
                fork = await self.fork_thread(*fork_args)
            if queued:
                return {
                    "parent_thread_id": source_thread_id,
                    "child_thread_id": new_thread_id,
                    "project": resolved_project_id,
                    "session": fork,
                    "turn_id": None,
                    "operation_id": operation_id,
                    "operation_attempt": operation_attempt,
                    "operation_group_id": group_id,
                    "execution_mode": execution_mode,
                    "group_sequence": sequence,
                    "status": "queued",
                }
            child_client = await self.get_client_for_thread(
                new_thread_id, resolved_project_id
            )
            turn_kwargs: dict[str, Any] = {
                "prompt": prompt,
                "mode": "start",
                "thread_id": new_thread_id,
                "effort": self.get_settings(resolved_project_id).get(
                    "reasoning_effort", "high"
                ),
                "operation_id": operation_id,
                "operation_attempt": operation_attempt,
            }
            if group_id or execution_mode != "parallel" or sequence is not None:
                turn_kwargs.update(
                    {
                        "operation_group_id": group_id,
                        "execution_mode": execution_mode,
                        "group_sequence": sequence,
                    }
                )
            submission = await child_client.start_turn(**turn_kwargs)
            turn_id = str(getattr(submission, "turn_id", None) or "")
            result: dict[str, Any] = {
                "parent_thread_id": source_thread_id,
                "child_thread_id": new_thread_id,
                "project": resolved_project_id,
                "session": fork,
                "turn_id": turn_id or None,
                "operation_id": operation_id,
                "operation_attempt": operation_attempt,
                "operation_group_id": group_id,
                "execution_mode": execution_mode,
                "group_sequence": sequence,
                "status": "running"
                if turn_id
                else str(getattr(submission, "status", "not_started")),
            }
            if not turn_id:
                return result

            task = asyncio.create_task(
                self._wait_for_child_turn(
                    child_client,
                    new_thread_id,
                    resolved_project_id,
                    turn_id,
                    source_thread_id,
                )
            )
            self.set_active_turn(new_thread_id, turn_id, task, resolved_project_id)
            return result

    async def _wait_for_child_turn(
        self,
        client: MiniAgentClient,
        thread_id: str,
        project_id: str,
        turn_id: str,
        parent_thread_id: str | None = None,
    ) -> None:
        """Keep the child turn registered until its canonical result settles."""
        task = asyncio.current_task()
        try:
            await client.wait_for_turn(turn_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Child Turn %s failed while settling", turn_id)
        finally:
            self.clear_active_turn(thread_id, project_id, turn_id, task)
            try:
                await self._drain_child_queue(parent_thread_id or thread_id, project_id)
            except Exception:
                logger.exception("Unable to drain queued child tasks for %s", thread_id)

    async def _drain_child_queue(
        self, source_thread_id: str, project_id: str
    ) -> None:
        """Start durable queued child operations while configured slots exist."""
        async with self._child_task_lock:
            parent = self._canonical_thread(source_thread_id, project_id)
            if not parent:
                return
            subagent = self.get_settings(project_id).get("subagent") or {}
            try:
                limit = int(
                    subagent.get(
                        "max_concurrent_children", MAX_CHILD_TASKS_PER_PARENT
                    )
                )
            except (TypeError, ValueError):
                limit = MAX_CHILD_TASKS_PER_PARENT
            limit = max(1, min(limit, MAX_CONFIGURED_CHILD_TASKS_PER_PARENT))
            children = await self.list_child_tasks(source_thread_id, project_id)
            active = [
                child
                for child in children
                if child.get("status")
                in {"running", "awaiting_approval", "in_progress", "queued"}
                and child.get("turn_id")
            ]
            capacity = limit - len(active)
            if capacity <= 0:
                return
            queued = [child for child in children if child.get("status") == "queued"]
            queued.sort(
                key=lambda child: (
                    child.get("operation_group_id") or "",
                    child.get("group_sequence")
                    if child.get("group_sequence") is not None
                    else 2**31,
                    child.get("child_thread_id") or "",
                )
            )
            while capacity > 0:
                candidate = None
                for child in queued:
                    group_id = child.get("operation_group_id")
                    mode = child.get("execution_mode") or "parallel"
                    if mode == "sequential" and group_id:
                        if any(
                            item.get("operation_group_id") == group_id
                            and item.get("turn_id")
                            and item.get("status")
                            in {"running", "awaiting_approval", "in_progress", "queued"}
                            for item in active
                        ):
                            continue
                        earlier = [
                            item
                            for item in queued
                            if item is not child
                            and item.get("operation_group_id") == group_id
                            and item.get("group_sequence") is not None
                            and child.get("group_sequence") is not None
                            and item.get("group_sequence") < child.get("group_sequence")
                        ]
                        if earlier:
                            continue
                    candidate = child
                    break
                if candidate is None:
                    return
                prompt = str(candidate.get("operation_prompt") or "").strip()
                child_thread_id = str(candidate.get("child_thread_id") or "")
                turn_id = str(candidate.get("turn_id") or "")
                if not prompt or not child_thread_id or turn_id:
                    return
                try:
                    client = await self.get_client_for_thread(
                        child_thread_id, project_id
                    )
                    submission = await client.start_turn(
                        prompt=prompt,
                        mode="start",
                        thread_id=child_thread_id,
                        effort=self.get_settings(project_id).get(
                            "reasoning_effort", "high"
                        ),
                        operation_id=candidate.get("operation_id"),
                        operation_attempt=int(
                            candidate.get("operation_attempt") or 1
                        ),
                        operation_group_id=candidate.get("operation_group_id"),
                        execution_mode=candidate.get("execution_mode"),
                        group_sequence=candidate.get("group_sequence"),
                    )
                    started_turn_id = str(getattr(submission, "turn_id", None) or "")
                    if not started_turn_id:
                        return
                    task = asyncio.create_task(
                        self._wait_for_child_turn(
                            client,
                            child_thread_id,
                            project_id,
                            started_turn_id,
                            source_thread_id,
                        )
                    )
                    self.set_active_turn(
                        child_thread_id, started_turn_id, task, project_id
                    )
                    active.append({**candidate, "turn_id": started_turn_id, "status": "running"})
                    queued.remove(candidate)
                    capacity -= 1
                except Exception:
                    logger.exception("Unable to start queued child %s", child_thread_id)
                    return

    async def cancel_child_task(
        self, source_thread_id: str, child_thread_id: str, project_id: str | None = None
    ) -> dict[str, Any]:
        """Request cooperative cancellation through the child App Server."""
        resolved_project_id = self.resolve_thread_project(
            source_thread_id or "default", project_id
        )
        child = next(
            (
                item
                for item in await self.list_child_tasks(source_thread_id, project_id)
                if item.get("child_thread_id") == child_thread_id
            ),
            None,
        )
        if child is None:
            raise KeyError(f"Child Thread '{child_thread_id}' not found")
        turn_id = str(child.get("turn_id") or "")
        if not turn_id or child.get("status") not in {
            "queued",
            "running",
            "awaiting_approval",
            "in_progress",
        }:
            raise ValueError("child task is not active")
        client = await self.get_client_for_thread(child_thread_id, resolved_project_id)
        await client.interrupt_turn(turn_id, child_thread_id)
        return {
            **child,
            "status": "cancelling",
            "turn_id": turn_id,
        }

    async def retry_child_task(
        self, source_thread_id: str, child_thread_id: str, project_id: str | None = None
    ) -> dict[str, Any]:
        """Resume a failed/cancelled child Session with a bounded new attempt."""
        source_thread_id = source_thread_id or "default"
        resolved_project_id = self.resolve_thread_project(source_thread_id, project_id)
        async with self._child_task_lock:
            child = next(
                (
                    item
                    for item in await self.list_child_tasks(source_thread_id, project_id)
                    if item.get("child_thread_id") == child_thread_id
                ),
                None,
            )
            if child is None:
                raise KeyError(f"Child Thread '{child_thread_id}' not found")
            if child.get("status") not in {"failed", "cancelled", "step_limit"}:
                raise ValueError("only a settled failed child task can be retried")
            prompt = str(child.get("last_turn_prompt") or "").strip()
            if not prompt:
                raise ValueError("child task prompt is unavailable for retry")
            operation_id = str(
                child.get("operation_id") or f"child:{child_thread_id}"
            )
            attempt = int(child.get("operation_attempt") or 1) + 1
            client = await self.get_client_for_thread(child_thread_id, resolved_project_id)
            retry_kwargs: dict[str, Any] = {
                "prompt": prompt,
                "mode": "start",
                "thread_id": child_thread_id,
                "effort": self.get_settings(resolved_project_id).get(
                    "reasoning_effort", "high"
                ),
                "operation_id": operation_id,
                "operation_attempt": attempt,
            }
            if (
                child.get("operation_group_id")
                or child.get("execution_mode") != "parallel"
                or child.get("group_sequence") is not None
            ):
                retry_kwargs.update(
                    {
                        "operation_group_id": child.get("operation_group_id"),
                        "execution_mode": child.get("execution_mode") or "parallel",
                        "group_sequence": child.get("group_sequence"),
                    }
                )
            submission = await client.start_turn(**retry_kwargs)
            turn_id = str(getattr(submission, "turn_id", None) or "")
            if turn_id:
                task = asyncio.create_task(
                    self._wait_for_child_turn(
                        client,
                        child_thread_id,
                        resolved_project_id,
                        turn_id,
                        source_thread_id,
                    )
                )
                self.set_active_turn(child_thread_id, turn_id, task, resolved_project_id)
            return {
                **child,
                "operation_id": operation_id,
                "operation_attempt": attempt,
                "turn_id": turn_id or None,
                "status": "running" if turn_id else "not_started",
            }

    async def list_child_tasks(
        self, source_thread_id: str, project_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Project child Sessions and live runtime status for one parent."""
        source_thread_id = source_thread_id or "default"
        resolved_project_id = self.resolve_thread_project(
            source_thread_id, project_id
        )
        parent = self._canonical_thread(source_thread_id, resolved_project_id)
        if not parent:
            raise KeyError(f"Thread '{source_thread_id}' not found")
        parent_session_id = str(parent.get("session", {}).get("session_id") or "")
        if not parent_session_id:
            return []

        children: list[dict[str, Any]] = []
        for session in self.list_project_sessions(resolved_project_id, limit=128)[
            "data"
        ]:
            if session.get("parent_session_id") != parent_session_id:
                continue
            child_thread_id = str(session.get("thread_id") or "")
            if not child_thread_id:
                continue
            active_turn_id = session.get("active_turn_id")
            persisted_status = session.get("operation_status")
            status = persisted_status or (
                "running" if session.get("turn_active") else (
                    session.get("last_turn_status") or "idle"
                )
            )
            operation_id = session.get("operation_id")
            phase = None
            client = self._project_clients.get(
                (resolved_project_id, child_thread_id)
            )
            if client is not None:
                try:
                    runtime = await client.get_runtime_status(child_thread_id)
                    active_turn_id = runtime.turn_id or active_turn_id
                    operation_id = operation_id or runtime.operation_id
                    phase = runtime.phase
                    if runtime.phase == "waiting_approval":
                        status = "awaiting_approval"
                    elif runtime.phase not in (None, "idle") and status not in {
                        "completed",
                        "failed",
                        "cancelled",
                    }:
                        status = "running"
                except Exception:
                    logger.debug(
                        "Unable to read child runtime %s", child_thread_id, exc_info=True
                    )
            children.append(
                {
                    "parent_thread_id": source_thread_id,
                    "child_thread_id": child_thread_id,
                    "project": resolved_project_id,
                    "session_id": session.get("session_id"),
                    "parent_session_id": parent_session_id,
                    "parent_checkpoint_seq": session.get("parent_checkpoint_seq"),
                    "title": self.get_thread_meta(
                        child_thread_id, resolved_project_id
                    ).get("title"),
                    "status": status,
                    "phase": phase,
                    "turn_id": active_turn_id,
                    "operation_id": operation_id,
                    "operation_attempt": session.get("operation_attempt") or 1,
                    "operation_group_id": session.get("operation_group_id"),
                    "execution_mode": session.get("execution_mode") or "parallel",
                    "group_sequence": session.get("group_sequence"),
                    "operation_prompt": session.get("operation_prompt"),
                    "operation_result": session.get("operation_result"),
                    "operation_error": session.get("operation_error"),
                    "recovery_required": status
                    in {"queued", "running", "awaiting_approval"}
                    and not session.get("process_online", False)
                    and client is None,
                    "last_turn_status": session.get("last_turn_status"),
                    "last_turn_error": session.get("last_turn_error"),
                    "last_turn_prompt": session.get("summary"),
                }
            )
        return children

    async def start_thread(
        self, thread_id: str = "default", project_id: str | None = None
    ) -> str:
        return await self._client_pool.start_thread(thread_id, project_id)

    async def attach_thread(
        self, thread_id: str = "default", project_id: str | None = None
    ) -> dict[str, Any]:
        return await self._client_pool.attach_thread(thread_id, project_id)

    async def start(self) -> None:
        """Start and initialize the background MiniAgentClient."""
        async with self._lock:
            current_project_id = self._current_project_id
            current_default = self._project_clients.get((current_project_id, "default"))
            if current_default is not None:
                self._client = current_default
                self._activate_thread_client(
                    "default", current_project_id, current_default
                )
                self._initialized = True
                return
            self._client = None
            canonical = self.read_project_thread("default")
            session = canonical.get("session") if canonical else None
            if session and session.get("session_status") == "locked":
                # A process restart must not create a fresh default Session just
                # because the previous gateway process still owns the lock. Keep
                # the catalog available in read-only mode and let an explicit
                # attach retry once the external process exits.
                self._active_thread_projects["default"] = self._current_project_id
                self._initialized = True
                logger.info(
                    "Default Session is locked by another process; starting Gateway in read-only mode"
                )
                return
            reusable_session = session
            self._client = await self._create_client(
                "default",
                self._projects_registry[self._current_project_id],
                "resume" if reusable_session else "new",
                session.get("session_id") if reusable_session else None,
            )
            self._activate_thread_client(
                "default", self._current_project_id, self._client
            )
            self._initialized = True

    async def restart_for_current_project(self) -> None:
        """Restart the current Project runtime without touching other Projects."""
        await self.restart_for_project(self._current_project_id)

    async def restart_for_project(self, project_id: str) -> None:
        """Restart one Project runtime without touching other Projects."""
        await self.cancel_pending_approvals(
            project_id=project_id,
            reason="项目运行时即将重启，审批已失效",
        )
        async with self._lock:
            active_keys = {
                *(key for key in self._active_turns_by_project if key[0] == project_id),
                *(key for key in self._active_tasks_by_project if key[0] == project_id),
            }
            if active_keys:
                active_threads = ", ".join(
                    sorted(thread_id for _, thread_id in active_keys)
                )
                raise RuntimeError(
                    f"Project '{project_id}' has active Turn(s): {active_threads}"
                )

            current_default_project = self._client_projects.get("default")
            clients: list[MiniAgentClient] = []
            for (bound_project, thread_id), client in list(
                self._project_clients.items()
            ):
                if bound_project != project_id:
                    continue
                if client not in clients:
                    clients.append(client)
                self._project_clients.pop((bound_project, thread_id), None)
                if self._clients.get(thread_id) is client:
                    self._clients.pop(thread_id, None)
                if self._client_projects.get(thread_id) == project_id:
                    self._client_projects.pop(thread_id, None)
                if self._active_thread_projects.get(thread_id) == project_id:
                    self._active_thread_projects.pop(thread_id, None)
                    self._active_turns.pop(thread_id, None)
                    self._active_tasks.pop(thread_id, None)

            # Older callers/tests may only have populated the compatibility
            # view. Remove those bindings too, without touching other Projects.
            for thread_id, client in list(self._clients.items()):
                if self._client_projects.get(thread_id) != project_id:
                    continue
                if client not in clients:
                    clients.append(client)
                self._clients.pop(thread_id, None)
                self._client_projects.pop(thread_id, None)
                if self._active_thread_projects.get(thread_id) == project_id:
                    self._active_thread_projects.pop(thread_id, None)
                    self._active_turns.pop(thread_id, None)
                    self._active_tasks.pop(thread_id, None)

            for thread_id, bound_project in list(self._client_projects.items()):
                if bound_project == project_id:
                    self._client_projects.pop(thread_id, None)
                    if self._active_thread_projects.get(thread_id) == project_id:
                        self._active_thread_projects.pop(thread_id, None)

            for key in list(self._active_tasks_by_project):
                if key[0] == project_id:
                    self._active_tasks_by_project.pop(key, None)
                    self._active_turns_by_project.pop(key, None)
            for thread_id, bound_project in list(self._active_thread_projects.items()):
                if bound_project == project_id:
                    self._active_thread_projects.pop(thread_id, None)

            if current_default_project == project_id:
                self._client = None
                self._initialized = False
        for client in set(clients):
            await client.stop()
        if project_id == self._current_project_id:
            await self.start()
        else:
            await self._client_pool.get_client_for_project(project_id)
        self._runtime_generation += 1
        await self.broadcast_ws(
            {
                "type": "notification",
                "method": "gateway/runtime/restarted",
                "data": {
                    "projectId": project_id,
                    "runtimeGeneration": self._runtime_generation,
                },
            }
        )

    async def stop(self) -> None:
        """Stop the background MiniAgentClient and close WebSocket connections."""
        async with self._lock:
            # 1. Gracefully close active WebSocket connections
            for ws in list(self._active_connections):
                try:
                    await ws.close(code=1001, reason="Server shutting down")
                except Exception:  # noqa: BLE001, S110
                    pass
            self._active_connections.clear()

            # 2. Cancel any pending approval futures
            for fut in self._pending_approvals.values():
                if not fut.done():
                    fut.cancel()
            self._pending_approvals.clear()
            self._pending_approval_details.clear()

            # 3. Stop Gateway-owned stream tasks before terminating clients.
            tasks: list[asyncio.Task[Any]] = []
            seen_tasks: set[int] = set()
            for task in [
                *self._active_tasks.values(),
                *self._active_tasks_by_project.values(),
            ]:
                if id(task) in seen_tasks:
                    continue
                seen_tasks.add(id(task))
                tasks.append(task)
                if not task.done():
                    task.cancel()

            # 4. Terminate all per-session App Server processes
            clients = self._all_clients()
            self._clients.clear()
            self._client_projects.clear()
            self._project_clients.clear()
            self._active_thread_projects.clear()
            self._active_tasks.clear()
            self._active_turns.clear()
            self._active_tasks_by_project.clear()
            self._active_turns_by_project.clear()
            self._client = None
            for client in set(clients):
                try:
                    await asyncio.wait_for(client.stop(), timeout=3.0)
                except asyncio.TimeoutError:
                    pass
                except Exception:  # noqa: BLE001, S110
                    pass
            self._initialized = False
            logger.info("MiniAgentClient processes terminated cleanly.")
        for task in tasks:
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=0.5)
            except asyncio.CancelledError:
                pass
            except asyncio.TimeoutError:
                pass
            except Exception:  # noqa: BLE001, S110
                pass

    # -------------------------------------------------------------------------
    # Thread Metadata Management

    def _metadata_project_id(
        self, thread_id: str, project_id: str | None = None
    ) -> str:
        return self._thread_registry.metadata_project_id(thread_id, project_id)

    def get_thread_meta(
        self, thread_id: str, project_id: str | None = None
    ) -> dict[str, Any]:
        """Get metadata for a project-qualified thread."""
        return self._thread_registry.get_thread_meta(thread_id, project_id)

    def set_thread_meta(
        self, thread_id: str, updates: dict[str, Any], project_id: str | None = None
    ) -> dict[str, Any]:
        """Update metadata for a thread."""
        return self._thread_registry.set_thread_meta(thread_id, updates, project_id)

    def list_all_thread_meta(self) -> dict[str, dict[str, Any]]:
        return self._thread_registry.list_all_thread_meta()

    def list_project_sessions(
        self, project_id: str | None = None, limit: int = 64, cursor: str | None = None
    ) -> dict[str, Any]:
        """Read the canonical SessionStore projection for one registered Project."""
        return self._thread_registry.list_project_sessions(project_id, limit, cursor)

    def list_all_project_sessions(self, limit: int = 128) -> list[dict[str, Any]]:
        """Return a bounded cross-project SessionStore view for the sidebar."""
        return self._thread_registry.list_all_project_sessions(limit)

    def read_project_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> dict[str, Any] | None:
        """Read a settled Thread projection without creating a Web checkpoint."""
        return self._thread_registry.read_project_thread(thread_id, project_id)

    def read_any_project_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> dict[str, Any] | None:
        """Find one canonical SessionStore thread without changing the active Project."""
        return self._thread_registry.read_any_project_thread(thread_id, project_id)

    def read_thread_notebook(
        self,
        thread_id: str,
        project_id: str | None = None,
        scope: str = "self",
    ) -> dict[str, Any] | None:
        resolved_project_id = self.resolve_thread_project(thread_id, project_id)
        project = self._projects_registry.get(resolved_project_id)
        if not project:
            return None
        return session_catalog.read_notebook(
            Path(project["primary_path"]), resolved_project_id, thread_id, scope
        )

    async def write_thread_notebook(
        self,
        thread_id: str,
        key: str,
        content: str,
        append: bool = False,
        importance: str = "normal",
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Write only the current Thread notebook through its runtime authority."""
        resolved_project_id = self.resolve_thread_project(thread_id, project_id)
        client = await self.get_client_for_thread(thread_id, resolved_project_id)
        return await client.write_notebook(
            key=key,
            content=content,
            append=append,
            importance=importance,
            thread_id=thread_id,
        )

    async def forget_thread_notebook(
        self,
        thread_id: str,
        key: str,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        """Forget only the current Thread notebook through its runtime authority."""
        resolved_project_id = self.resolve_thread_project(thread_id, project_id)
        client = await self.get_client_for_thread(thread_id, resolved_project_id)
        return await client.forget_notebook(key=key, thread_id=thread_id)

    def session_path_for_thread(
        self, thread_id: str, project_id: str | None = None
    ) -> Path | None:
        """Resolve a Thread to its canonical Session directory for read-only artifacts."""
        return self._thread_registry.session_path_for_thread(thread_id, project_id)

    def attachments_path_for_thread(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> Path:
        """Return the Gateway-owned, read-only attachment root for one Thread.

        Uploaded bytes are Gateway state, not workspace content. Hashing the
        identities keeps user-controlled project and thread values out of the
        filesystem path while retaining a stable per-Project/per-Thread scope.
        """
        target_thread = thread_id or "default"
        project = self._project_for_thread(target_thread, project_id)
        candidate = (
            self._state_dir.resolve()
            / "attachments"
            / _attachment_storage_key(
                str(project.get("id") or project_id or self._current_project_id)
            )
            / _attachment_storage_key(target_thread)
        )
        project_roots: list[Path] = []
        for registered_project in self._projects_registry.values():
            primary_path = registered_project.get("primary_path")
            if primary_path:
                project_roots.append(Path(str(primary_path)).resolve())
            for folder in registered_project.get("source_folders") or []:
                raw_path = folder.get("path") if isinstance(folder, dict) else None
                if raw_path:
                    project_roots.append(Path(str(raw_path)).resolve())
        project_roots.append(Path(project["primary_path"]).resolve())
        if not any(candidate.is_relative_to(root) for root in project_roots):
            return candidate
        raise RuntimeError(
            "MINI_AGENT_WEB_STATE_DIR must not be inside a Project workspace; "
            "refusing to store an uploaded attachment there"
        )

    def project_path_for_thread(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> Path:
        """Resolve the active Thread's Project workspace for file inspection."""
        return self._thread_registry.project_path_for_thread(thread_id, project_id)

    # Settings Management
    # -------------------------------------------------------------------------

    def get_settings(self, project_id: str | None = None) -> dict[str, Any]:
        """Get current server & UI settings."""
        project = self._projects_registry.get(
            project_id or self._current_project_id, {}
        )
        subagent = dict(self._settings.get("subagent") or {})
        project_subagent = project.get("subagent")
        if isinstance(project_subagent, dict):
            subagent.update(project_subagent)
        try:
            max_children = int(
                subagent.get("max_concurrent_children", MAX_CHILD_TASKS_PER_PARENT)
            )
        except (TypeError, ValueError):
            max_children = MAX_CHILD_TASKS_PER_PARENT
        mode = subagent.get("default_execution_mode", "parallel")
        if mode not in {"parallel", "sequential"}:
            mode = "parallel"
        subagent = {
            "max_concurrent_children": max(
                1, min(max_children, MAX_CONFIGURED_CHILD_TASKS_PER_PARENT)
            ),
            "default_execution_mode": mode,
        }
        return {
            **self._settings,
            "subagent": subagent,
            "access": project.get("access", "project"),
            "policy": project.get("policy", "interactive"),
        }

    def project_execution(self, project_id: str | None = None) -> tuple[str, str]:
        project = self._projects_registry.get(
            project_id or self._current_project_id, {}
        )
        return (
            str(project.get("access", "project")),
            str(project.get("policy", "interactive")),
        )

    def project_has_active_turn(self, project_id: str) -> bool:
        """Return whether a project currently owns a running turn/task."""
        return any(key[0] == project_id for key in self._active_turns_by_project) or any(
            key[0] == project_id for key in self._active_tasks_by_project
        )

    def project_has_pending_approval(self, project_id: str) -> bool:
        """Return whether a project has an approval wait that must not be orphaned."""
        return any(
            details.get("projectId") == project_id
            for details in self._pending_approval_details.values()
        )

    def set_project_execution(
        self, access: str, policy: str, project_id: str | None = None
    ) -> None:
        if access not in ("project", "full_machine"):
            raise ValueError("invalid access scope")
        if policy not in ("interactive", "automatic", "trusted"):
            raise ValueError("invalid execution policy")
        project = self._projects_registry[project_id or self._current_project_id]
        project["access"] = access
        project["policy"] = policy
        self._save_projects()

    async def update_project_execution(
        self,
        access: str,
        policy: str,
        project_id: str | None = None,
        primary_client: Any | None = None,
    ) -> Any:
        """Persist and fan out Project execution settings to every live Client."""
        resolved_project_id = project_id or self._current_project_id
        active_keys = {
            *(
                key
                for key in self._active_turns_by_project
                if key[0] == resolved_project_id
            ),
            *(
                key
                for key in self._active_tasks_by_project
                if key[0] == resolved_project_id
            ),
        }
        if active_keys:
            active_threads = ", ".join(
                sorted(thread_id for _, thread_id in active_keys)
            )
            raise RuntimeError(
                f"Project '{resolved_project_id}' has active Turn(s): {active_threads}"
            )

        if primary_client is None:
            primary_client = await self.get_client_for_project(resolved_project_id)
        self.set_project_execution(access, policy, resolved_project_id)
        async with self._lock:
            clients: list[Any] = []
            seen: set[int] = set()

            def add_client(client: Any | None) -> None:
                if client is None or id(client) in seen:
                    return
                seen.add(id(client))
                clients.append(client)

            add_client(primary_client)
            for (bound_project, _thread_id), client in self._project_clients.items():
                if bound_project == resolved_project_id:
                    add_client(client)
            for thread_id, client in self._clients.items():
                if self._client_projects.get(thread_id) == resolved_project_id:
                    add_client(client)

        if not clients:
            return None
        results = await asyncio.gather(
            *(
                client.set_world_execution(access=access, policy=policy)
                for client in clients
            )
        )
        return results[0]

    async def _apply_persisted_thread_continuation(
        self,
        thread_id: str,
        client: Any,
        project_id: str | None = None,
    ) -> bool:
        """Apply canonical SessionStore preference after client startup."""
        canonical = (
            self.read_project_thread(thread_id, project_id)
            if project_id
            else self.read_any_project_thread(thread_id)
        )
        session = canonical.get("session", {}) if canonical else {}
        if session.get("continuation_mode") != "continuous":
            return False
        goal = session.get("goal")
        if isinstance(goal, dict) and goal.get("status") in ("active", "running"):
            logger.info(
                "Deferring continuous continuation for active Goal thread %s",
                thread_id,
            )
            return False
        await client.update_thread_settings(
            mode="plan" if session.get("plan_active") else "default",
            continuation_mode="continuous",
            thread_id=thread_id,
        )
        return True

    def update_settings(self, updates: dict[str, Any]) -> dict[str, Any]:
        """Update system settings."""
        if isinstance(updates.get("subagent"), dict):
            incoming = updates["subagent"]
            try:
                max_children = int(
                    incoming.get(
                        "max_concurrent_children", MAX_CHILD_TASKS_PER_PARENT
                    )
                )
            except (TypeError, ValueError) as error:
                raise ValueError("invalid subagent concurrency") from error
            mode = incoming.get("default_execution_mode", "parallel")
            if not 1 <= max_children <= MAX_CONFIGURED_CHILD_TASKS_PER_PARENT:
                raise ValueError(
                    f"subagent concurrency must be between 1 and {MAX_CONFIGURED_CHILD_TASKS_PER_PARENT}"
                )
            if mode not in {"parallel", "sequential"}:
                raise ValueError("subagent execution mode must be parallel or sequential")
            updates = {
                **updates,
                "subagent": {
                    "max_concurrent_children": max_children,
                    "default_execution_mode": mode,
                },
            }
        self._settings.update(updates)
        self._save_settings()
        logger.info("Updated system settings: %s", updates)
        return dict(self._settings)

    # -------------------------------------------------------------------------
    # Approval Handshake Management
    # -------------------------------------------------------------------------

    @staticmethod
    def _approval_identity(
        details: dict[str, Any],
    ) -> tuple[str | None, str | None, str | None]:
        return ApprovalBridge.approval_identity(details)

    @staticmethod
    def _turn_identity(
        project_id: str | None, thread_id: str | None, turn_id: str | None
    ) -> tuple[str, str, str] | None:
        return ApprovalBridge.turn_identity(project_id, thread_id, turn_id)

    def mark_turn_interrupted(
        self,
        thread_id: str | None,
        turn_id: str | None,
        project_id: str | None = None,
    ) -> None:
        """Remember a stopped Turn so late approval requests are denied."""
        self._approval_bridge.mark_turn_interrupted(thread_id, turn_id, project_id)

    def is_turn_interrupted(
        self,
        thread_id: str | None,
        turn_id: str | None,
        project_id: str | None = None,
    ) -> bool:
        return self._approval_bridge.is_turn_interrupted(thread_id, turn_id, project_id)

    async def cancel_pending_approvals(
        self,
        project_id: str | None = None,
        thread_id: str | None = None,
        turn_id: str | None = None,
        runtime_id: str | None = None,
        reason: str = "当前 Turn 已停止，审批已失效",
    ) -> int:
        """Deny and remove approval waits matching one runtime/Turn identity."""
        return await self._approval_bridge.cancel_pending_approvals(
            project_id, thread_id, turn_id, runtime_id, reason
        )

    async def _handle_approval_request(
        self,
        req: dict[str, Any],
        project_id: str | None = None,
        thread_id: str | None = None,
        runtime_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Called asynchronously by MiniAgentClient when the App Server encounters
        a sensitive tool invocation requiring human approval.
        """
        return await self._approval_bridge.handle_approval_request(
            req, project_id, thread_id, runtime_id
        )

    async def _handle_runtime_notification(
        self, notification: dict[str, Any], project_id: str | None = None
    ) -> None:
        """Relay every App Server notification with its project context."""
        payload = dict(notification)
        if project_id:
            payload.setdefault("projectId", project_id)
            data = payload.get("data")
            if isinstance(data, dict):
                payload["data"] = {
                    **data,
                    "projectId": data.get("projectId", project_id),
                }
        if payload.get("type") == "runtime_error":
            data = payload.get("data", {})
            thread_id = str(
                payload.get("threadId")
                or payload.get("thread_id")
                or (data.get("threadId") if isinstance(data, dict) else "")
                or (data.get("thread_id") if isinstance(data, dict) else "")
                or ""
            )
            runtime_id = payload.get("_runtimeId")
            runtime_error = {
                "type": "error",
                "scope": "runtime",
                "terminal": False,
                "threadId": thread_id or None,
                "projectId": project_id,
                "message": payload.get("message") or "运行时连接已断开",
            }
            await self.broadcast_ws(runtime_error)

            # An App Server EOF also invalidates approval requests that were
            # waiting inside that process. Resolve them as denied so the
            # Gateway does not retain a dead request for the full timeout.
            await self.cancel_pending_approvals(
                project_id=project_id,
                thread_id=thread_id or None,
                runtime_id=runtime_id,
                reason="运行时连接已断开",
            )
            return
        if payload.get("type") == "event":
            self._schedule_delegated_child(payload, project_id)
        await self.broadcast_ws(payload)
        if payload.get("type") == "event":
            return
        if payload.get("method") != "thread/goal/updated":
            return
        data = payload.get("data", {})
        goal = data.get("goal") if isinstance(data, dict) else None
        if not isinstance(goal, dict) or goal.get("status") in ("active", "running"):
            return
        thread_id = str(data.get("threadId") or "")
        client = (
            self._project_clients.get((project_id, thread_id))
            if project_id
            else self._clients.get(thread_id)
        )
        if not thread_id or client is None:
            return
        try:
            await self._apply_persisted_thread_continuation(thread_id, client)
        except Exception as err:  # noqa: BLE001
            logger.warning(
                "Failed to restore continuation after Goal settlement for %s: %s",
                thread_id,
                err,
            )

    def _schedule_delegated_child(
        self, payload: dict[str, Any], project_id: str | None
    ) -> None:
        event = payload.get("event")
        if not isinstance(event, dict) or event.get("type") != "tool_started":
            return
        call = event.get("call")
        if not isinstance(call, dict) or call.get("name") != "delegate_task":
            return
        arguments = call.get("arguments")
        if not isinstance(arguments, dict):
            return
        parent_thread_id = str(payload.get("threadId") or "")
        child_thread_id = arguments.get("child_thread_id")
        prompt = arguments.get("prompt")
        if not parent_thread_id or not isinstance(child_thread_id, str) or not isinstance(
            prompt, str
        ):
            return
        asyncio.create_task(
            self._start_delegated_child(
                parent_thread_id,
                child_thread_id,
                prompt,
                arguments.get("title"),
                project_id,
            )
        )

    async def _start_delegated_child(
        self,
        parent_thread_id: str,
        child_thread_id: str,
        prompt: str,
        title: Any,
        project_id: str | None,
    ) -> None:
        try:
            await self.start_child_task(
                parent_thread_id,
                child_thread_id,
                prompt,
                title if isinstance(title, str) else None,
                project_id,
            )
        except Exception:
            logger.exception(
                "Unable to start delegated child %s from %s",
                child_thread_id,
                parent_thread_id,
            )

    def resolve_approval(
        self,
        request_id: str,
        decision: str,
        grant_scope: str | None,
        reason: str | None = None,
        project_id: str | None = None,
        thread_id: str | None = None,
        turn_id: str | None = None,
        call_id: str | None = None,
    ) -> bool:
        """Resolve a pending approval; grant authority remains in Host/Capabilities."""
        return self._approval_bridge.resolve_approval(
            request_id,
            decision,
            grant_scope,
            reason,
            project_id,
            thread_id,
            turn_id,
            call_id,
        )

    async def broadcast_approval_resolution(
        self,
        request_id: str,
        decision: str,
        grant_scope: str | None,
        reason: str | None = None,
        call_id: str | None = None,
        project_id: str | None = None,
        thread_id: str | None = None,
        turn_id: str | None = None,
    ) -> bool:
        """Broadcast an accepted approval decision to every scoped Studio client.

        The App Server normally emits its own ``approval/resolved`` notification
        after receiving the response. The Gateway sends this bounded resolution
        immediately as well, so a second browser can close a stale approval dock
        without waiting for the tool runtime to reach its next notification.
        """
        return await self._approval_bridge.broadcast_approval_resolution(
            request_id,
            decision,
            grant_scope,
            reason,
            call_id,
            project_id,
            thread_id,
            turn_id,
        )

    def list_pending_approvals(
        self,
        project_id: str | None = None,
        thread_id: str | None = None,
    ) -> list[str]:
        return self._approval_bridge.list_pending_approvals(project_id, thread_id)

    def approval_snapshot(
        self,
        project_id: str | None = None,
        thread_id: str | None = None,
    ) -> dict[str, Any]:
        """Expose project policy and pending requests without exposing grants."""
        return self._approval_bridge.approval_snapshot(project_id, thread_id)

    async def revoke_current_project_approvals(
        self, project_id: str | None = None
    ) -> dict[str, Any]:
        """Restart the project-bound App Server; Host/Capabilities revoke grants."""
        return await self._approval_bridge.revoke_current_project_approvals(project_id)

    # -------------------------------------------------------------------------
    # WebSocket Connection Management
    # -------------------------------------------------------------------------

    async def connect_ws(
        self, websocket: WebSocket, project_id: str | None = None
    ) -> None:
        await self._ws_broker.connect(websocket, project_id)

    def set_ws_project(self, websocket: WebSocket, project_id: str | None) -> None:
        self._ws_broker.set_project(websocket, project_id)

    def disconnect_ws(self, websocket: WebSocket) -> None:
        self._ws_broker.disconnect(websocket)

    async def broadcast_ws(self, message: dict[str, Any]) -> None:
        await self._ws_broker.broadcast(message)

    # -------------------------------------------------------------------------
    # Active Turn & Stream Task Tracking
    # -------------------------------------------------------------------------

    def set_active_turn(
        self,
        thread_id: str,
        turn_id: str,
        task: asyncio.Task[Any] | None = None,
        project_id: str | None = None,
    ) -> None:
        """Track active turn ID and optional streaming task for responsive interrupts."""
        self._turn_registry.set_active_turn(thread_id, turn_id, task, project_id)

    def clear_active_turn(
        self,
        thread_id: str,
        project_id: str | None = None,
        turn_id: str | None = None,
        task: asyncio.Task[Any] | None = None,
    ) -> None:
        """Clear active turn tracking upon turn settlement."""
        self._turn_registry.clear_active_turn(thread_id, project_id, turn_id, task)

    def get_active_turn(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> str | None:
        """Retrieve current active turn ID for thread."""
        return self._turn_registry.get_active_turn(thread_id, project_id)

    def cancel_active_task(
        self, thread_id: str | None = None, project_id: str | None = None
    ) -> None:
        """Cancel background stream tasks for thread or all threads."""
        self._turn_registry.cancel_active_task(thread_id, project_id)


# Global singleton instance
session_manager = SessionManager()
