"""
Session and Client Pool Manager.
Manages the MiniAgentClient instance, approval callbacks, WebSocket/SSE broadcasting,
thread metadata caching (titles, summaries), and runtime user settings.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
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
from server.persistence import atomic_write_json, to_json_serializable
from server.session_catalog import session_catalog

logger = logging.getLogger("mini_agent.server")

MAX_INTERRUPTED_TURNS = 256
MAX_CHILD_TASKS_PER_PARENT = 2
MAX_CONFIGURED_CHILD_TASKS_PER_PARENT = 8
MAX_CHILD_TASK_PROMPT_BYTES = 32 * 1024
MAX_CHILD_TASK_LIFECYCLE = 32
MAX_CHILD_CONTROL_WAKE_EVENTS = 8
MAX_CHILD_CONTROL_WAKE_IDS = 8
MAX_CHILD_CONTROL_WAKE_CHILD_IDS = 16
MAX_CHILD_WAKE_PENDING_CHILDREN = 64
MAX_CHILD_WAKE_BATCH_CHILDREN = 16
MAX_CHILD_WAKE_OVERFLOW_SAMPLE = 8
MAX_DELEGATION_FAILURES_PER_PARENT = 32
MAX_NOTEBOOK_ENTRIES = 64
MAX_NOTEBOOK_ENTRY_BYTES = 4096
__all__ = ["SessionManager", "session_manager", "to_json_serializable"]


def _attachment_storage_key(value: str) -> str:
    """Create a bounded, stable filesystem key for a Project or Thread identity."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]


def _nonnegative_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return max(0, int(value))
    return 0


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
        self._delegation_receipts_path = self._state_dir / "delegation_receipts.json"
        self._delegation_receipts: dict[str, dict[str, Any]] = {}

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
        self._child_wake_jobs: dict[tuple[str, str], asyncio.Task[Any]] = {}
        self._child_wake_pending: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
        self._turn_start_locks: OrderedDict[tuple[str, str], asyncio.Lock] = (
            OrderedDict()
        )
        self._child_wake_deferred: set[tuple[str, str]] = set()
        self._child_wake_seen: OrderedDict[tuple[str, str, str, str], None] = (
            OrderedDict()
        )
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
            },
            "notebook": {
                "max_entries": MAX_NOTEBOOK_ENTRIES,
                "max_entry_bytes": MAX_NOTEBOOK_ENTRY_BYTES,
            },
        }

        # Load persisted state or initialize clean default with only the active workspace
        self._load_state()
        self._load_delegation_receipts()

    def _load_delegation_receipts(self) -> None:
        """Load bounded delegation intents used to recover an async crash window."""
        self._delegation_receipts_path = self._state_dir / "delegation_receipts.json"
        try:
            raw = json.loads(self._delegation_receipts_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            return
        if not isinstance(raw, dict):
            return
        self._delegation_receipts = {
            str(key): dict(value)
            for key, value in list(raw.items())[-256:]
            if isinstance(value, dict)
        }

    def _save_delegation_receipts(self) -> None:
        self._delegation_receipts_path = self._state_dir / "delegation_receipts.json"
        atomic_write_json(
            self._delegation_receipts_path,
            {
                key: value
                for key, value in list(self._delegation_receipts.items())[-256:]
            },
        )

    def _record_delegation_receipt(
        self, key: str, payload: dict[str, Any], status: str = "pending"
    ) -> dict[str, Any]:
        receipt = {
            **payload,
            "timestamp_ms": _nonnegative_int(payload.get("timestamp_ms"))
            or int(time.time() * 1000),
            "status": status,
            "receipt_key": key,
        }
        self._delegation_receipts[key] = receipt
        self._save_delegation_receipts()
        return receipt

    def _update_delegation_receipt(
        self, key: str, status: str, *, error: str | None = None
    ) -> None:
        receipt = self._delegation_receipts.get(key)
        if receipt is None:
            return
        receipt["status"] = status
        updated_at_ms = int(time.time() * 1000)
        receipt["updated_at_ms"] = updated_at_ms
        if status == "failed":
            receipt["failed_at_ms"] = updated_at_ms
            if error:
                receipt["error"] = error[:2048]
        self._save_delegation_receipts()

    async def _broadcast_child_operation(
        self, child: dict[str, Any], status: str | None = None
    ) -> None:
        """Publish only the bounded parent projection of a Child operation."""
        child_status = status or child.get("status")
        lifecycle = child.get("lifecycle")
        if not isinstance(lifecycle, list):
            lifecycle = []
        parent_thread_id = child.get("parent_thread_id")
        project_id = child.get("project")
        child_thread_id = child.get("child_thread_id")
        parent_turn_id = child.get("parent_turn_id")
        if (
            not parent_turn_id
            and isinstance(parent_thread_id, str)
            and isinstance(project_id, str)
            and isinstance(child_thread_id, str)
        ):
            parent_turn_id = self._delegated_child_parent_turn_id(
                parent_thread_id, project_id, child_thread_id
            )
        await self.broadcast_ws(
            {
                "type": "child_operation_updated",
                "threadId": parent_thread_id,
                "projectId": project_id,
                "data": {
                    "operation_id": child.get("operation_id"),
                    "child_thread_id": child_thread_id,
                    "project_id": project_id,
                    "title": child.get("title"),
                    "status": child_status,
                    "execution_mode": child.get("execution_mode"),
                    "operation_group_id": child.get("operation_group_id"),
                    "group_sequence": child.get("group_sequence"),
                    "parent_turn_id": parent_turn_id,
                    "child_session_available": bool(
                        child.get("child_session_available")
                        or child.get("session_id")
                        or child.get("session")
                    ),
                    "lifecycle": lifecycle[-MAX_CHILD_TASK_LIFECYCLE:],
                    "started_at_ms": child.get("started_at_ms"),
                    "finished_at_ms": child.get("finished_at_ms"),
                    "duration_ms": child.get("duration_ms"),
                    "error": str(child.get("operation_error") or "")[:2048] or None,
                    "error_code": "child_operation_failed"
                    if child_status == "failed"
                    else None,
                },
            }
        )

    def _set_state_paths(self, base_dir: Path) -> None:
        """Configure directory layout for state persistence."""
        self._delegation_receipts_path = base_dir / "delegation_receipts.json"
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

    async def get_background_task_target(
        self, thread_id: str, project_id: str | None = None
    ) -> tuple[MiniAgentClient, str, bool]:
        """Resolve the owner runtime for a background Shell read/control.

        Child Sessions expose their parent's task list read-only. The Gateway
        resolves that lineage from the canonical SessionStore projection and
        forwards to the parent's client; it does not keep a process registry.
        """
        resolved_project_id = self.resolve_thread_project(thread_id, project_id)
        canonical = self._canonical_thread(thread_id, resolved_project_id)
        session = (canonical or {}).get("session") or {}
        parent_session_id = session.get("parent_session_id")
        if parent_session_id:
            parent = next(
                (
                    item
                    for item in self.list_project_sessions(
                        resolved_project_id, limit=128
                    )["data"]
                    if item.get("session_id") == parent_session_id
                ),
                None,
            )
            if parent and parent.get("thread_id"):
                parent_thread_id = str(parent["thread_id"])
                client = await self.get_client_for_thread(
                    parent_thread_id, resolved_project_id
                )
                return client, parent_thread_id, True
        client = await self.get_client_for_thread(thread_id, resolved_project_id)
        return client, thread_id, False

    async def get_scheduled_task_target(
        self, thread_id: str, project_id: str | None = None
    ) -> tuple[MiniAgentClient, str, bool]:
        """Resolve the owner runtime for a scheduled delay marker.

        Scheduled tasks follow the same Thread ownership boundary as local
        background Shell tasks: a Child Session may read its parent's markers,
        but only the owner runtime can cancel one.
        """
        return await self.get_background_task_target(thread_id, project_id)

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
        sequence: int | None = None,
        *,
        execution_mode: str,
        operation_attempt: int = 1,
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

        resolved_project_id = self.resolve_thread_project(source_thread_id, project_id)
        subagent = self.get_settings(resolved_project_id).get("subagent") or {}
        try:
            max_children = int(
                subagent.get("max_concurrent_children", MAX_CHILD_TASKS_PER_PARENT)
            )
        except (TypeError, ValueError):
            max_children = MAX_CHILD_TASKS_PER_PARENT
        max_children = max(1, min(max_children, MAX_CONFIGURED_CHILD_TASKS_PER_PARENT))
        group_id = group_id.strip() if group_id else None
        if group_id and len(group_id.encode("utf-8")) > 128:
            raise ValueError("child task group id is too long")
        if execution_mode not in {"parallel", "sequential"}:
            raise ValueError("child execution mode must be parallel or sequential")
        if execution_mode == "sequential" and not group_id:
            raise ValueError("sequential child tasks require a group id")
        if execution_mode == "sequential" and sequence is None:
            raise ValueError("sequential child tasks require a sequence")
        if sequence is not None and (
            isinstance(sequence, bool) or not isinstance(sequence, int)
        ):
            raise ValueError("child task sequence must be an integer")
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

            children = self.list_project_child_sessions(
                resolved_project_id, parent_session_id
            )
            active_children = sum(
                1
                for child in children
                if child.get("parent_session_id") == parent_session_id
                and child.get("is_child_task") is True
                and (
                    child.get("turn_active")
                    or (child.get("child_task_state") or {}).get("status")
                    in {"running", "awaiting_approval", "in_progress"}
                    or (
                        resolved_project_id,
                        str(child.get("thread_id") or ""),
                    )
                    in self._active_turns_by_project
                )
            )
            if self._canonical_thread(new_thread_id, resolved_project_id):
                raise RuntimeError(f"child Thread '{new_thread_id}' already exists")

            operation_id = f"child:{new_thread_id}"
            if (
                isinstance(operation_attempt, bool)
                or not isinstance(operation_attempt, int)
                or operation_attempt < 1
            ):
                raise ValueError("child task attempt must be a positive integer")
            parent_turn_id = self._delegated_child_parent_turn_id(
                source_thread_id, resolved_project_id, new_thread_id
            )
            group_scope = parent_turn_id or f"session:{parent_session_id}"

            def belongs_to_current_group(child: dict[str, Any]) -> bool:
                state = child.get("child_task_state") or {}
                child_thread_id = str(child.get("thread_id") or "")
                child_parent_turn_id = self._delegated_child_parent_turn_id(
                    source_thread_id, resolved_project_id, child_thread_id
                )
                return (
                    child.get("is_child_task") is True
                    and state.get("group_id") == group_id
                    and (child_parent_turn_id or f"session:{parent_session_id}")
                    == group_scope
                )

            same_group_children = [
                child
                for child in children
                if group_id and belongs_to_current_group(child)
            ]
            same_group_states = [
                (child.get("child_task_state") or {}) for child in same_group_children
            ]
            existing_sequences: dict[int, list[str]] = {}
            for state in same_group_states:
                existing_sequence = state.get("sequence")
                if not isinstance(existing_sequence, int) or isinstance(
                    existing_sequence, bool
                ):
                    continue
                existing_sequences.setdefault(existing_sequence, []).append(
                    str(state.get("status") or "queued")
                )

            # Failed pre-Session intents are the only task state the Gateway
            # supplements from receipts. Canonical Session operations remain the
            # source of truth for every materialized child.
            materialized_child_ids = {
                str(child.get("thread_id") or "") for child in same_group_children
            }
            for receipt in self._delegation_receipts.values():
                receipt_child_id = str(receipt.get("child_thread_id") or "")
                receipt_sequence = receipt.get("sequence")
                receipt_scope = receipt.get("parent_turn_id") or (
                    f"session:{parent_session_id}"
                )
                if (
                    receipt.get("parent_thread_id") == source_thread_id
                    and receipt.get("project_id") == resolved_project_id
                    and receipt.get("group_id") == group_id
                    and receipt.get("execution_mode") == "sequential"
                    and receipt_scope == group_scope
                    and receipt_child_id not in materialized_child_ids
                    and receipt_child_id != new_thread_id
                    and isinstance(receipt_sequence, int)
                    and not isinstance(receipt_sequence, bool)
                ):
                    existing_sequences.setdefault(receipt_sequence, []).append(
                        str(receipt.get("status") or "queued")
                    )

            if execution_mode == "sequential" and sequence in existing_sequences:
                raise ValueError(
                    f"sequential child task sequence {sequence} is already assigned"
                )

            same_group_active = any(
                child.get("turn_active")
                or (child.get("child_task_state") or {}).get("status")
                in {"running", "awaiting_approval", "in_progress"}
                or (
                    resolved_project_id,
                    str(child.get("thread_id") or ""),
                )
                in self._active_turns_by_project
                for child in same_group_children
            )
            predecessors_completed = True
            if execution_mode == "sequential" and sequence:
                predecessors_completed = len(existing_sequences) >= sequence and all(
                    existing_sequences.get(predecessor) == ["completed"]
                    for predecessor in range(sequence)
                )
            queued = active_children >= max_children or (
                execution_mode == "sequential"
                and (same_group_active or not predecessors_completed)
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
            if (
                queued
                or group_id
                or execution_mode != "parallel"
                or sequence is not None
            ):
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
                result = {
                    "parent_thread_id": source_thread_id,
                    "child_thread_id": new_thread_id,
                    "title": title or new_thread_id,
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
                await self._broadcast_child_operation(result)
                return result
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
                "title": title or new_thread_id,
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
            await self._broadcast_child_operation(result)
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
                children = await self.list_child_tasks(
                    parent_thread_id or thread_id, project_id
                )
                child = next(
                    (
                        item
                        for item in children
                        if item.get("child_thread_id") == thread_id
                    ),
                    None,
                )
                if child:
                    await self._broadcast_child_operation(child)
                    if parent_thread_id and child.get("status") in {
                        "completed",
                        "failed",
                        "cancelled",
                        "step_limit",
                    }:
                        self._queue_child_parent_wakeup(
                            parent_thread_id,
                            thread_id,
                            project_id,
                            "settled:"
                            f"{child.get('operation_id')}:{child.get('operation_attempt')}:{child.get('status')}:{child.get('finished_at_ms')}",
                            status=str(child.get("status")),
                            attempt=int(child.get("operation_attempt") or 1),
                            child_session_available=True,
                            title=str(child.get("title") or "") or None,
                        )
            except Exception:
                logger.debug(
                    "Unable to publish settled Child projection for %s",
                    thread_id,
                    exc_info=True,
                )
            try:
                await self._drain_child_queue(parent_thread_id or thread_id, project_id)
            except Exception:
                logger.exception("Unable to drain queued child tasks for %s", thread_id)

    async def _drain_child_queue(self, source_thread_id: str, project_id: str) -> None:
        """Start durable queued child operations while configured slots exist."""
        async with self._child_task_lock:
            parent = self._canonical_thread(source_thread_id, project_id)
            if not parent:
                return
            subagent = self.get_settings(project_id).get("subagent") or {}
            try:
                limit = int(
                    subagent.get("max_concurrent_children", MAX_CHILD_TASKS_PER_PARENT)
                )
            except (TypeError, ValueError):
                limit = MAX_CHILD_TASKS_PER_PARENT
            limit = max(1, min(limit, MAX_CONFIGURED_CHILD_TASKS_PER_PARENT))
            children = await self.list_child_tasks(source_thread_id, project_id)
            active = [
                child
                for child in children
                if child.get("status")
                in {"running", "awaiting_approval", "in_progress"}
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
                    mode = child.get("execution_mode")
                    if mode not in {"parallel", "sequential"}:
                        logger.warning(
                            "Skipping Child %s with missing execution mode",
                            child.get("child_thread_id"),
                        )
                        continue
                    if mode == "sequential" and group_id:
                        sequence = child.get("group_sequence")
                        if not isinstance(sequence, int) or isinstance(sequence, bool):
                            continue

                        parent_turn_id = child.get("parent_turn_id")
                        parent_session_id = str(
                            parent.get("session", {}).get("session_id") or ""
                        )
                        group_scope = parent_turn_id or f"session:{parent_session_id}"
                        siblings = [
                            item
                            for item in children
                            if item.get("operation_group_id") == group_id
                            and (
                                item.get("parent_turn_id")
                                or f"session:{parent_session_id}"
                            )
                            == group_scope
                        ]
                        if any(
                            item.get("status")
                            in {"running", "awaiting_approval", "in_progress"}
                            or (item.get("status") == "queued" and item.get("turn_id"))
                            for item in siblings
                        ):
                            continue

                        sequence_statuses: dict[int, list[str]] = {}
                        for item in siblings:
                            item_sequence = item.get("group_sequence")
                            if not isinstance(item_sequence, int) or isinstance(
                                item_sequence, bool
                            ):
                                continue
                            sequence_statuses.setdefault(item_sequence, []).append(
                                str(item.get("status") or "queued")
                            )
                        if any(
                            len(statuses) != 1
                            for statuses in sequence_statuses.values()
                        ):
                            continue
                        if len(sequence_statuses) < sequence or any(
                            sequence_statuses.get(predecessor) != ["completed"]
                            for predecessor in range(sequence)
                        ):
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
                        operation_attempt=int(candidate.get("operation_attempt") or 1),
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
                    await self._broadcast_child_operation(
                        {**candidate, "status": "running", "turn_id": started_turn_id}
                    )
                    active.append(
                        {**candidate, "turn_id": started_turn_id, "status": "running"}
                    )
                    queued.remove(candidate)
                    capacity -= 1
                except Exception:
                    logger.exception("Unable to start queued child %s", child_thread_id)
                    return

    async def reconcile_child_operations(self, project_id: str) -> None:
        """Reattach live Child Turns and drain durable queued operations."""
        sessions = self.list_project_child_sessions(project_id)
        parent_threads_by_session_id = {
            str(session.get("session_id")): str(session.get("thread_id"))
            for session in sessions
            if session.get("session_id") and session.get("thread_id")
        }
        parents: set[str] = set()
        for session in sessions:
            child_task_state = session.get("child_task_state") or {}
            parent = child_task_state.get("parent_thread_id") or (
                parent_threads_by_session_id.get(
                    str(session.get("parent_session_id") or "")
                )
            )
            status = child_task_state.get("status") or session.get("status")
            thread_id = str(session.get("thread_id") or "")
            turn_id = str(child_task_state.get("turn_id") or "")
            if (
                session.get("is_child_task") is not True
                or not isinstance(parent, str)
                or not parent
            ):
                continue
            parents.add(parent)
            if (
                status in {"running", "awaiting_approval", "in_progress"}
                and turn_id
                and (project_id, thread_id) not in self._active_turns_by_project
            ):
                try:
                    client = await self.get_client_for_thread(thread_id, project_id)
                    task = asyncio.create_task(
                        self._wait_for_child_turn(
                            client, thread_id, project_id, turn_id, parent
                        )
                    )
                    self.set_active_turn(thread_id, turn_id, task, project_id)
                except Exception:
                    logger.warning(
                        "Unable to reattach Child %s during recovery",
                        thread_id,
                        exc_info=True,
                    )
        for parent in sorted(parents):
            try:
                await self._drain_child_queue(parent, project_id)
            except Exception:
                logger.warning(
                    "Unable to reconcile queued Child operations for %s",
                    parent,
                    exc_info=True,
                )

    def _schedule_child_reconciliation(self, project_id: str) -> None:
        """Schedule recovery after the manager lock has been released."""

        async def recover() -> None:
            await self.reconcile_delegation_receipts(project_id)
            await self.reconcile_child_operations(project_id)

        asyncio.create_task(recover())

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
        unmaterialized = next(
            (
                (key, receipt)
                for key, receipt in self._delegation_receipts.items()
                if receipt.get("parent_thread_id") == source_thread_id
                and receipt.get("project_id") == resolved_project_id
                and receipt.get("child_thread_id") == child_thread_id
                and receipt.get("status") == "failed"
            ),
            None,
        )
        if unmaterialized and not self._canonical_thread(
            child_thread_id, resolved_project_id
        ):
            receipt_key, receipt = unmaterialized
            async with self._child_task_lock:
                if receipt.get("status") != "failed":
                    raise ValueError(
                        "unmaterialized child failure is no longer retryable"
                    )
                attempt = _nonnegative_int(receipt.get("operation_attempt")) + 1
                receipt["operation_attempt"] = attempt
                receipt["timestamp_ms"] = int(time.time() * 1000)
                receipt["status"] = "pending"
                receipt.pop("failed_at_ms", None)
                receipt.pop("error", None)
                self._save_delegation_receipts()
            await self._start_delegated_child(
                source_thread_id,
                child_thread_id,
                str(receipt.get("prompt") or ""),
                receipt.get("title"),
                resolved_project_id,
                receipt.get("group_id"),
                receipt.get("execution_mode"),
                receipt.get("sequence"),
                receipt_key,
            )
            return next(
                (
                    item
                    for item in await self.list_child_tasks(
                        source_thread_id, resolved_project_id
                    )
                    if item.get("child_thread_id") == child_thread_id
                ),
                {
                    "parent_thread_id": source_thread_id,
                    "child_thread_id": child_thread_id,
                    "operation_id": receipt.get("operation_id"),
                    "operation_attempt": attempt,
                    "status": "pending",
                    "child_session_available": False,
                },
            )
        async with self._child_task_lock:
            child = next(
                (
                    item
                    for item in await self.list_child_tasks(
                        source_thread_id, project_id
                    )
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
            operation_id = str(child.get("operation_id") or f"child:{child_thread_id}")
            attempt = int(child.get("operation_attempt") or 1) + 1
            client = await self.get_client_for_thread(
                child_thread_id, resolved_project_id
            )
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
                        "execution_mode": child.get("execution_mode"),
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
                self.set_active_turn(
                    child_thread_id, turn_id, task, resolved_project_id
                )
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
        resolved_project_id = self.resolve_thread_project(source_thread_id, project_id)
        parent = self._canonical_thread(source_thread_id, resolved_project_id)
        if not parent:
            raise KeyError(f"Thread '{source_thread_id}' not found")
        parent_session_id = str(parent.get("session", {}).get("session_id") or "")
        if not parent_session_id:
            return []

        children: list[dict[str, Any]] = []
        sessions = self.list_project_child_sessions(
            resolved_project_id, parent_session_id
        )
        child_thread_ids: set[str] = set()
        for session in sessions:
            child_thread_id = str(session.get("thread_id") or "")
            if not child_thread_id:
                continue
            child_thread_ids.add(child_thread_id)
            child_task_state = session.get("child_task_state") or {}
            active_turn_id = session.get("active_turn_id") or child_task_state.get(
                "turn_id"
            )
            persisted_status = child_task_state.get("status")
            status = persisted_status or (
                "running"
                if session.get("turn_active")
                else (session.get("last_turn_status") or "idle")
            )
            operation_id = child_task_state.get("operation_id")
            phase = None
            client = self._project_clients.get((resolved_project_id, child_thread_id))
            if client is not None:
                try:
                    runtime = await client.get_runtime_status(child_thread_id)
                    persisted_terminal = status in {
                        "completed",
                        "failed",
                        "cancelled",
                        "step_limit",
                    }
                    if not persisted_terminal:
                        active_turn_id = runtime.turn_id or active_turn_id
                        operation_id = operation_id or runtime.operation_id
                        phase = runtime.phase
                        if runtime.phase == "waiting_approval":
                            status = "awaiting_approval"
                        elif runtime.phase not in (None, "idle"):
                            status = "running"
                except Exception:
                    logger.debug(
                        "Unable to read child runtime %s",
                        child_thread_id,
                        exc_info=True,
                    )
            children.append(
                {
                    "parent_thread_id": source_thread_id,
                    "child_thread_id": child_thread_id,
                    "project": resolved_project_id,
                    "project_id": resolved_project_id,
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
                    "operation_attempt": child_task_state.get("attempt") or 1,
                    "operation_group_id": child_task_state.get("group_id"),
                    "execution_mode": child_task_state.get("execution_mode"),
                    "group_sequence": child_task_state.get("sequence"),
                    "operation_prompt": child_task_state.get("prompt"),
                    "operation_result": child_task_state.get("result"),
                    "operation_error": child_task_state.get("error"),
                    "recovery_required": status
                    in {"queued", "running", "awaiting_approval"}
                    and not session.get("process_online", False)
                    and client is None,
                    "last_turn_status": session.get("last_turn_status"),
                    "last_turn_error": session.get("last_turn_error"),
                    "last_turn_prompt": session.get("summary"),
                    "child_session_available": bool(session.get("session_id")),
                    "parent_turn_id": self._delegated_child_parent_turn_id(
                        source_thread_id, resolved_project_id, child_thread_id
                    ),
                    "lifecycle": list(child_task_state.get("lifecycle") or [])[
                        -MAX_CHILD_TASK_LIFECYCLE:
                    ],
                    "reports": list(child_task_state.get("reports") or [])[-32:],
                    "next_cursor": child_task_state.get("next_cursor") or 0,
                    "latest_report": (
                        (child_task_state.get("reports") or [])[-1]
                        if child_task_state.get("reports")
                        else None
                    ),
                    "started_at_ms": child_task_state.get("started_at_ms"),
                    "finished_at_ms": child_task_state.get("finished_at_ms"),
                    "duration_ms": child_task_state.get("duration_ms"),
                }
            )
        failed_receipts = sorted(
            (
                receipt
                for receipt in self._delegation_receipts.values()
                if receipt.get("parent_thread_id") == source_thread_id
                and receipt.get("project_id") == resolved_project_id
                and receipt.get("status") == "failed"
                and receipt.get("child_thread_id") not in child_thread_ids
            ),
            key=lambda receipt: (
                _nonnegative_int(receipt.get("timestamp_ms")),
                str(receipt.get("receipt_key") or ""),
            ),
        )[-MAX_DELEGATION_FAILURES_PER_PARENT:]
        for receipt in failed_receipts:
            timestamp_ms = _nonnegative_int(
                receipt.get("failed_at_ms")
                or receipt.get("updated_at_ms")
                or receipt.get("timestamp_ms")
            )
            child_thread_id = str(receipt.get("child_thread_id") or "")
            if not child_thread_id:
                continue
            attempt = _nonnegative_int(receipt.get("operation_attempt")) or 1
            lifecycle = [
                {
                    "status": "queued",
                    "timestamp_ms": _nonnegative_int(receipt.get("timestamp_ms")),
                    "attempt": attempt,
                }
            ]
            lifecycle.append(
                {
                    "status": "failed",
                    "timestamp_ms": timestamp_ms,
                    "attempt": attempt,
                }
            )
            title = receipt.get("title")
            children.append(
                {
                    "parent_thread_id": source_thread_id,
                    "child_thread_id": child_thread_id,
                    "project": resolved_project_id,
                    "project_id": resolved_project_id,
                    "session_id": None,
                    "parent_session_id": parent_session_id,
                    "parent_checkpoint_seq": None,
                    "title": title
                    if isinstance(title, str) and title
                    else child_thread_id,
                    "status": "failed",
                    "phase": None,
                    "turn_id": None,
                    "parent_turn_id": receipt.get("parent_turn_id"),
                    "operation_id": receipt.get("operation_id")
                    or f"child:{child_thread_id}",
                    "operation_attempt": attempt,
                    "operation_group_id": receipt.get("group_id"),
                    "execution_mode": receipt.get("execution_mode"),
                    "group_sequence": receipt.get("sequence"),
                    "operation_prompt": None,
                    "operation_result": None,
                    "operation_error": str(receipt.get("error") or "")[:2048] or None,
                    "recovery_required": False,
                    "last_turn_status": None,
                    "last_turn_error": None,
                    "last_turn_prompt": None,
                    "child_session_available": False,
                    "lifecycle": lifecycle,
                    "started_at_ms": None,
                    "finished_at_ms": timestamp_ms or None,
                    "duration_ms": None,
                }
            )
        return children

    def _delegated_child_parent_turn_id(
        self, parent_thread_id: str, project_id: str, child_thread_id: str
    ) -> str | None:
        """Return correlation metadata without using receipts as child state."""
        matches = [
            receipt
            for receipt in self._delegation_receipts.values()
            if receipt.get("parent_thread_id") == parent_thread_id
            and receipt.get("project_id") == project_id
            and receipt.get("child_thread_id") == child_thread_id
            and isinstance(receipt.get("parent_turn_id"), str)
        ]
        if not matches:
            return None
        latest = max(
            matches,
            key=lambda receipt: _nonnegative_int(receipt.get("timestamp_ms")),
        )
        return str(latest["parent_turn_id"])

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
                self._schedule_child_reconciliation(current_project_id)
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
            self._schedule_child_reconciliation(current_project_id)

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
            self._schedule_child_reconciliation(project_id)
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
                *self._child_wake_jobs.values(),
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
            self._child_wake_jobs.clear()
            self._child_wake_pending.clear()
            self._child_wake_deferred.clear()
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

    def list_project_child_sessions(
        self, project_id: str | None = None, parent_session_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Read all delegated child Sessions, including those outside sidebar pages."""
        return self._thread_registry.list_project_child_sessions(
            project_id, parent_session_id
        )

    def list_all_project_child_sessions(self) -> list[dict[str, Any]]:
        """Return every delegated child Session across registered Projects."""
        return [
            child
            for project_id in self._projects_registry
            for child in self.list_project_child_sessions(project_id)
        ]

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

    def list_any_project_thread_items(
        self,
        thread_id: str,
        project_id: str | None = None,
        turn_id: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
        sort_direction: str | None = None,
    ) -> dict[str, Any] | None:
        """List canonical SessionStore items without changing the active Project."""
        return self._thread_registry.list_any_project_thread_items(
            thread_id,
            project_id,
            turn_id,
            cursor,
            limit,
            sort_direction,
        )

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
            Path(project["primary_path"]),
            resolved_project_id,
            thread_id,
            scope,
            max_entries=(
                self.get_settings(resolved_project_id).get("notebook") or {}
            ).get("max_entries", MAX_NOTEBOOK_ENTRIES),
            max_entry_bytes=(
                self.get_settings(resolved_project_id).get("notebook") or {}
            ).get("max_entry_bytes", MAX_NOTEBOOK_ENTRY_BYTES),
        )

    def search_thread_notebook(
        self,
        thread_id: str,
        query: str,
        project_id: str | None = None,
        scope: str = "self",
        limit: int = 8,
    ) -> dict[str, Any] | None:
        notebook = self.read_thread_notebook(thread_id, project_id, scope)
        if notebook is None:
            return None
        normalized = query.strip().lower()
        if not normalized:
            raise ValueError("notebook search query must not be empty")
        matches = []
        for entry in notebook.get("entries", []):
            evidence = entry.get("evidence", [])
            searchable = [
                entry.get("key", ""),
                entry.get("content", ""),
                *entry.get("keywords", []),
            ]
            for item in evidence:
                if isinstance(item, dict):
                    searchable.extend(
                        item.get(field, "")
                        for field in ("project", "commit", "path", "subject")
                    )
            if any(normalized in str(value).lower() for value in searchable):
                matches.append(entry)
        return {**notebook, "entries": matches[: max(1, min(limit, 8))]}

    async def write_thread_notebook(
        self,
        thread_id: str,
        key: str,
        content: str,
        append: bool = False,
        importance: str = "normal",
        keywords: list[str] | None = None,
        evidence: list[dict[str, Any]] | None = None,
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
            keywords=keywords,
            evidence=evidence,
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
        subagent = {
            "max_concurrent_children": max(
                1, min(max_children, MAX_CONFIGURED_CHILD_TASKS_PER_PARENT)
            ),
        }
        notebook = dict(self._settings.get("notebook") or {})
        project_notebook = project.get("notebook")
        if isinstance(project_notebook, dict):
            notebook.update(project_notebook)
        try:
            max_entries = int(notebook.get("max_entries", MAX_NOTEBOOK_ENTRIES))
            max_entry_bytes = int(
                notebook.get("max_entry_bytes", MAX_NOTEBOOK_ENTRY_BYTES)
            )
        except (TypeError, ValueError):
            max_entries, max_entry_bytes = (
                MAX_NOTEBOOK_ENTRIES,
                MAX_NOTEBOOK_ENTRY_BYTES,
            )
        notebook = {
            "max_entries": max(1, min(max_entries, MAX_NOTEBOOK_ENTRIES)),
            "max_entry_bytes": max(256, min(max_entry_bytes, MAX_NOTEBOOK_ENTRY_BYTES)),
        }
        return {
            **self._settings,
            "subagent": subagent,
            "notebook": notebook,
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
        return any(
            key[0] == project_id for key in self._active_turns_by_project
        ) or any(key[0] == project_id for key in self._active_tasks_by_project)

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
                    incoming.get("max_concurrent_children", MAX_CHILD_TASKS_PER_PARENT)
                )
            except (TypeError, ValueError) as error:
                raise ValueError("invalid subagent concurrency") from error
            if not 1 <= max_children <= MAX_CONFIGURED_CHILD_TASKS_PER_PARENT:
                raise ValueError(
                    f"subagent concurrency must be between 1 and {MAX_CONFIGURED_CHILD_TASKS_PER_PARENT}"
                )
            updates = {
                **updates,
                "subagent": {
                    "max_concurrent_children": max_children,
                },
            }
        if isinstance(updates.get("notebook"), dict):
            incoming = updates["notebook"]
            try:
                max_entries = int(incoming.get("max_entries", MAX_NOTEBOOK_ENTRIES))
                max_entry_bytes = int(
                    incoming.get("max_entry_bytes", MAX_NOTEBOOK_ENTRY_BYTES)
                )
            except (TypeError, ValueError) as error:
                raise ValueError("invalid notebook limits") from error
            if not 1 <= max_entries <= MAX_NOTEBOOK_ENTRIES:
                raise ValueError(
                    f"notebook max entries must be between 1 and {MAX_NOTEBOOK_ENTRIES}"
                )
            if not 256 <= max_entry_bytes <= MAX_NOTEBOOK_ENTRY_BYTES:
                raise ValueError(
                    "notebook max entry bytes must be between 256 and "
                    f"{MAX_NOTEBOOK_ENTRY_BYTES}"
                )
            updates = {
                **updates,
                "notebook": {
                    "max_entries": max_entries,
                    "max_entry_bytes": max_entry_bytes,
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
            self._schedule_child_report(payload, project_id)
            self._schedule_child_control(payload, project_id)
        await self.broadcast_ws(payload)
        if payload.get("type") == "event":
            event = payload.get("event")
            if isinstance(event, dict) and event.get("type") == "turn_finished":
                self._resume_child_parent_wakeup(
                    project_id or payload.get("projectId"),
                    payload.get("threadId") or payload.get("thread_id"),
                )
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
        group_id = arguments.get("group_id")
        execution_mode = arguments.get("execution_mode")
        sequence = arguments.get("sequence")
        if (
            not parent_thread_id
            or not isinstance(child_thread_id, str)
            or not isinstance(prompt, str)
        ):
            return
        if not isinstance(group_id, str):
            group_id = None
        if execution_mode not in {"parallel", "sequential"}:
            return
        if not isinstance(sequence, int) or isinstance(sequence, bool):
            sequence = None
        receipt_key = ":".join(
            str(value or "")
            for value in (
                parent_thread_id,
                payload.get("turnId") or payload.get("turn_id"),
                event.get("item_id") or event.get("itemId") or call.get("id"),
            )
        )
        if not receipt_key.strip(":"):
            return
        if self._delegation_receipts.get(receipt_key, {}).get("status") in {
            "materialized",
        }:
            return
        parent_turn_id = payload.get("turnId") or payload.get("turn_id")
        if not isinstance(parent_turn_id, str):
            parent_turn_id = None
        project_id = project_id or self._current_project_id
        event_timestamp = (
            event.get("timestamp_ms")
            or event.get("timestampMs")
            or payload.get("timestamp_ms")
            or payload.get("timestampMs")
        )
        timestamp_ms = (
            int(event_timestamp)
            if isinstance(event_timestamp, (int, float))
            and not isinstance(event_timestamp, bool)
            and event_timestamp > 0
            else int(time.time() * 1000)
        )
        self._record_delegation_receipt(
            receipt_key,
            {
                "parent_thread_id": parent_thread_id,
                "child_thread_id": child_thread_id,
                "operation_id": f"child:{child_thread_id}",
                "operation_attempt": 1,
                "parent_turn_id": parent_turn_id,
                "timestamp_ms": timestamp_ms,
                "prompt": prompt,
                "title": str(arguments.get("title") or child_thread_id)[:160],
                "project_id": project_id,
                "group_id": group_id,
                "execution_mode": execution_mode,
                "sequence": sequence,
            },
        )
        asyncio.create_task(
            self._start_delegated_child(
                parent_thread_id,
                child_thread_id,
                prompt,
                arguments.get("title"),
                project_id,
                group_id,
                execution_mode,
                sequence,
                receipt_key,
            )
        )

    def _schedule_child_report(
        self, payload: dict[str, Any], project_id: str | None
    ) -> None:
        event = payload.get("event")
        if not isinstance(event, dict) or event.get("type") != "tool_finished":
            return
        if event.get("name") != "task_report" or event.get("is_error") is True:
            return
        if event.get("truncated") is True:
            return
        content = event.get("content")
        if not isinstance(content, str):
            return
        try:
            intent = json.loads(content)
        except (TypeError, ValueError):
            return
        if (
            not isinstance(intent, dict)
            or intent.get("status") != "requested"
            or intent.get("action") != "report"
        ):
            return
        report = intent.get("report")
        parent_thread_id = intent.get("parent_thread_id")
        operation_id = intent.get("operation_id")
        attempt = intent.get("attempt")
        if (
            not isinstance(report, str)
            or not report.strip()
            or len(report.encode("utf-8")) > 4096
            or not isinstance(parent_thread_id, str)
            or not parent_thread_id
            or not isinstance(operation_id, str)
            or not operation_id
            or isinstance(attempt, bool)
            or not isinstance(attempt, int)
            or attempt < 1
        ):
            return
        child_thread_id = str(payload.get("threadId") or "")
        report_id = event.get("call_id") or event.get("callId")
        if not child_thread_id or not isinstance(report_id, str) or not report_id:
            return
        asyncio.create_task(
            self._persist_child_report(
                child_thread_id,
                parent_thread_id,
                operation_id,
                attempt,
                report_id,
                report.strip(),
                project_id or self._current_project_id,
            )
        )

    def _child_parent_context(
        self, child_thread_id: str, project_id: str
    ) -> tuple[str, dict[str, Any]] | None:
        canonical = self._canonical_thread(child_thread_id, project_id)
        session = (canonical or {}).get("session") or {}
        state = session.get("child_task_state") or {}
        parent_thread_id = state.get("parent_thread_id")
        if isinstance(parent_thread_id, str) and parent_thread_id:
            return parent_thread_id, state
        parent_session_id = session.get("parent_session_id")
        if not isinstance(parent_session_id, str) or not parent_session_id:
            return None
        parent = next(
            (
                item
                for item in self.list_project_sessions(project_id, limit=128)["data"]
                if item.get("session_id") == parent_session_id
            ),
            None,
        )
        if not parent or not parent.get("thread_id"):
            return None
        return str(parent["thread_id"]), state

    async def _persist_child_report(
        self,
        child_thread_id: str,
        parent_thread_id: str,
        operation_id: str,
        attempt: int,
        report_id: str,
        report: str,
        project_id: str,
    ) -> None:
        context = self._child_parent_context(child_thread_id, project_id)
        if not context:
            logger.warning(
                "Cannot resolve parent for child report from %s", child_thread_id
            )
            return
        canonical_parent_thread_id, state = context
        if (
            canonical_parent_thread_id != parent_thread_id
            or state.get("operation_id") != operation_id
        ):
            logger.warning(
                "Ignoring child report with stale lineage from %s", child_thread_id
            )
            return
        try:
            client = await self.get_client_for_thread(child_thread_id, project_id)
            persisted = await client.child_task_action(
                child_thread_id,
                parent_thread_id,
                operation_id,
                attempt,
                "report",
                report=report,
                report_id=report_id,
            )
            children = await self.list_child_tasks(parent_thread_id, project_id)
            child = next(
                (
                    item
                    for item in children
                    if item.get("child_thread_id") == child_thread_id
                ),
                None,
            )
            if child:
                await self._broadcast_child_operation(child)
            self._queue_child_parent_wakeup(
                parent_thread_id,
                child_thread_id,
                project_id,
                f"report:{persisted.get('cursor') or report_id}",
                status="report",
                attempt=attempt,
                child_session_available=True,
                title=str(state.get("title") or "") or None,
            )
        except Exception:
            logger.warning(
                "Unable to persist child report from %s", child_thread_id, exc_info=True
            )

    def _schedule_child_control(
        self, payload: dict[str, Any], project_id: str | None
    ) -> None:
        event = payload.get("event")
        if not isinstance(event, dict) or event.get("type") != "tool_started":
            return
        call = event.get("call")
        if not isinstance(call, dict) or call.get("name") != "task_control":
            return
        arguments = call.get("arguments")
        if not isinstance(arguments, dict):
            return
        parent_thread_id = str(payload.get("threadId") or "")
        if not parent_thread_id:
            return
        parent_turn_id = payload.get("turnId") or payload.get("turn_id")
        if not isinstance(parent_turn_id, str):
            parent_turn_id = None
        call_id = event.get("item_id") or event.get("itemId") or call.get("id")
        if not isinstance(call_id, str) or not call_id:
            call_id = str(time.monotonic_ns())
        control_event_id = f"{parent_turn_id or 'turn'}:{call_id}"[:192]
        asyncio.create_task(
            self._apply_child_control(
                parent_thread_id,
                dict(arguments),
                project_id or self._current_project_id,
                parent_turn_id,
                control_event_id,
            )
        )

    async def _apply_child_control(
        self,
        parent_thread_id: str,
        request: dict[str, Any],
        project_id: str,
        parent_turn_id: str | None = None,
        control_event_id: str | None = None,
    ) -> None:
        action = request.get("action")
        try:
            children = await self.list_child_tasks(parent_thread_id, project_id)
        except Exception:
            logger.warning(
                "Unable to resolve child control targets for %s",
                parent_thread_id,
                exc_info=True,
            )
            requested_child_id = request.get("child_thread_id")
            self._queue_child_control_outcome(
                parent_thread_id,
                project_id,
                control_event_id,
                {
                    "action": action,
                    "outcome": "failed",
                    "requested_child_ids": (
                        [requested_child_id]
                        if isinstance(requested_child_id, str)
                        else []
                    ),
                },
            )
            return
        if action == "cancel_group":
            group_id = request.get("group_id")
            targets = [
                child
                for child in children
                if group_id
                and child.get("operation_group_id") == group_id
                and child.get("execution_mode") == "sequential"
                and parent_turn_id
                and child.get("parent_turn_id") == parent_turn_id
            ]
        else:
            child_thread_id = request.get("child_thread_id")
            operation_id = request.get("operation_id")
            targets = [
                child
                for child in children
                if child.get("child_thread_id") == child_thread_id
                and child.get("operation_id") == operation_id
            ]
        if not targets:
            logger.warning(
                "Ignoring stale or unowned child control request from %s",
                parent_thread_id,
            )
            requested_child_id = request.get("child_thread_id")
            self._queue_child_control_outcome(
                parent_thread_id,
                project_id,
                control_event_id,
                {
                    "action": action,
                    "outcome": "stale",
                    "requested_child_ids": (
                        [requested_child_id]
                        if isinstance(requested_child_id, str)
                        else []
                    ),
                },
            )
            return
        applied_ids: list[str] = []
        failed_ids: list[str] = []
        skipped_ids: list[str] = []
        stale_ids: list[str] = []
        for child in targets:
            child_thread_id = str(child.get("child_thread_id") or "")
            operation_id = str(child.get("operation_id") or "")
            status = child.get("status")
            applied = False
            try:
                if action == "update_queued":
                    prompt = request.get("prompt")
                    if status != "queued" or not isinstance(prompt, str):
                        skipped_ids.append(child_thread_id)
                        continue
                    client = await self.get_client_for_thread(
                        child_thread_id, project_id
                    )
                    await client.child_task_action(
                        child_thread_id,
                        parent_thread_id,
                        operation_id,
                        int(child.get("operation_attempt") or 1),
                        "update_queued",
                        prompt=prompt,
                    )
                    applied = True
                elif action == "steer":
                    turn_id = str(child.get("turn_id") or "")
                    text = request.get("text")
                    if (
                        status not in {"running", "awaiting_approval", "in_progress"}
                        or not turn_id
                        or not isinstance(text, str)
                    ):
                        skipped_ids.append(child_thread_id)
                        continue
                    client = await self.get_client_for_thread(
                        child_thread_id, project_id
                    )
                    await client.steer_turn(turn_id, text, child_thread_id)
                    applied = True
                elif action == "cancel":
                    if status == "queued":
                        client = await self.get_client_for_thread(
                            child_thread_id, project_id
                        )
                        await client.child_task_action(
                            child_thread_id,
                            parent_thread_id,
                            operation_id,
                            int(child.get("operation_attempt") or 1),
                            "cancel_queued",
                        )
                    elif status in {"running", "awaiting_approval", "in_progress"}:
                        await self.cancel_child_task(
                            parent_thread_id, child_thread_id, project_id
                        )
                    else:
                        skipped_ids.append(child_thread_id)
                        continue
                    applied = True
                elif action == "retry" and status in {
                    "failed",
                    "cancelled",
                    "step_limit",
                }:
                    await self.retry_child_task(
                        parent_thread_id, child_thread_id, project_id
                    )
                    applied = True
                elif action == "cancel_group":
                    if status == "queued":
                        client = await self.get_client_for_thread(
                            child_thread_id, project_id
                        )
                        await client.child_task_action(
                            child_thread_id,
                            parent_thread_id,
                            operation_id,
                            int(child.get("operation_attempt") or 1),
                            "cancel_queued",
                        )
                    elif status in {"running", "awaiting_approval", "in_progress"}:
                        await self.cancel_child_task(
                            parent_thread_id, child_thread_id, project_id
                        )
                    else:
                        skipped_ids.append(child_thread_id)
                        continue
                    applied = True
                else:
                    skipped_ids.append(child_thread_id)
                    continue
            except Exception:
                logger.warning(
                    "Unable to apply child control %s to %s",
                    action,
                    child_thread_id,
                    exc_info=True,
                )
                try:
                    latest = await self.list_child_tasks(parent_thread_id, project_id)
                    current = next(
                        (
                            item
                            for item in latest
                            if item.get("child_thread_id") == child_thread_id
                        ),
                        None,
                    )
                    if (
                        current is None
                        or current.get("operation_id") != operation_id
                        or current.get("operation_attempt")
                        != child.get("operation_attempt")
                        or current.get("status") != status
                    ):
                        stale_ids.append(child_thread_id)
                    else:
                        failed_ids.append(child_thread_id)
                except Exception:  # noqa: BLE001
                    failed_ids.append(child_thread_id)
                continue
            if applied:
                applied_ids.append(child_thread_id)

        outcome = self._child_control_outcome(
            applied_ids, failed_ids, skipped_ids, stale_ids
        )
        if applied_ids:
            try:
                await self._drain_child_queue(parent_thread_id, project_id)
            except Exception:
                logger.warning(
                    "Unable to drain child queue after control %s for %s",
                    action,
                    parent_thread_id,
                    exc_info=True,
                )
            try:
                current_children = await self.list_child_tasks(
                    parent_thread_id, project_id
                )
            except Exception:
                logger.warning(
                    "Unable to refresh child projection after control %s for %s",
                    action,
                    parent_thread_id,
                    exc_info=True,
                )
                current_children = []
            for child in current_children:
                if child.get("child_thread_id") in set(applied_ids):
                    try:
                        await self._broadcast_child_operation(child)
                    except Exception:
                        logger.warning(
                            "Unable to broadcast child control update for %s",
                            child.get("child_thread_id"),
                            exc_info=True,
                        )
        self._queue_child_control_outcome(
            parent_thread_id,
            project_id,
            control_event_id,
            {
                "action": action,
                "outcome": outcome,
                "applied_child_ids": applied_ids,
                "failed_child_ids": failed_ids,
                "skipped_child_ids": skipped_ids,
                "stale_child_ids": stale_ids,
            },
        )

    @staticmethod
    def _child_control_outcome(
        applied_ids: list[str],
        failed_ids: list[str],
        skipped_ids: list[str],
        stale_ids: list[str],
    ) -> str:
        if stale_ids and not applied_ids and not failed_ids and not skipped_ids:
            return "stale"
        if applied_ids and (failed_ids or skipped_ids or stale_ids):
            return "partial"
        if applied_ids:
            return "applied"
        if failed_ids:
            return "failed"
        if stale_ids:
            return "stale"
        return "skipped"

    def _queue_child_control_outcome(
        self,
        parent_thread_id: str,
        project_id: str,
        event_id: str | None,
        outcome: dict[str, Any],
    ) -> None:
        if not event_id:
            return
        self._queue_child_parent_wakeup(
            parent_thread_id,
            "@control",
            project_id,
            f"control:{event_id}",
            status="control",
            details=outcome,
        )

    def _queue_child_parent_wakeup(
        self,
        parent_thread_id: str,
        child_thread_id: str,
        project_id: str,
        event_id: str,
        *,
        status: str,
        attempt: int | None = None,
        child_session_available: bool | None = None,
        title: str | None = None,
        operation_error: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        # Report cursors are local to each child Session, so distinct children
        # can legitimately produce the same event id (for example report:27).
        identity = (project_id, parent_thread_id, child_thread_id, event_id)
        if identity in self._child_wake_seen:
            return
        self._child_wake_seen[identity] = None
        while len(self._child_wake_seen) > 512:
            self._child_wake_seen.popitem(last=False)
        key = (project_id, parent_thread_id)
        pending = self._child_wake_pending.setdefault(key, {})
        if details is None:
            task = {
                "status": status,
                "attempt": max(1, attempt or 1),
            }
            if child_session_available is not None:
                task["child_session_available"] = child_session_available
            if title:
                task["title"] = title[:96]
            if operation_error:
                task["operation_error"] = operation_error[:256]
            existing = pending.get(child_thread_id)
            if existing is not None and task["attempt"] < existing.get("attempt", 1):
                return
            if existing is not None and task["attempt"] == existing.get("attempt", 1):
                terminal = {"completed", "failed", "cancelled", "step_limit"}
                if existing.get("status") in terminal and status not in terminal:
                    task = {**task, **existing}
            if existing is None and sum(
                not item.startswith("@") for item in pending
            ) >= MAX_CHILD_WAKE_PENDING_CHILDREN:
                overflow = pending.setdefault(
                    "@overflow", {"kind": "overflow", "count": 0, "sample": []}
                )
                overflow["count"] = min(overflow.get("count", 0) + 1, 2**31 - 1)
                if (
                    child_thread_id not in overflow["sample"]
                    and len(overflow["sample"]) < MAX_CHILD_WAKE_OVERFLOW_SAMPLE
                ):
                    overflow["sample"].append(child_thread_id[:64])
            else:
                pending[child_thread_id] = task
        else:
            self._merge_child_control_wakeup(pending, details)
        self._schedule_child_parent_wakeup(project_id, parent_thread_id)

    def get_turn_start_lock(
        self, thread_id: str, project_id: str | None = None
    ) -> asyncio.Lock:
        resolved_project = (
            project_id
            or self._active_thread_projects.get(thread_id)
            or self._current_project_id
        )
        key = (resolved_project, thread_id)
        lock = self._turn_start_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._turn_start_locks[key] = lock
        self._turn_start_locks.move_to_end(key)
        while len(self._turn_start_locks) > 256:
            stale_key = next(
                (
                    candidate
                    for candidate, candidate_lock in self._turn_start_locks.items()
                    if candidate != key and not candidate_lock.locked()
                ),
                None,
            )
            if stale_key is None:
                break
            self._turn_start_locks.pop(stale_key, None)
        return lock

    def _schedule_child_parent_wakeup(
        self, project_id: str, parent_thread_id: str
    ) -> None:
        key = (project_id, parent_thread_id)
        if (
            not self._child_wake_pending.get(key)
            or key in self._child_wake_jobs
            or key in self._child_wake_deferred
        ):
            return
        self._child_wake_jobs[key] = asyncio.create_task(
            self._drain_child_parent_wakeups(project_id, parent_thread_id)
        )

    def _resume_child_parent_wakeup(
        self, project_id: str | None, parent_thread_id: str | None
    ) -> None:
        if not isinstance(project_id, str) or not project_id:
            return
        if not isinstance(parent_thread_id, str) or not parent_thread_id:
            return
        key = (project_id, parent_thread_id)
        self._child_wake_deferred.discard(key)
        self._schedule_child_parent_wakeup(project_id, parent_thread_id)

    @staticmethod
    def _merge_child_control_wakeup(
        pending: dict[str, dict[str, Any]], details: dict[str, Any]
    ) -> None:
        bucket = pending.setdefault(
            "@control",
            {
                "kind": "control",
                "notifications": [],
                "omitted": 0,
                "outcome_counts": {},
                "child_ids": [],
                "child_ids_truncated": False,
            },
        )
        action = str(details.get("action") or "unknown")[:40]
        outcome = str(details.get("outcome") or "failed")[:16]

        def ids(field: str) -> list[str]:
            raw = details.get(field)
            if not isinstance(raw, list):
                return []
            return [item[:64] for item in raw if isinstance(item, str)][
                :MAX_CHILD_CONTROL_WAKE_IDS
            ]

        notification = {
            "action": action,
            "outcome": outcome,
            "applied_child_ids": ids("applied_child_ids"),
            "failed_child_ids": ids("failed_child_ids"),
            "skipped_child_ids": ids("skipped_child_ids"),
            "stale_child_ids": ids("stale_child_ids"),
            "requested_child_ids": ids("requested_child_ids"),
        }
        counts = bucket.setdefault("outcome_counts", {})
        counts[outcome] = int(counts.get(outcome) or 0) + 1
        known_child_ids = bucket.setdefault("child_ids", [])
        for child_id in (
            notification["applied_child_ids"]
            + notification["failed_child_ids"]
            + notification["skipped_child_ids"]
            + notification["stale_child_ids"]
        ):
            if child_id in known_child_ids:
                continue
            if len(known_child_ids) < MAX_CHILD_CONTROL_WAKE_CHILD_IDS:
                known_child_ids.append(child_id)
            else:
                bucket["child_ids_truncated"] = True

        notifications = bucket.setdefault("notifications", [])
        if len(notifications) >= MAX_CHILD_CONTROL_WAKE_EVENTS:
            notifications.pop(0)
            bucket["omitted"] = int(bucket.get("omitted") or 0) + 1
        notifications.append(notification)

    async def _drain_child_parent_wakeups(
        self, project_id: str, parent_thread_id: str
    ) -> None:
        key = (project_id, parent_thread_id)
        delivery_failed = False
        batch: dict[str, dict[str, Any]] = {}
        start_lock = self.get_turn_start_lock(parent_thread_id, project_id)
        start_lock_acquired = False
        try:
            if not self._child_wake_pending.get(key):
                return
            await start_lock.acquire()
            start_lock_acquired = True
            if self.get_active_turn(parent_thread_id, project_id):
                self._child_wake_deferred.add(key)
                return

            client = await self.get_client_for_thread(parent_thread_id, project_id)
            runtime = await client.get_runtime_status(parent_thread_id)
            phase = str(getattr(runtime, "phase", "idle") or "idle")
            if (
                phase not in {"idle", "completed", "failed"}
                or self.get_active_turn(parent_thread_id, project_id)
            ):
                self._child_wake_deferred.add(key)
                return

            pending = self._child_wake_pending.setdefault(key, {})
            batch = {}
            batch_child_count = 0
            for child_id in list(pending):
                if child_id.startswith("@"):
                    batch[child_id] = pending.pop(child_id)
                elif batch_child_count < MAX_CHILD_WAKE_BATCH_CHILDREN:
                    batch[child_id] = pending.pop(child_id)
                    batch_child_count += 1
            if not batch:
                return
            task_descriptions: list[str] = []
            read_child_ids: set[str] = set()
            control_bucket = batch.get("@control")
            for child_id, value in batch.items():
                if value.get("kind") in {"control", "overflow"}:
                    continue
                display_id = child_id[:64]
                display_name = str(value.get("title") or display_id)[:48]
                status = str(value.get("status") or "unknown")[:24]
                description = f"{display_name} [{display_id}] ({status})"
                if value.get("child_session_available") is False:
                    error = str(value.get("operation_error") or "")[:128]
                    if error:
                        description += f"; Session creation failed: {error}"
                task_descriptions.append(description)
                if (
                    value.get("child_session_available") is not False
                    and status not in {"queued", "not_started", "idle"}
                ):
                    read_child_ids.add(child_id)

            prompt_parts = [
                "Delegated child updates are available: "
                + (", ".join(task_descriptions) or "task control outcomes")
                + "."
            ]
            overflow = batch.get("@overflow")
            if isinstance(overflow, dict) and overflow.get("count"):
                sample = overflow.get("sample") or []
                prompt_parts.append(
                    f"{int(overflow['count'])} additional child update(s) were coalesced "
                    "to keep this continuation bounded; track previously delegated "
                    "children using their known IDs. Sample IDs: "
                    + ", ".join(str(child_id)[:64] for child_id in sample[:8])
                )
            if isinstance(control_bucket, dict):
                for notification in control_bucket.get("notifications", []):
                    if not isinstance(notification, dict):
                        continue

                    def display_ids(
                        field: str, notification: dict[str, Any] = notification
                    ) -> str:
                        values = notification.get(field)
                        if not isinstance(values, list) or not values:
                            return "[]"
                        return (
                            "["
                            + ", ".join(
                                str(item)[:64]
                                for item in values[:MAX_CHILD_CONTROL_WAKE_IDS]
                                if isinstance(item, str)
                            )
                            + "]"
                        )

                    prompt_parts.append(
                        "task_control "
                        f"{str(notification.get('action') or 'unknown')[:40]} "
                        f"outcome={str(notification.get('outcome') or 'failed')[:16]}; "
                        f"applied={display_ids('applied_child_ids')}; "
                        f"failed={display_ids('failed_child_ids')}; "
                        f"skipped={display_ids('skipped_child_ids')}; "
                        f"stale={display_ids('stale_child_ids')}; "
                        f"requested={display_ids('requested_child_ids')}"
                    )
                omitted = int(control_bucket.get("omitted") or 0)
                if omitted:
                    counts = control_bucket.get("outcome_counts") or {}
                    count_summary = ", ".join(
                        f"{str(name)[:16]}={int(count or 0)}"
                        for name, count in list(counts.items())[:5]
                    )
                    prompt_parts.append(
                        f"{omitted} older control outcome detail(s) were coalesced "
                        f"({count_summary}); affected child IDs: "
                        + ", ".join(control_bucket.get("child_ids", []))
                    )
                if control_bucket.get("child_ids_truncated"):
                    prompt_parts.append(
                        "The affected child ID list was truncated; inspect the "
                        "current App Server child projection before taking action."
                    )
            if read_child_ids:
                prompt_parts.append(
                    "Use task_read only for these reported or settled child sessions: "
                    + ", ".join(sorted(read_child_ids))
                    + ". Inspect "
                    "the latest lifecycle and reports; omit after_cursor for the "
                    "first page and follow next_cursor for additional report pages."
                )
            if isinstance(control_bucket, dict):
                prompt_parts.append(
                    "Control notifications describe the Gateway RPC outcome. "
                    "The App Server child operation projection remains authoritative; "
                    "do not call task_read for queued tasks or control-only IDs. "
                    "Use the control outcome and known task state before deciding "
                    "whether to retry, steer, cancel, or delegate more work."
                )
            prompt_parts.append(
                "Then decide whether to wait, steer, cancel, retry, or delegate more work."
            )
            prompt = " ".join(prompt_parts)
            submission = await client.start_turn(
                prompt=prompt,
                mode="start_if_idle",
                thread_id=parent_thread_id,
                effort=self.get_settings(project_id).get("reasoning_effort", "high"),
                turn_source="child_wakeup",
            )
            turn_id = str(getattr(submission, "turn_id", None) or "")
            if not turn_id:
                raise RuntimeError("Parent wake-up Turn submission returned no turn ID")
            task = asyncio.create_task(
                self._wait_for_parent_child_wakeup_turn(
                    client, parent_thread_id, project_id, turn_id
                )
            )
            self.set_active_turn(parent_thread_id, turn_id, task, project_id)
            self._child_wake_deferred.add(key)
        except Exception:
            delivery_failed = True
            logger.warning(
                "Unable to deliver child updates to parent %s",
                parent_thread_id,
                exc_info=True,
            )
            # Keep failed updates available for a later wake event to retry.
            # Prefer entries queued during delivery if they contain newer state.
            pending = self._child_wake_pending.setdefault(key, {})
            for child_thread_id, value in batch.items():
                if child_thread_id == "@overflow":
                    current = pending.setdefault(
                        child_thread_id,
                        {"kind": "overflow", "count": 0, "sample": []},
                    )
                    current["count"] = min(
                        current.get("count", 0) + value.get("count", 0),
                        2**31 - 1,
                    )
                    for sample_id in value.get("sample", []):
                        if (
                            sample_id not in current["sample"]
                            and len(current["sample"]) < MAX_CHILD_WAKE_OVERFLOW_SAMPLE
                        ):
                            current["sample"].append(sample_id)
                else:
                    pending.setdefault(child_thread_id, value)
        finally:
            if start_lock_acquired:
                start_lock.release()
            self._child_wake_jobs.pop(key, None)
            if not delivery_failed:
                self._schedule_child_parent_wakeup(project_id, parent_thread_id)

    async def _wait_for_parent_child_wakeup_turn(
        self,
        client: MiniAgentClient,
        parent_thread_id: str,
        project_id: str,
        turn_id: str,
    ) -> None:
        task = asyncio.current_task()
        try:
            await client.wait_for_turn(turn_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("Parent wake-up Turn %s failed", turn_id, exc_info=True)
        finally:
            self.clear_active_turn(parent_thread_id, project_id, turn_id, task)

    async def _start_delegated_child(
        self,
        parent_thread_id: str,
        child_thread_id: str,
        prompt: str,
        title: Any,
        project_id: str | None,
        group_id: str | None,
        execution_mode: str | None,
        sequence: int | None,
        receipt_key: str | None = None,
    ) -> None:
        try:
            existing = self._canonical_thread(child_thread_id, project_id)
            if existing:
                if receipt_key:
                    self._update_delegation_receipt(receipt_key, "materialized")
                await self.reconcile_child_operations(
                    project_id or self._current_project_id
                )
                return
            await self.start_child_task(
                parent_thread_id,
                child_thread_id,
                prompt,
                title if isinstance(title, str) else None,
                project_id,
                group_id,
                sequence,
                execution_mode=execution_mode,
                operation_attempt=(
                    _nonnegative_int(
                        (self._delegation_receipts.get(receipt_key) or {}).get(
                            "operation_attempt"
                        )
                    )
                    or 1
                ),
            )
            if receipt_key:
                self._update_delegation_receipt(receipt_key, "materialized")
        except Exception as err:
            existing = self._canonical_thread(child_thread_id, project_id)
            if existing:
                if receipt_key:
                    self._update_delegation_receipt(receipt_key, "materialized")
                try:
                    children = await self.list_child_tasks(parent_thread_id, project_id)
                    child = next(
                        (
                            item
                            for item in children
                            if item.get("child_thread_id") == child_thread_id
                        ),
                        None,
                    )
                    if child:
                        await self._broadcast_child_operation(child)
                except Exception:
                    logger.debug(
                        "Unable to publish existing Child projection for %s",
                        child_thread_id,
                        exc_info=True,
                    )
                logger.exception(
                    "Unable to start delegated child %s from %s after Session creation",
                    child_thread_id,
                    parent_thread_id,
                )
                return
            if receipt_key:
                self._update_delegation_receipt(receipt_key, "failed", error=str(err))
                receipt = self._delegation_receipts.get(receipt_key) or {}
                await self._broadcast_child_operation(
                    {
                        "parent_thread_id": parent_thread_id,
                        "child_thread_id": child_thread_id,
                        "project": project_id or self._current_project_id,
                        "operation_id": receipt.get("operation_id")
                        or f"child:{child_thread_id}",
                        "operation_attempt": receipt.get("operation_attempt") or 1,
                        "parent_turn_id": receipt.get("parent_turn_id"),
                        "title": receipt.get("title"),
                        "status": "failed",
                        "execution_mode": execution_mode,
                        "operation_group_id": group_id,
                        "group_sequence": sequence,
                        "child_session_available": False,
                        "lifecycle": [
                            {
                                "status": "queued",
                                "timestamp_ms": receipt.get("timestamp_ms"),
                                "attempt": receipt.get("operation_attempt") or 1,
                            },
                            {
                                "status": "failed",
                                "timestamp_ms": receipt.get("failed_at_ms"),
                                "attempt": receipt.get("operation_attempt") or 1,
                            },
                        ],
                        "finished_at_ms": receipt.get("failed_at_ms"),
                        "operation_error": str(err),
                    }
                )
                self._queue_child_parent_wakeup(
                    parent_thread_id,
                    child_thread_id,
                    project_id or self._current_project_id,
                    "creation-failed:"
                    f"{receipt.get('operation_id') or child_thread_id}:"
                    f"{receipt.get('operation_attempt') or 1}",
                    status="failed",
                    attempt=_nonnegative_int(receipt.get("operation_attempt")) or 1,
                    child_session_available=False,
                    title=str(receipt.get("title") or child_thread_id),
                    operation_error=str(err),
                )
            logger.exception(
                "Unable to start delegated child %s from %s",
                child_thread_id,
                parent_thread_id,
            )

    async def reconcile_delegation_receipts(self, project_id: str) -> None:
        """Retry pending delegation intents after Gateway recovery."""
        for key, receipt in list(self._delegation_receipts.items()):
            if receipt.get("project_id") != project_id:
                continue
            if receipt.get("status") not in {"pending", "materialized"}:
                continue
            await self._start_delegated_child(
                str(receipt.get("parent_thread_id") or ""),
                str(receipt.get("child_thread_id") or ""),
                str(receipt.get("prompt") or ""),
                receipt.get("title"),
                project_id,
                receipt.get("group_id"),
                receipt.get("execution_mode"),
                receipt.get("sequence"),
                key,
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
        if self.get_active_turn(thread_id, project_id):
            return
        resolved_project_id = self.resolve_thread_project(thread_id, project_id)
        self._resume_child_parent_wakeup(resolved_project_id, thread_id)

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
