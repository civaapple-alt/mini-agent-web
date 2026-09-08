"""Read-only projection of the canonical Mini Agent SessionStore.

The Web gateway never writes these files and never treats its own state.json as
conversation storage. This adapter is deliberately bounded: it reads the
SessionStore summary/checkpoint files for project history and leaves mutation
and lock ownership to the App Server.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

MAX_SESSIONS = 128
MAX_SESSION_BYTES = 8 * 1024 * 1024
MAX_RECORD_BYTES = 64 * 1024
MAX_ERROR_CHARS = 2048
MAX_CHECKPOINT_MESSAGES = 64
MAX_CHECKPOINT_MESSAGE_CHARS = 16 * 1024
THREAD_INDEX_FILE_NAME = "thread_index.json"
THREAD_SETTINGS_FILE_NAME = "thread_settings.json"


def _workspace_key(workspace: Path) -> str:
    value = str(workspace.resolve())
    value = value.removeprefix("\\\\?\\")
    return quote(value, safe="-_.")


def _session_base(workspace: Path) -> Path:
    return Path.home() / ".mini-agent" / "sessions" / _workspace_key(workspace)


def _timestamp(value: Any) -> str | None:
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat()


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _read_thread_index(base: Path) -> dict[str, str]:
    """Read the App Server's bounded thread -> session index."""
    value = _read_json(base / THREAD_INDEX_FILE_NAME)
    threads = value.get("threads")
    if not isinstance(threads, dict):
        return {}
    result: dict[str, str] = {}
    for thread_id, entry in threads.items():
        if not isinstance(thread_id, str) or not isinstance(entry, dict):
            continue
        session_id = entry.get("session_id")
        if isinstance(session_id, str) and session_id:
            result[thread_id] = session_id
    return result


def _bounded_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return max(0, int(value))
    return 0


def _bounded_text(value: Any, limit: int = MAX_ERROR_CHARS) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    if len(value) <= limit:
        return value
    return f"{value[:limit]}…"


def _process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        # Windows does not implement POSIX signal 0 consistently. In
        # particular, os.kill(pid, 0) may raise WinError 87/SystemError even
        # for a valid PID, so query the process exit code through kernel32.
        try:
            import ctypes

            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.OpenProcess.argtypes = [
                ctypes.c_uint32,
                ctypes.c_bool,
                ctypes.c_uint32,
            ]
            kernel32.OpenProcess.restype = ctypes.c_void_p
            kernel32.GetExitCodeProcess.argtypes = [
                ctypes.c_void_p,
                ctypes.POINTER(ctypes.c_ulong),
            ]
            kernel32.GetExitCodeProcess.restype = ctypes.c_bool
            kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
            kernel32.CloseHandle.restype = ctypes.c_bool
            handle = kernel32.OpenProcess(0x1000, False, pid)
            if not handle:
                return False
            exit_code = ctypes.c_ulong()
            try:
                return bool(
                    kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
                    and exit_code.value == 259
                )
            finally:
                kernel32.CloseHandle(handle)
        except Exception:  # noqa: BLE001
            return False
    try:
        os.kill(pid, 0)
    except (OSError, PermissionError, SystemError):
        return False
    return True


def _lock_info(path: Path) -> tuple[bool, int | None]:
    if not path.is_file():
        return False, None
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return True, None
    pid = next(
        (
            int(field[4:])
            for field in content.split()
            if field.startswith("pid=") and field[4:].isdigit()
        ),
        None,
    )
    return True, pid


def _goal_status(value: Any) -> str:
    return {
        "running": "active",
        "user_paused": "paused",
        "converged": "completed",
        "budget_limited": "budget_limited",
        "failed": "failed",
    }.get(str(value), "none")


def _goal_projection(
    goal: dict[str, Any], thread_id: str, goal_status: str
) -> dict[str, Any] | None:
    """Project Rust GoalState into the stable Web workflow shape."""
    objective = str(goal.get("objective") or "")
    if not objective:
        return None
    status = {
        "running": "active",
        "user_paused": "paused",
        "converged": "completed",
        "failed": "blocked",
        "usage_limited": "usageLimited",
        "budget_limited": "budgetLimited",
    }.get(
        str(goal.get("status") or goal_status), str(goal.get("status") or goal_status)
    )
    return {
        "thread_id": str(goal.get("thread_id") or thread_id),
        "objective": objective,
        "status": status,
        "token_budget": goal.get("token_budget"),
        "tokens_used": goal.get("tokens_used", 0),
        "time_used_seconds": goal.get("time_used_seconds", 0),
        "created_at": goal.get("created_at_ms", 0),
        "updated_at": goal.get("updated_at_ms", 0),
        "current_milestone": _bounded_int(goal.get("current_milestone")),
        "total_milestones": _bounded_int(goal.get("total_milestones")),
        "loop_count": _bounded_int(goal.get("loop_count")),
        "last_verifier_score": goal.get("last_verifier_score"),
        "last_error": _bounded_text(goal.get("last_error")),
        "verification_status": str(goal.get("verification_status") or "idle"),
    }


def _item_projection(record: dict[str, Any]) -> dict[str, Any] | None:
    message = record.get("message")
    if not isinstance(message, dict):
        return None
    item_id = str(record.get("item_id") or "")
    role = message.get("role")
    if role == "user":
        return {
            "type": "userMessage",
            "id": item_id,
            "text": _bounded_text(message.get("text"), 16 * 1024) or "",
        }
    if role == "assistant":
        return {
            "type": "agentMessage",
            "id": item_id,
            "text": _bounded_text(message.get("text"), 16 * 1024) or "",
        }
    if role == "tool":
        outcome = message.get("outcome")
        return {
            "type": "toolCall",
            "id": item_id,
            "name": str(message.get("name") or "tool"),
            "arguments": message.get("arguments") or {},
            "status": "failed"
            if isinstance(outcome, dict) and outcome.get("error")
            else "completed",
            "output": _bounded_text(outcome.get("content"), 16 * 1024)
            if isinstance(outcome, dict)
            else None,
        }
    if role == "context":
        return {"type": "contextCompaction", "id": item_id, "status": "completed"}
    return None


def _checkpoint_projection(record: dict[str, Any]) -> dict[str, Any]:
    """Keep a bounded history preview when a checkpoint exceeds the record limit."""
    messages = record.get("messages")
    bounded_messages = []
    if isinstance(messages, list):
        for message in messages[-MAX_CHECKPOINT_MESSAGES:]:
            if not isinstance(message, dict):
                continue
            role = message.get("role")
            if role not in ("user", "assistant", "system", "tool", "context"):
                continue
            bounded_messages.append(
                {
                    "role": role,
                    "text": _bounded_text(
                        message.get("text"), MAX_CHECKPOINT_MESSAGE_CHARS
                    )
                    or "",
                }
            )
    return {
        "kind": "checkpoint",
        "thread_id": record.get("thread_id"),
        "seq": _bounded_int(record.get("seq")),
        "timestamp_ms": _bounded_int(record.get("timestamp_ms")),
        "messages": bounded_messages,
    }


class SessionCatalog:
    """Bounded, read-only SessionStore listing and history reader."""

    def list_sessions(
        self,
        workspace: Path,
        project_id: str,
        limit: int = 64,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        limit = max(1, min(limit, MAX_SESSIONS))
        start = int(cursor) if cursor and cursor.isdigit() else 0
        base = _session_base(workspace)
        entries = []
        if base.is_dir():
            for path in base.iterdir():
                if path.is_dir() and (path / "session.jsonl").is_file():
                    entry = self._read_session(path, project_id, include_history=False)
                    if entry:
                        entries.append(entry)
        entries.sort(
            key=lambda item: (
                item.get("updated_at") or "",
                str(item.get("session_id") or ""),
                str(item.get("thread_id") or ""),
            ),
            reverse=True,
        )
        data = entries[start : start + limit]
        next_cursor = (
            str(start + len(data)) if start + len(data) < len(entries) else None
        )
        return {"data": data, "next_cursor": next_cursor}

    def find_by_thread(
        self, workspace: Path, project_id: str, thread_id: str
    ) -> dict[str, Any] | None:
        base = _session_base(workspace)
        if not base.is_dir():
            return None

        indexed_session_id = _read_thread_index(base).get(thread_id)
        if indexed_session_id:
            indexed_path = base / indexed_session_id
            if (
                indexed_path.name == indexed_session_id
                and indexed_path.is_dir()
                and (indexed_path / "session.jsonl").is_file()
            ):
                entry = self._read_session(
                    indexed_path, project_id, include_history=True
                )
                if entry and entry.get("thread_id") == thread_id:
                    return entry

        # Legacy sessions created before thread_index.json remain readable. This
        # is a migration fallback, not the normal request-time lookup path.
        for path in base.iterdir():
            if not path.is_dir() or not (path / "session.jsonl").is_file():
                continue
            entry = self._read_session(path, project_id, include_history=True)
            if entry and entry.get("thread_id") == thread_id:
                return entry
        return None

    def find_session_path(self, workspace: Path, thread_id: str) -> Path | None:
        """Resolve a Thread to its Session directory without reading history."""
        base = _session_base(workspace)
        if not base.is_dir():
            return None

        indexed_session_id = _read_thread_index(base).get(thread_id)
        if indexed_session_id:
            indexed_path = base / indexed_session_id
            if (
                indexed_path.name == indexed_session_id
                and indexed_path.is_dir()
                and (indexed_path / "session.jsonl").is_file()
            ):
                return indexed_path

        for path in base.iterdir():
            if not path.is_dir() or not (path / "session.jsonl").is_file():
                continue
            try:
                with (path / "session.jsonl").open("rb") as session_file:
                    for line in session_file:
                        if len(line) > MAX_RECORD_BYTES:
                            continue
                        try:
                            record = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if (
                            isinstance(record, dict)
                            and record.get("kind") == "thread_started"
                            and record.get("thread_id") == thread_id
                        ):
                            return path
            except OSError:
                continue
        return None

    def read_thread(
        self, workspace: Path, project_id: str, thread_id: str
    ) -> dict[str, Any] | None:
        entry = self.find_by_thread(workspace, project_id, thread_id)
        if not entry:
            return None
        return {
            "thread_id": entry["thread_id"],
            "status": "running" if entry["runtime_status"] == "running" else "idle",
            "last_turn_status": entry.get("last_turn_status"),
            "last_stop_reason": entry.get("last_stop_reason"),
            "last_turn_error": entry.get("last_turn_error"),
            "last_turn_id": entry.get("last_turn_id"),
            "last_turn_steps": entry.get("last_turn_steps", 0),
            "last_turn_complete": entry.get("last_turn_complete", False),
            "next_turn_number": entry["turn_count"] + 1,
            "messages": entry.get("messages", []),
            "items": entry.get("items", []),
            "session": entry,
        }

    def _read_session(
        self, path: Path, project_id: str, include_history: bool
    ) -> dict[str, Any] | None:
        session_path = path / "session.jsonl"
        try:
            if session_path.stat().st_size > MAX_SESSION_BYTES:
                return None
            records = []
            skipped_oversized_records = False
            for line in session_path.read_bytes().splitlines():
                if len(line) > MAX_RECORD_BYTES:
                    skipped_oversized_records = True
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(record, dict):
                    if len(line) > MAX_RECORD_BYTES:
                        if record.get("kind") != "checkpoint":
                            continue
                        record = _checkpoint_projection(record)
                    records.append(record)
        except OSError:
            return None
        if not records:
            return None

        thread_id = ""
        latest_checkpoint: dict[str, Any] | None = None
        latest_turn_id = None
        latest_turn_status: str | None = None
        latest_stop_reason: str | None = None
        latest_turn_error: str | None = None
        latest_turn_steps = 0
        latest_turn_settled = False
        latest_turn_timestamp = 0
        turn_count = 0
        for record in records:
            kind = record.get("kind")
            if kind == "thread_started":
                thread_id = str(record.get("thread_id") or thread_id)
            elif kind == "turn_started":
                turn_count += 1
                latest_turn_id = record.get("turn_id")
                latest_turn_status = None
                latest_stop_reason = None
                latest_turn_error = None
                latest_turn_steps = 0
                latest_turn_settled = False
            elif kind == "turn_settled":
                if record.get("turn_id") == latest_turn_id:
                    latest_turn_status = str(record.get("status") or "failed")
                    latest_stop_reason = str(
                        record.get("stop_reason") or latest_turn_status
                    )
                    latest_turn_error = _bounded_text(record.get("error"))
                    latest_turn_steps = _bounded_int(record.get("steps"))
                    latest_turn_settled = True
                    latest_turn_timestamp = _bounded_int(record.get("timestamp_ms"))
            elif kind == "checkpoint":
                latest_checkpoint = record
        if not thread_id:
            return None

        summary = _read_json(path / "summary.json")
        goal = _read_json(path / "goal" / "state.json")
        plan = _read_json(path / "plan_mode.json")
        thread_settings = _read_json(path / THREAD_SETTINGS_FILE_NAME)
        cleanup = _read_json(path / "plan" / "cleanup.json")
        continuation_mode = (
            thread_settings.get("continuation_mode")
            if thread_settings.get("version") == 1
            and thread_settings.get("thread_id") == thread_id
            else None
        )
        if continuation_mode not in ("manual", "continuous"):
            continuation_mode = "manual"
        goal_status = _goal_status(goal.get("status"))
        has_lock, pid = _lock_info(path / "session.lock")
        lock_active = bool(has_lock and pid and _process_alive(pid))
        # A paused Goal is a resumable Session state even after the process has
        # released its lock. Keep lock ownership separate from lifecycle state:
        # a live process is still locked, while a user-paused process remains
        # visibly paused and can be attached by Studio later.
        runtime_status = (
            "paused"
            if goal_status == "paused"
            else "running"
            if lock_active
            else "historical"
        )
        updated_ms = _bounded_int(summary.get("updated_at_ms"))
        updated_ms = max(updated_ms, latest_turn_timestamp)
        if latest_checkpoint:
            updated_ms = max(
                updated_ms, _bounded_int(latest_checkpoint.get("timestamp_ms"))
            )
        if latest_turn_id and not latest_turn_settled:
            last_turn_status = "in_progress"
            last_stop_reason = None
            last_turn_error = None
            last_turn_complete = False
        else:
            last_turn_status = latest_turn_status or summary.get("last_status")
            last_stop_reason = latest_stop_reason or summary.get("last_stop_reason")
            last_turn_error = latest_turn_error
            last_turn_complete = last_turn_status == "completed"
        workspace_id = hashlib.sha256(str(path.parent).encode("utf-8")).hexdigest()[:16]
        entry: dict[str, Any] = {
            "session_id": path.name,
            "thread_id": thread_id,
            "project_id": project_id,
            "workspace_id": workspace_id,
            "title": str(summary.get("last_prompt") or f"会话 {thread_id}"),
            "summary": str(summary.get("last_prompt") or ""),
            "created_at": _timestamp(summary.get("created_at_ms")),
            "updated_at": _timestamp(updated_ms),
            "runtime_status": runtime_status,
            "session_status": (
                "locked"
                if lock_active
                else "paused"
                if goal_status == "paused"
                else "historical"
            ),
            "goal_status": goal_status,
            "goal": _goal_projection(goal, thread_id, goal_status),
            "plan_active": bool(plan.get("active", False)),
            "continuation_mode": continuation_mode,
            "cleanup_pending": cleanup.get("status") == "cleanup_pending",
            "active_turn_id": goal.get("active_turn_id") or latest_turn_id
            if runtime_status == "running"
            else None,
            "checkpoint_seq": latest_checkpoint.get("seq") if latest_checkpoint else 0,
            "turn_count": _bounded_int(summary.get("turn_count")) or turn_count,
            "last_turn_status": last_turn_status,
            "last_stop_reason": last_stop_reason,
            "last_turn_error": last_turn_error,
            "last_turn_id": latest_turn_id,
            "last_turn_steps": latest_turn_steps
            if latest_turn_settled
            else _bounded_int(summary.get("last_steps")),
            "last_turn_complete": last_turn_complete,
            "locked_by": pid if lock_active else None,
            "resumable": bool(latest_checkpoint) and not lock_active,
            "history_truncated": skipped_oversized_records,
        }
        if include_history:
            entry["messages"] = (
                latest_checkpoint.get("messages", []) if latest_checkpoint else []
            )
            entry["items"] = [
                {"turnId": record.get("turn_id"), "item": projected}
                for record in records
                if record.get("kind") == "item"
                for projected in [_item_projection(record)]
                if projected is not None
            ][-256:]
        return entry


session_catalog = SessionCatalog()
