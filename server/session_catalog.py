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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

MAX_SESSIONS = 128
MAX_SESSION_BYTES = 8 * 1024 * 1024
MAX_RECORD_BYTES = 64 * 1024


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


def _process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except (OSError, PermissionError):
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
            "text": str(message.get("text") or ""),
        }
    if role == "assistant":
        return {
            "type": "agentMessage",
            "id": item_id,
            "text": str(message.get("text") or ""),
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
            "output": str(outcome.get("content") or "")
            if isinstance(outcome, dict)
            else None,
        }
    if role == "context":
        return {"type": "contextCompaction", "id": item_id, "status": "completed"}
    return None


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
        entries.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
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
        for path in base.iterdir():
            if not path.is_dir() or not (path / "session.jsonl").is_file():
                continue
            entry = self._read_session(path, project_id, include_history=True)
            if entry and entry.get("thread_id") == thread_id:
                return entry
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
            for line in session_path.read_bytes().splitlines():
                if len(line) > MAX_RECORD_BYTES:
                    return None
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(record, dict):
                    records.append(record)
        except OSError:
            return None
        if not records:
            return None

        thread_id = ""
        latest_checkpoint: dict[str, Any] | None = None
        latest_turn_id = None
        turn_count = 0
        for record in records:
            kind = record.get("kind")
            if kind == "thread_started":
                thread_id = str(record.get("thread_id") or thread_id)
            elif kind == "turn_started":
                turn_count += 1
                latest_turn_id = record.get("turn_id")
            elif kind == "checkpoint":
                latest_checkpoint = record
        if not thread_id:
            return None

        summary = _read_json(path / "summary.json")
        goal = _read_json(path / "goal" / "state.json")
        plan = _read_json(path / "plan_mode.json")
        goal_status = _goal_status(goal.get("status"))
        has_lock, pid = _lock_info(path / "session.lock")
        runtime_status = (
            "paused"
            if goal_status == "paused" and has_lock and pid and _process_alive(pid)
            else "running"
            if has_lock and pid and _process_alive(pid)
            else ("locked" if has_lock else "historical")
        )
        updated_ms = summary.get("updated_at_ms") or 0
        if latest_checkpoint:
            updated_ms = max(updated_ms, latest_checkpoint.get("timestamp_ms") or 0)
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
            "session_status": "locked" if has_lock else "historical",
            "goal_status": goal_status,
            "goal": goal or None,
            "plan_active": bool(plan.get("active", False)),
            "active_turn_id": goal.get("active_turn_id") or latest_turn_id
            if runtime_status == "running"
            else None,
            "checkpoint_seq": latest_checkpoint.get("seq") if latest_checkpoint else 0,
            "turn_count": int(summary.get("turn_count") or turn_count),
            "locked_by": pid,
            "resumable": bool(latest_checkpoint) and not has_lock,
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
