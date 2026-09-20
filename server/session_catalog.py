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

from server.thread_titles import build_auto_thread_title

MAX_SESSIONS = 128
# Keep this at least as large as the App Server SessionStore limit. Oversized
# checkpoint records are projected below, so a large history remains readable
# without copying its full model context into the Gateway response.
MAX_SESSION_BYTES = 32 * 1024 * 1024
MAX_RECORD_BYTES = 64 * 1024
MAX_ERROR_CHARS = 2048
MAX_CHECKPOINT_MESSAGES = 64
MAX_TURN_PRESENTATIONS = 64
MAX_TURN_PRESENTATION_ACTIVITIES = 32
MAX_TURN_PRESENTATION_SKILLS = 8
MAX_CHECKPOINT_MESSAGE_CHARS = 16 * 1024
MAX_ITEM_LIST_LIMIT = 128
MAX_OPERATION_LIFECYCLE_ENTRIES = 32
MAX_NOTEBOOK_ENTRIES = 64
MAX_NOTEBOOK_CONTENT_BYTES = 4096
MAX_NOTEBOOK_ENTRY_BYTES = MAX_NOTEBOOK_CONTENT_BYTES
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


def _bounded_utf8_text(value: Any, max_bytes: int) -> str | None:
    """Bound Notebook content by its UTF-8 byte size."""
    if not isinstance(value, str) or not value:
        return None
    encoded = value.encode("utf-8")
    if len(encoded) <= max_bytes:
        return value
    suffix = "…"
    prefix = encoded[: max(0, max_bytes - len(suffix.encode("utf-8")))]
    return prefix.decode("utf-8", errors="ignore") + suffix


def _field(value: dict[str, Any], snake: str, camel: str) -> Any:
    """Read canonical Rust JSON while tolerating legacy snake_case fixtures."""
    return value.get(camel, value.get(snake))


def _entry_has_conversation_history(entry: dict[str, Any]) -> bool:
    """Distinguish conversation messages from an empty Session header."""
    if _bounded_int(entry.get("turn_count")) > 0:
        return True
    messages = entry.get("messages")
    return any(
        isinstance(message, dict)
        and message.get("role") in {"user", "assistant", "tool"}
        for message in messages or []
    )


def _first_user_prompt(records: list[dict[str, Any]]) -> str:
    """Read the first bounded user prompt from canonical event history."""
    for record in records:
        if record.get("kind") == "turn_started":
            prompt = record.get("prompt")
            if isinstance(prompt, str) and prompt.strip():
                return prompt
        if record.get("kind") != "item":
            continue
        message = record.get("message")
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        text = message.get("text")
        if isinstance(text, str) and text.strip():
            return text
    return ""


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
        return _with_item_timestamp(
            record,
            {
                "type": "userMessage",
                "id": item_id,
                "text": _bounded_text(message.get("text"), 16 * 1024) or "",
            },
        )
    if role == "assistant":
        return _with_item_timestamp(
            record,
            {
                "type": "agentMessage",
                "id": item_id,
                "text": _bounded_text(message.get("text"), 16 * 1024) or "",
            },
        )
    if role == "tool":
        outcome = message.get("outcome")
        output = (
            outcome.get("content")
            if isinstance(outcome, dict)
            else message.get("content")
        )
        if isinstance(outcome, dict):
            outcome_name = outcome.get("status") or outcome.get("outcome")
        else:
            outcome_name = outcome
        outcome_name = str(outcome_name or "").lower()
        known_outcome = (
            outcome_name
            if outcome_name
            in {"completed", "failed", "needs_approval", "deferred", "retryable"}
            else None
        )
        failed = (
            bool(message.get("is_error"))
            or (isinstance(outcome, dict) and bool(outcome.get("error")))
            or outcome_name in {"failed", "error", "cancelled"}
        )
        projected = {
            "type": "toolCall",
            "id": item_id,
            "name": str(message.get("name") or "tool"),
            # Newer SessionStore records keep the bounded projection on the
            # item record; older records may have put it on the message.
            "arguments": record.get("arguments")
            or message.get("arguments")
            or message.get("args")
            or {},
            "status": "failed" if failed else "completed",
            # Tool settlement content is stored directly on Message::Tool in
            # the canonical session JSONL. Keep compatibility with the
            # earlier dict-shaped outcome projection as well.
            "output": _bounded_text(output, 16 * 1024),
        }
        if known_outcome is not None:
            projected["outcome"] = known_outcome
        return _with_item_timestamp(record, projected)
    if role == "context":
        # Context updates used to be stored without a Turn (for example the
        # initial world-state snapshot). They are not compactions and must not
        # become visible compression cards. A context record associated with a
        # Turn is the durable compaction projection.
        if record.get("item_kind") != "context_compaction" and not record.get(
            "turn_id"
        ):
            return None
        return _with_item_timestamp(
            record,
            {
                "type": "contextCompaction",
                "id": item_id,
                "status": "completed",
            },
        )
    return None


def _with_item_timestamp(
    record: dict[str, Any], projection: dict[str, Any]
) -> dict[str, Any]:
    """Expose the bounded persistence timestamp without exposing raw records."""
    captured_at = _timestamp(record.get("timestamp_ms"))
    if captured_at:
        projection["capturedAt"] = captured_at
    return projection


def _item_projections(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Project one persisted item, preserving assistant reasoning separately."""
    message = record.get("message")
    if not isinstance(message, dict):
        return []
    if message.get("role") != "assistant":
        projected = _item_projection(record)
        return [projected] if projected is not None else []

    item_id = str(record.get("item_id") or "")
    projections: list[dict[str, Any]] = []
    reasoning = _bounded_text(message.get("reasoning"), 16 * 1024)
    if reasoning:
        projections.append(
            {
                "type": "reasoning",
                "id": f"{item_id}:reasoning",
                "segmentId": item_id,
                "text": reasoning,
            }
        )
    text = _bounded_text(message.get("text"), 16 * 1024)
    if text:
        projections.append(
            {
                "type": "agentMessage",
                "id": f"{item_id}:agent",
                "segmentId": item_id,
                "text": text,
            }
        )
    captured_at = _timestamp(record.get("timestamp_ms"))
    if captured_at:
        for projection in projections:
            projection["capturedAt"] = captured_at
    return projections


def _turn_presentation_projection(record: dict[str, Any]) -> dict[str, Any] | None:
    """Project bounded, Host-owned workflow activity from a Turn record."""
    presentation = record.get("presentation")
    turn_id = _bounded_text(record.get("turn_id"), 128)
    if not isinstance(presentation, dict) or not turn_id:
        return None

    projected: dict[str, Any] = {"turnId": turn_id, "activities": []}
    workflow = presentation.get("workflow")
    if isinstance(workflow, dict):
        workflow_id = _bounded_text(workflow.get("id"), 256)
        workflow_kind = _bounded_text(workflow.get("kind"), 64)
        workflow_mode = _bounded_text(workflow.get("mode"), 64)
        if workflow_id and workflow_kind and workflow_mode:
            projected["workflow"] = {
                "id": workflow_id,
                "kind": workflow_kind,
                "mode": workflow_mode,
            }

    activities = presentation.get("activities")
    if not isinstance(activities, list):
        return projected
    for activity in activities[:MAX_TURN_PRESENTATION_ACTIVITIES]:
        if not isinstance(activity, dict):
            continue
        kind = _bounded_text(activity.get("kind"), 64)
        after_segments = _bounded_int(activity.get("afterAssistantSegments"))
        if kind not in {
            "skill_group_activated",
            "skills_loaded",
            "skills_load_failed",
        }:
            continue
        item: dict[str, Any] = {
            "kind": kind,
            "afterAssistantSegments": after_segments,
        }
        for source, target in (
            ("group", "group"),
            ("source", "source"),
            ("phase", "phase"),
            ("activation", "activation"),
            ("reasonCode", "reasonCode"),
        ):
            value = _bounded_text(activity.get(source), 256)
            if value:
                item[target] = value
        skills = activity.get("skills")
        if isinstance(skills, list):
            item["skills"] = [
                value
                for value in (
                    _bounded_text(skill, 256)
                    for skill in skills[:MAX_TURN_PRESENTATION_SKILLS]
                )
                if value
            ]
        projected["activities"].append(item)
    return projected


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
            projected = {
                "role": role,
                "text": _bounded_text(message.get("text"), MAX_CHECKPOINT_MESSAGE_CHARS)
                or "",
            }
            if role == "assistant":
                projected["reasoning"] = (
                    _bounded_text(
                        message.get("reasoning"), MAX_CHECKPOINT_MESSAGE_CHARS
                    )
                    or ""
                )
                tool_calls = message.get("tool_calls")
                if isinstance(tool_calls, list):
                    projected["tool_calls"] = [
                        {
                            "id": str(call.get("id") or ""),
                            "name": str(call.get("name") or "tool"),
                        }
                        for call in tool_calls[:24]
                        if isinstance(call, dict) and call.get("id")
                    ]
            bounded_messages.append(projected)
    return {
        "kind": "checkpoint",
        "thread_id": record.get("thread_id"),
        "seq": _bounded_int(record.get("seq")),
        "timestamp_ms": _bounded_int(record.get("timestamp_ms")),
        "messages": bounded_messages,
    }


def _read_session_records(path: Path) -> tuple[list[dict[str, Any]], bool] | None:
    """Read bounded SessionStore records for projections and history queries."""
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
    return records, skipped_oversized_records


class SessionCatalog:
    """Bounded, read-only SessionStore listing and history reader."""

    @staticmethod
    def _valid_session_path(base: Path, session_id: str) -> Path | None:
        path = base / session_id
        if (
            path.name != session_id
            or not path.is_dir()
            or not (path / "session.jsonl").is_file()
        ):
            return None
        return path

    def _find_thread_session(
        self,
        base: Path,
        project_id: str,
        thread_id: str,
        excluded_session_id: str | None = None,
    ) -> dict[str, Any] | None:
        """Find the best readable Session when an index entry is stale.

        A crash during restart can leave thread_index.json pointing at a newly
        created empty Session while the previous Session still contains the
        actual conversation. History-bearing Sessions win over empty Sessions,
        while lock state remains visible to the caller for safe attach decisions.
        """
        candidates: list[dict[str, Any]] = []
        try:
            paths = sorted(base.iterdir(), key=lambda path: path.name)
        except OSError:
            return None
        for path in paths:
            if path.name == excluded_session_id:
                continue
            if not path.is_dir() or not (path / "session.jsonl").is_file():
                continue
            entry = self._read_session(path, project_id, include_history=True)
            if not entry or entry.get("thread_id") != thread_id:
                continue
            candidates.append(entry)
        if not candidates:
            return None
        return max(
            candidates,
            key=lambda item: (
                _entry_has_conversation_history(item),
                _bounded_int(item.get("turn_count")),
                str(item.get("updated_at") or ""),
                str(item.get("session_id") or ""),
            ),
        )

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

    def list_child_sessions(
        self,
        workspace: Path,
        project_id: str,
        parent_session_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Read every persisted delegated child, optionally for one parent."""
        base = _session_base(workspace)
        entries = []
        if base.is_dir():
            for path in base.iterdir():
                if not path.is_dir() or not (path / "session.jsonl").is_file():
                    continue
                entry = self._read_session(path, project_id, include_history=False)
                if not entry or entry.get("is_child_task") is not True:
                    continue
                if (
                    parent_session_id is not None
                    and entry.get("parent_session_id") != parent_session_id
                ):
                    continue
                entries.append(entry)
        entries.sort(
            key=lambda item: (
                item.get("updated_at") or "",
                str(item.get("session_id") or ""),
                str(item.get("thread_id") or ""),
            ),
            reverse=True,
        )
        return entries

    def find_by_thread(
        self, workspace: Path, project_id: str, thread_id: str
    ) -> dict[str, Any] | None:
        base = _session_base(workspace)
        if not base.is_dir():
            return None

        indexed_session_id = _read_thread_index(base).get(thread_id)
        if indexed_session_id:
            indexed_path = self._valid_session_path(base, indexed_session_id)
            if indexed_path:
                entry = self._read_session(
                    indexed_path, project_id, include_history=True
                )
                if entry and entry.get("thread_id") == thread_id:
                    # A valid but empty replacement Session must not hide a
                    # previous conversation after a restart. Once history is
                    # present, the index remains authoritative.
                    if _entry_has_conversation_history(entry):
                        return entry
                    recovered = self._find_thread_session(
                        base,
                        project_id,
                        thread_id,
                        excluded_session_id=indexed_session_id,
                    )
                    return recovered or entry

        # Legacy sessions created before thread_index.json remain readable. This
        # is a migration fallback, not the normal request-time lookup path.
        return self._find_thread_session(base, project_id, thread_id)

    def find_session_path(self, workspace: Path, thread_id: str) -> Path | None:
        """Resolve a Thread to its Session directory with restart recovery."""
        base = _session_base(workspace)
        if not base.is_dir():
            return None
        entry = self.find_by_thread(workspace, "", thread_id)
        if not entry:
            return None
        return self._valid_session_path(base, str(entry.get("session_id") or ""))

    def read_thread(
        self, workspace: Path, project_id: str, thread_id: str
    ) -> dict[str, Any] | None:
        entry = self.find_by_thread(workspace, project_id, thread_id)
        if not entry:
            return None
        return {
            "thread_id": entry["thread_id"],
            "status": "running" if entry.get("turn_active") else "idle",
            "turn_active": entry.get("turn_active", False),
            "process_online": entry.get("process_online", False),
            "last_turn_status": entry.get("last_turn_status"),
            "last_stop_reason": entry.get("last_stop_reason"),
            "last_turn_error": entry.get("last_turn_error"),
            "last_turn_id": entry.get("last_turn_id"),
            "last_turn_steps": entry.get("last_turn_steps", 0),
            "last_turn_complete": entry.get("last_turn_complete", False),
            "next_turn_number": entry["turn_count"] + 1,
            "messages": entry.get("messages", []),
            "items": entry.get("items", []),
            "presentations": entry.get("presentations", []),
            "session": entry,
        }

    def list_thread_items(
        self,
        workspace: Path,
        project_id: str,
        thread_id: str,
        turn_id: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
        sort_direction: str | None = None,
    ) -> dict[str, Any] | None:
        """Return a bounded page over the complete persisted item projection.

        ``read_thread`` intentionally keeps a small preview for checkpoint
        reads. The history rail needs a different contract: it must be able
        to walk every persisted Turn without copying the full SessionStore
        into one HTTP response. Integer cursors match the App Server item
        listing contract.
        """
        entry = self.find_by_thread(workspace, project_id, thread_id)
        if not entry:
            return None
        session_path = self._valid_session_path(
            _session_base(workspace), str(entry.get("session_id") or "")
        )
        if not session_path:
            return None
        loaded = _read_session_records(session_path)
        if loaded is None:
            return None
        records, _skipped_oversized_records = loaded
        user_turns = {
            str(record.get("turn_id"))
            for record in records
            if record.get("kind") == "item"
            and isinstance(record.get("message"), dict)
            and record["message"].get("role") == "user"
            and record.get("turn_id")
        }
        turn_input_sources: dict[str, str] = {}
        turn_input_prompts: dict[str, tuple[str, str | None, str | None]] = {}
        previous_turn_was_steered = False
        for record in records:
            record_kind = record.get("kind")
            record_turn_id = record.get("turn_id")
            if record_kind == "turn_settled":
                previous_turn_was_steered = record.get("status") == "steered"
            elif record_kind == "turn_started" and record_turn_id:
                key = str(record_turn_id)
                turn_input_sources[key] = (
                    "steer" if previous_turn_was_steered else "user"
                )
                previous_turn_was_steered = False
                prompt = _bounded_text(record.get("prompt"), 16 * 1024)
                presentation = record.get("presentation")
                turn_source = (
                    presentation.get("turnSource") or presentation.get("turn_source")
                    if isinstance(presentation, dict)
                    else None
                )
                turn_input_prompts[key] = (
                    prompt,
                    _timestamp(record.get("timestamp_ms")),
                    str(turn_source) if turn_source else None,
                )

        entries: list[dict[str, Any]] = []
        user_index_by_turn: dict[str, int] = {}
        for record in records:
            record_turn_id = record.get("turn_id")
            record_turn_key = str(record_turn_id) if record_turn_id else None
            if record.get("kind") == "turn_started" and record_turn_key:
                prompt, captured_at, turn_source = turn_input_prompts.get(
                    record_turn_key, ("", None, None)
                )
                if (
                    record_turn_key not in user_turns
                    and prompt
                    and turn_source != "child_wakeup"
                    and (turn_id is None or record_turn_key == str(turn_id))
                ):
                    item = {
                        "type": "userMessage",
                        "id": f"{record_turn_key}:user",
                        "text": prompt,
                        "inputSource": turn_input_sources.get(record_turn_key, "user"),
                    }
                    if captured_at:
                        item["capturedAt"] = captured_at
                    projected_entry: dict[str, Any] = {
                        "turnId": record_turn_key,
                        "item": item,
                        "turnSource": turn_source,
                    }
                    entries.append(projected_entry)

            if record.get("kind") != "item":
                continue
            if turn_id is not None and record_turn_key != str(turn_id):
                continue
            for projected in _item_projections(record):
                if projected.get("type") == "userMessage" and record_turn_key:
                    input_index = user_index_by_turn.get(record_turn_key, 0)
                    projected["inputSource"] = (
                        "steer"
                        if input_index > 0
                        or turn_input_sources.get(record_turn_key) == "steer"
                        else "user"
                    )
                    user_index_by_turn[record_turn_key] = input_index + 1
                projected_entry = {
                    "turnId": record_turn_id,
                    "item": projected,
                }
                if record_turn_key:
                    projected_entry["turnSource"] = turn_input_prompts.get(
                        record_turn_key, ("", None, None)
                    )[2]
                entries.append(projected_entry)
        if sort_direction == "desc":
            entries.reverse()

        start = int(cursor) if cursor and cursor.isdigit() else 0
        page_limit = max(1, min(limit or MAX_ITEM_LIST_LIMIT, MAX_ITEM_LIST_LIMIT))
        data = entries[start : start + page_limit]
        next_cursor = (
            str(start + len(data)) if start + len(data) < len(entries) else None
        )
        backwards_cursor = str(max(0, start - page_limit)) if start > 0 else None
        return {
            "thread_id": thread_id,
            "data": data,
            "next_cursor": next_cursor,
            "backwards_cursor": backwards_cursor,
        }

    def read_notebook(
        self,
        workspace: Path,
        project_id: str,
        thread_id: str,
        scope: str = "self",
        max_entries: int = MAX_NOTEBOOK_ENTRIES,
        max_entry_bytes: int = MAX_NOTEBOOK_ENTRY_BYTES,
    ) -> dict[str, Any] | None:
        """Read a bounded Session notebook projection without exposing paths."""
        entry = self.find_by_thread(workspace, project_id, thread_id)
        if not entry:
            return None
        base = _session_base(workspace)
        session_path = self._valid_session_path(
            base, str(entry.get("session_id") or "")
        )
        if not session_path:
            return None
        if scope == "parent":
            parent_session_id = entry.get("parent_session_id")
            if not isinstance(parent_session_id, str) or not parent_session_id:
                return {
                    "thread_id": thread_id,
                    "scope": "parent",
                    "available": False,
                    "entries": [],
                }
            parent_path = self._valid_session_path(base, parent_session_id)
            if not parent_path:
                return {
                    "thread_id": thread_id,
                    "scope": "parent",
                    "available": False,
                    "entries": [],
                }
            session_path = parent_path
        elif scope != "self":
            return None
        notebook = _read_json(session_path / "notebook.json")
        raw_entries = notebook.get("entries")
        entries = []
        if isinstance(raw_entries, list):
            for raw_entry in raw_entries[
                : max(1, min(max_entries, MAX_NOTEBOOK_ENTRIES))
            ]:
                if not isinstance(raw_entry, dict):
                    continue
                key = _bounded_text(raw_entry.get("key"), 96)
                content = _bounded_utf8_text(
                    raw_entry.get("content"),
                    max(1, min(max_entry_bytes, MAX_NOTEBOOK_ENTRY_BYTES)),
                )
                if key and content is not None:
                    importance = raw_entry.get("importance")
                    if importance not in {"critical", "high", "normal", "temporary"}:
                        importance = "normal"
                    entries.append(
                        {
                            "key": key,
                            "content": content,
                            "importance": importance,
                            "updated_at": _timestamp(
                                _field(raw_entry, "updated_at_ms", "updatedAtMs")
                            ),
                            "keywords": [
                                item
                                for item in (raw_entry.get("keywords") or [])[:12]
                                if isinstance(item, str) and item.strip()
                            ],
                            "evidence": [
                                {
                                    "kind": item.get("kind"),
                                    "project": _bounded_text(item.get("project"), 256),
                                    "commit": _bounded_text(item.get("commit"), 256),
                                    "path": _bounded_text(item.get("path"), 256),
                                    "subject": _bounded_text(item.get("subject"), 160),
                                    "subject_truncated": bool(
                                        _field(
                                            item,
                                            "subject_truncated",
                                            "subjectTruncated",
                                        )
                                    ),
                                    "author_at": _bounded_text(
                                        _field(item, "author_at", "authorAt"), 256
                                    ),
                                    "committed_at": _bounded_text(
                                        _field(item, "committed_at", "committedAt"), 256
                                    ),
                                    "recorded_at": _timestamp(
                                        _field(item, "recorded_at_ms", "recordedAtMs")
                                    ),
                                }
                                for item in (raw_entry.get("evidence") or [])[:8]
                                if isinstance(item, dict)
                            ],
                        }
                    )
        entries.sort(
            key=lambda item: (
                {"critical": 4, "high": 3, "normal": 2, "temporary": 1}.get(
                    item["importance"], 2
                ),
                item.get("updated_at") or "",
                item["key"],
            ),
            reverse=True,
        )
        return {
            "thread_id": thread_id,
            "scope": scope,
            "available": True,
            "version": _bounded_int(notebook.get("version")) or 1,
            "revision": _bounded_int(notebook.get("revision")),
            "updated_at": _timestamp(notebook.get("updated_at_ms")),
            "entries": entries,
        }

    def _read_session(
        self, path: Path, project_id: str, include_history: bool
    ) -> dict[str, Any] | None:
        loaded = _read_session_records(path)
        if loaded is None:
            return None
        records, skipped_oversized_records = loaded
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
        latest_turn_started_at = 0
        latest_turn_prompt: str | None = None
        turn_count = 0
        forked_from: dict[str, Any] | None = None
        latest_operation: dict[str, Any] | None = None
        child_task_operation: dict[str, Any] | None = None
        child_task_lifecycle: list[dict[str, int | str | None]] = []
        child_task_reports: list[dict[str, int | str]] = []
        first_user_prompt = _first_user_prompt(records)
        for record in records:
            kind = record.get("kind")
            if kind == "session_created":
                lineage = record.get("forked_from")
                if isinstance(lineage, dict):
                    forked_from = lineage
            elif kind == "thread_started":
                thread_id = str(record.get("thread_id") or thread_id)
            elif kind == "turn_started":
                turn_count += 1
                latest_turn_id = record.get("turn_id")
                latest_turn_started_at = _bounded_int(record.get("timestamp_ms"))
                latest_turn_prompt = _bounded_text(record.get("prompt"), 32 * 1024)
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
            elif kind == "operation":
                operation_id = _bounded_text(record.get("operation_id"), 128)
                operation_kind = _bounded_text(record.get("operation_kind"), 64)
                operation_status = _bounded_text(record.get("status"), 32)
                if operation_id and operation_kind and operation_status:
                    attempt = _bounded_int(record.get("attempt")) or 1
                    timestamp_ms = _bounded_int(record.get("timestamp_ms")) or None
                    operation_projection = {
                        "operation_id": operation_id,
                        "operation_kind": operation_kind,
                        "operation_status": operation_status,
                        "operation_parent_thread_id": _bounded_text(
                            record.get("parent_thread_id"), 128
                        ),
                        "operation_turn_id": _bounded_text(record.get("turn_id"), 128),
                        "operation_attempt": attempt,
                        "operation_prompt": _bounded_text(
                            record.get("prompt"), 32 * 1024
                        ),
                        "operation_group_id": _bounded_text(
                            record.get("operation_group_id"), 128
                        ),
                        "execution_mode": _bounded_text(
                            record.get("execution_mode"), 16
                        ),
                        "group_sequence": _bounded_int(record.get("group_sequence"))
                        if record.get("group_sequence") is not None
                        else None,
                        "operation_result": _bounded_text(
                            record.get("result"), 16 * 1024
                        ),
                        "operation_error": _bounded_text(record.get("error")),
                        "operation_updated_at": _timestamp(timestamp_ms),
                    }
                    # Keep the generic projection faithful to the last persisted
                    # operation. Child-task state is projected separately below.
                    latest_operation = operation_projection
                    if operation_kind == "child_task":
                        if (
                            child_task_operation is None
                            or child_task_operation.get("operation_id") != operation_id
                        ):
                            child_task_lifecycle = []
                        lifecycle_entry: dict[str, int | str | None] = {
                            "status": operation_status,
                            "timestamp_ms": timestamp_ms,
                            "attempt": attempt,
                        }
                        previous_attempt_entry = next(
                            (
                                item
                                for item in reversed(child_task_lifecycle)
                                if item.get("attempt") == attempt
                            ),
                            None,
                        )
                        terminal_statuses = {"completed", "failed", "cancelled"}
                        stale_regression = bool(
                            previous_attempt_entry
                            and (
                                previous_attempt_entry.get("status")
                                in terminal_statuses
                                or (
                                    operation_status == "queued"
                                    and previous_attempt_entry.get("status") != "queued"
                                )
                            )
                        )
                        if not stale_regression and (
                            not previous_attempt_entry
                            or any(
                                previous_attempt_entry.get(key) != lifecycle_entry[key]
                                for key in ("status", "attempt")
                            )
                        ):
                            child_task_lifecycle.append(lifecycle_entry)
                            child_task_lifecycle = child_task_lifecycle[
                                -MAX_OPERATION_LIFECYCLE_ENTRIES:
                            ]
                        if not stale_regression:
                            previous_child_task_operation = child_task_operation
                            child_task_operation = dict(operation_projection)
                            child_task_operation["operation_timestamp_ms"] = (
                                timestamp_ms
                            )
                            if (
                                not child_task_operation.get(
                                    "operation_parent_thread_id"
                                )
                                and previous_child_task_operation
                                and previous_child_task_operation.get("operation_id")
                                == operation_id
                            ):
                                child_task_operation["operation_parent_thread_id"] = (
                                    previous_child_task_operation.get(
                                        "operation_parent_thread_id"
                                    )
                                )
            elif kind == "child_report" and child_task_operation:
                report = _bounded_text(record.get("report"), 4096)
                operation_id = _bounded_text(record.get("operation_id"), 128)
                cursor = _bounded_int(record.get("seq"))
                report_id = _bounded_text(record.get("report_id"), 128)
                if (
                    report
                    and operation_id == child_task_operation.get("operation_id")
                    and report_id
                    and cursor
                ):
                    child_task_reports.append(
                        {
                            "cursor": cursor,
                            "report_id": report_id,
                            "attempt": _bounded_int(record.get("attempt")) or 1,
                            "timestamp_ms": _bounded_int(record.get("timestamp_ms")),
                            "report": report,
                        }
                    )
                    child_task_reports = child_task_reports[-32:]
        operation_matches_settled_turn = bool(
            child_task_operation
            and latest_turn_settled
            and latest_turn_id
            and (
                child_task_operation.get("operation_turn_id") == latest_turn_id
                or (
                    child_task_operation.get("operation_status") == "queued"
                    and not child_task_operation.get("operation_turn_id")
                    and child_task_operation.get("operation_prompt")
                    and child_task_operation.get("operation_prompt")
                    == latest_turn_prompt
                    and latest_turn_started_at
                    and child_task_operation.get("operation_timestamp_ms") is not None
                    and _bounded_int(child_task_operation.get("operation_timestamp_ms"))
                    <= latest_turn_started_at
                )
            )
            and child_task_operation.get("operation_status")
            in {"queued", "running", "awaiting_approval"}
        )
        if operation_matches_settled_turn and child_task_operation:
            settled_operation_status = {
                "completed": "completed",
                "cancelled": "cancelled",
                "interrupted": "cancelled",
                "failed": "failed",
                "step_limit": "failed",
            }.get(str(latest_turn_status))
            if settled_operation_status:
                latest_attempt = (
                    _bounded_int(child_task_operation.get("operation_attempt")) or 1
                )
                current_lifecycle = [
                    item
                    for item in child_task_lifecycle
                    if item.get("attempt") == latest_attempt
                ]
                has_start_stage = any(
                    item.get("status") in {"running", "awaiting_approval"}
                    for item in current_lifecycle
                )
                if (
                    not has_start_stage
                    and latest_turn_started_at
                    and child_task_operation.get("operation_prompt")
                    == latest_turn_prompt
                ):
                    child_task_lifecycle.append(
                        {
                            "status": "running",
                            "timestamp_ms": latest_turn_started_at,
                            "attempt": latest_attempt,
                        }
                    )
                child_task_operation["operation_status"] = settled_operation_status
                child_task_operation["operation_updated_at"] = _timestamp(
                    latest_turn_timestamp
                )
                child_task_operation["operation_timestamp_ms"] = (
                    latest_turn_timestamp or None
                )
                terminal_entry: dict[str, int | str | None] = {
                    "status": settled_operation_status,
                    "timestamp_ms": latest_turn_timestamp or None,
                    "attempt": latest_attempt,
                }
                if not child_task_lifecycle or any(
                    child_task_lifecycle[-1].get(key) != terminal_entry[key]
                    for key in ("status", "attempt")
                ):
                    child_task_lifecycle.append(terminal_entry)
                    child_task_lifecycle = child_task_lifecycle[
                        -MAX_OPERATION_LIFECYCLE_ENTRIES:
                    ]
        child_task_state: dict[str, Any] | None = None
        if child_task_operation:
            latest_attempt = (
                _bounded_int(child_task_operation.get("operation_attempt")) or 1
            )
            current_lifecycle = [
                item
                for item in child_task_lifecycle
                if item.get("attempt") == latest_attempt
            ]
            started_at_ms = next(
                (
                    _bounded_int(item.get("timestamp_ms"))
                    for item in current_lifecycle
                    if item.get("status") in {"running", "awaiting_approval"}
                    and _bounded_int(item.get("timestamp_ms"))
                ),
                0,
            )
            finished_at_ms = next(
                (
                    _bounded_int(item.get("timestamp_ms"))
                    for item in reversed(current_lifecycle)
                    if item.get("status") in {"completed", "failed", "cancelled"}
                    and _bounded_int(item.get("timestamp_ms"))
                ),
                0,
            )
            duration_ms = (
                max(0, finished_at_ms - started_at_ms)
                if started_at_ms and finished_at_ms
                else None
            )
            child_task_state = {
                "operation_id": child_task_operation.get("operation_id"),
                "parent_thread_id": child_task_operation.get(
                    "operation_parent_thread_id"
                ),
                "turn_id": child_task_operation.get("operation_turn_id"),
                "attempt": latest_attempt,
                "status": child_task_operation.get("operation_status"),
                "prompt": child_task_operation.get("operation_prompt"),
                "group_id": child_task_operation.get("operation_group_id"),
                "execution_mode": child_task_operation.get("execution_mode"),
                "sequence": child_task_operation.get("group_sequence"),
                "result": child_task_operation.get("operation_result"),
                "error": child_task_operation.get("operation_error"),
                "updated_at": child_task_operation.get("operation_updated_at"),
                "timestamp_ms": child_task_operation.get("operation_timestamp_ms"),
                "lifecycle": child_task_lifecycle,
                "started_at_ms": started_at_ms or None,
                "finished_at_ms": finished_at_ms or None,
                "duration_ms": duration_ms,
                "reports": child_task_reports,
                "next_cursor": child_task_reports[-1]["cursor"]
                if child_task_reports
                else 0,
            }
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
        turn_active = bool(latest_turn_id and not latest_turn_settled and lock_active)
        entry: dict[str, Any] = {
            "session_id": path.name,
            "thread_id": thread_id,
            "project_id": project_id,
            "workspace_id": workspace_id,
            "title": (
                build_auto_thread_title(first_user_prompt)
                or str(summary.get("last_prompt") or f"会话 {thread_id}")
            ),
            "summary": str(summary.get("last_prompt") or ""),
            "created_at": _timestamp(summary.get("created_at_ms")),
            "updated_at": _timestamp(updated_ms),
            "runtime_status": runtime_status,
            # Keep Turn activity separate from the SessionStore process lock.
            # A live/idle App Server process is online, but only an unsettled
            # Turn should be shown as running in the Studio sidebar.
            # An unsettled record without a live SessionStore lock is a
            # recoverable/interrupted turn, not a currently running Turn.
            "turn_active": turn_active,
            "process_online": lock_active,
            "session_status": (
                "locked"
                if lock_active
                else "paused"
                if goal_status == "paused"
                else "historical"
            ),
            "goal_status": goal_status,
            "goal": _goal_projection(goal, thread_id, goal_status),
            "is_child_task": child_task_operation is not None,
            "plan_active": bool(plan.get("active", False)),
            "plan_review_pending": bool(
                plan.get("active", False) and plan.get("review_pending", False)
            ),
            "continuation_mode": continuation_mode,
            "cleanup_pending": cleanup.get("status") == "cleanup_pending",
            "active_turn_id": goal.get("active_turn_id") or latest_turn_id
            if turn_active
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
        if latest_operation:
            entry.update(latest_operation)
        if child_task_state:
            entry["child_task_state"] = child_task_state
        if forked_from:
            parent_session_id = forked_from.get("parent_session_id")
            if isinstance(parent_session_id, str) and parent_session_id:
                entry["parent_session_id"] = parent_session_id
            parent_checkpoint_seq = forked_from.get("parent_checkpoint_seq")
            if isinstance(parent_checkpoint_seq, (int, float)) and not isinstance(
                parent_checkpoint_seq, bool
            ):
                entry["parent_checkpoint_seq"] = max(0, int(parent_checkpoint_seq))
            for source_key, target_key in (
                ("context_policy", "context_policy"),
                ("context_before_bytes", "context_before_bytes"),
                ("context_after_bytes", "context_after_bytes"),
                ("compacted", "compacted"),
                ("method", "compaction_method"),
            ):
                value = forked_from.get(source_key)
                if value is not None:
                    entry[target_key] = value
        if include_history:
            entry["messages"] = (
                latest_checkpoint.get("messages", []) if latest_checkpoint else []
            )
            entry["items"] = [
                {"turnId": record.get("turn_id"), "item": projected}
                for record in records
                if record.get("kind") == "item"
                for projected in _item_projections(record)
            ][-256:]
            entry["presentations"] = [
                projection
                for record in records
                if record.get("kind") == "turn_started"
                for projection in [_turn_presentation_projection(record)]
                if projection is not None
            ][-MAX_TURN_PRESENTATIONS:]
        return entry


session_catalog = SessionCatalog()
