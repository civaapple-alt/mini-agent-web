"""
Thread management endpoints with metadata enrichment (title, summary, date grouping).
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from mini_agent.errors import (
    SESSION_FORK_CONFLICT_CODE,
    AppServerError,
    ServerProcessError,
)
from pydantic import BaseModel, Field

from server.control.fork_errors import SessionForkConflictError
from server.routes.agent_models import MAX_TEXT_ATTACHMENT_BYTES
from server.session_catalog import session_catalog
from server.session_doctor import (
    SessionDoctorError,
    inspect_project_sessions,
    repair_project_session,
)
from server.session_manager import (
    MAX_CHILD_TASK_PROMPT_BYTES,
    session_manager,
    to_json_serializable,
)
from server.thread_attention import thread_attention_reasons
from server.thread_titles import is_default_thread_title

router = APIRouter(prefix="/api/threads", tags=["Threads"])
TEXT_ATTACHMENT_ID_PATTERN = re.compile(
    r"^pasted_[0-9a-f]{32}_[1-4]\.txt$", re.IGNORECASE
)


@router.post(
    "/project/{project_id}/sessions/doctor", summary="Inspect Project Sessions"
)
async def inspect_project_session_logs(project_id: str) -> dict[str, Any]:
    """Inspect the registered Project's Session logs without attaching a Session."""
    try:
        return await asyncio.to_thread(inspect_project_sessions, project_id)
    except SessionDoctorError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=error.public_message,
        ) from error


@router.post(
    "/project/{project_id}/sessions/{session_id}/doctor/repair",
    summary="Back Up and Repair a Session Tail",
)
async def repair_project_session_log(
    project_id: str, session_id: str
) -> dict[str, Any]:
    """Revalidate, back up, and truncate one incomplete Session log tail."""
    try:
        return await asyncio.to_thread(
            repair_project_session,
            project_id,
            session_id,
        )
    except SessionDoctorError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=error.public_message,
        ) from error


def _background_task_json(value: Any) -> dict[str, Any]:
    payload = to_json_serializable(value)
    if isinstance(payload, dict):
        payload.pop("raw", None)
    return payload


def _scheduled_task_json(value: Any) -> dict[str, Any]:
    payload = to_json_serializable(value)
    if isinstance(payload, dict):
        payload.pop("raw", None)
    return payload


def _thread_activity_sort_key(thread: dict[str, Any]) -> tuple[bool, float, str, str]:
    updated_at = thread.get("updated_at")
    timestamp = 0.0
    has_timestamp = isinstance(updated_at, str) and bool(updated_at)
    if has_timestamp:
        try:
            parsed = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            timestamp = parsed.timestamp()
        except (OSError, OverflowError, ValueError):
            has_timestamp = False

    return (
        has_timestamp,
        timestamp,
        str(thread.get("project") or ""),
        str(thread.get("thread_id") or ""),
    )


@router.get("/project/{project_id}/sessions", summary="List Project Sessions")
async def list_project_sessions(
    project_id: str, cursor: str | None = None, limit: int = Query(64, ge=1, le=128)
) -> dict[str, Any]:
    """List bounded historical and locked SessionStore records for a Project."""
    try:
        return session_manager.list_project_sessions(project_id, limit, cursor)
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err


class StartThreadRequest(BaseModel):
    thread_id: str = Field(
        default="default", description="Identifier of the thread to create or attach"
    )
    title: str | None = Field(default=None, description="Optional custom display title")
    project: str | None = Field(
        default=None, description="Optional project ID or name to bind this thread to"
    )
    project_id: str | None = Field(
        default=None, description="Canonical project routing context"
    )


class AttachThreadRequest(BaseModel):
    project: str | None = Field(
        default=None, description="Optional project ID or name for a resumable Session"
    )
    project_id: str | None = Field(
        default=None, description="Canonical project routing context"
    )


class ForkThreadRequest(BaseModel):
    source_thread_id: str = Field(..., description="Existing thread ID to fork from")
    new_thread_id: str = Field(
        ..., description="New thread ID for the branched session"
    )
    title: str | None = Field(
        default=None, description="Optional title for forked branch"
    )
    project: str | None = Field(
        default=None, description="Optional Project ID or name for the source Thread"
    )
    project_id: str | None = Field(
        default=None, description="Canonical project routing context"
    )
    context_policy: Literal["exact", "compact"] = Field(
        default="exact",
        description="Fork the latest checkpoint exactly, or explicitly compact it",
    )


class ChildTaskRequest(BaseModel):
    """Bounded prompt for one independent child Session/runtime."""

    new_thread_id: str = Field(
        ...,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9_-]+$",
        description="New child Thread identity",
    )
    prompt: str = Field(
        ...,
        min_length=1,
        max_length=MAX_CHILD_TASK_PROMPT_BYTES,
        description="Bounded child task prompt",
    )
    title: str | None = Field(default=None, max_length=160)
    project: str | None = Field(default=None, description="Optional source Project")
    project_id: str | None = Field(
        default=None, description="Canonical project routing context"
    )
    group_id: str | None = Field(default=None, max_length=128)
    execution_mode: Literal["parallel", "sequential"] = Field(...)
    sequence: int | None = Field(default=None, ge=0)


class SessionControlRequest(BaseModel):
    action: Literal["freeze", "continue"]
    request_id: str | None = Field(default=None, min_length=1, max_length=192)


class ResumeTurnRequest(BaseModel):
    checkpoint_seq: int = Field(..., ge=1)
    request_id: str = Field(..., min_length=1, max_length=128)


class ReconciledToolResultBody(BaseModel):
    status: Literal["completed", "failed"]
    content: str = Field(..., max_length=65536)


class ReconcileTurnRequest(BaseModel):
    checkpoint_seq: int = Field(..., ge=1)
    tool_call_id: str = Field(..., min_length=1, max_length=128)
    request_id: str = Field(..., min_length=1, max_length=128)
    disposition: Literal["completed", "not_executed"]
    result: ReconciledToolResultBody | None = None
    evidence_summary: str = Field(..., min_length=1, max_length=1024)


class ChildTaskControlRequest(BaseModel):
    action: Literal[
        "update_queued",
        "steer",
        "queue_follow_up",
        "pause",
        "resume",
        "cancel",
        "retry",
    ]
    operation_id: str = Field(..., min_length=1, max_length=128)
    attempt: int = Field(..., ge=1)
    request_id: str = Field(..., min_length=1, max_length=192)
    prompt: str | None = Field(default=None, max_length=MAX_CHILD_TASK_PROMPT_BYTES)
    text: str | None = Field(default=None, max_length=4096)


class NotebookWriteRequest(BaseModel):
    key: str = Field(..., min_length=1, max_length=128)
    content: str = Field(..., max_length=4096)
    append: bool = False
    importance: Literal["critical", "high", "normal", "temporary"] = "normal"
    keywords: list[str] | None = Field(default=None, max_length=12)
    evidence: list[dict[str, Any]] | None = Field(default=None, max_length=8)


class NotebookForgetRequest(BaseModel):
    key: str = Field(..., min_length=1, max_length=128)


class UpdateThreadSummaryRequest(BaseModel):
    summary: str = Field(..., description="Summary content for the thread")


class RenameThreadRequest(BaseModel):
    title: str = Field(..., description="New title for the thread")


@router.get("", summary="List all threads with enriched metadata")
async def list_threads(
    cursor: str | None = None,
    limit: int | None = None,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """List active and historical conversation threads with titles and summaries."""
    try:
        # A Gateway may intentionally start read-only when another process owns
        # the canonical default Session. The SessionStore catalog is still
        # sufficient for the sidebar and must remain available in that mode.
        requested_project = project_id or session_manager._current_project_id
        client = session_manager._project_clients.get((requested_project, "default"))
        if client is None and requested_project == session_manager._current_project_id:
            client = session_manager._client
        res = (
            await client.list_threads(cursor=cursor, limit=limit)
            if client is not None
            else None
        )
        # Thread IDs are scoped by Project. Keep the project in the catalog key
        # so ``pi/default`` and ``mini-agent-web/default`` remain selectable.
        live_bindings = set(session_manager.live_thread_bindings())
        if res is not None and isinstance(res.data, list):
            active_project = requested_project
            for raw_thread in res.data:
                if isinstance(raw_thread, str):
                    tid = raw_thread
                elif isinstance(raw_thread, dict):
                    tid = raw_thread.get("thread_id")
                else:
                    tid = getattr(raw_thread, "thread_id", None)
                if tid:
                    live_bindings.add(
                        (
                            active_project,
                            str(tid),
                        )
                    )

        # The Web gateway's thread metadata is UI metadata only. Add canonical
        # SessionStore sessions so historical, running, and paused sessions are
        # visible even when the current App Server process did not create them.
        catalog_entries = {
            (str(session["project_id"]), str(session["thread_id"])): session
            for session in session_manager.list_all_project_sessions()
        }
        child_sessions = session_manager.list_all_project_child_sessions()
        for session in child_sessions:
            catalog_entries[(str(session["project_id"]), str(session["thread_id"]))] = (
                session
            )
        all_bindings = set(live_bindings) | set(catalog_entries)
        for meta_project, tid in session_manager._thread_metadata_by_project:
            all_bindings.add((str(meta_project), str(tid)))
        for tid, meta in session_manager._thread_metadata.items():
            project_id = str(
                meta.get("project")
                or session_manager._client_projects.get(tid)
                or session_manager._current_project_id
            )
            if not any(existing_tid == tid for _, existing_tid in all_bindings):
                all_bindings.add((project_id, tid))

        parent_by_session = {
            (project, str(session.get("session_id"))): (project, thread_id)
            for (project, thread_id), session in catalog_entries.items()
            if not session.get("is_child_task") and session.get("session_id")
        }
        child_attention_by_parent: dict[tuple[str, str], set[str]] = {}
        child_report_parents: dict[
            tuple[str, str], list[tuple[dict[str, Any], dict[str, Any]]]
        ] = {}
        pending_approval_keys: set[tuple[str, str]] = set()
        for approval in session_manager.approval_snapshot().get("pending_requests", []):
            approval_thread_id = approval.get("thread_id")
            if not approval_thread_id:
                continue
            approval_project_id = str(
                approval.get("project_id") or session_manager._current_project_id
            )
            pending_key = (approval_project_id, str(approval_thread_id))
            pending_approval_keys.add(pending_key)

        for child in child_sessions:
            project = str(child.get("project_id") or "")
            child_state = child.get("child_task_state") or {}
            child_thread_id = str(child.get("thread_id") or "")
            parent_session_id = str(child.get("parent_session_id") or "")
            parent_key = parent_by_session.get((project, parent_session_id))
            if not parent_key:
                parent_thread_id = child_state.get("parent_thread_id")
                candidate = (project, str(parent_thread_id or ""))
                parent_key = candidate if candidate in all_bindings else None
            if not parent_key:
                continue

            reasons = child_attention_by_parent.setdefault(parent_key, set())
            child_status = str(
                child_state.get("status") or child.get("last_turn_status") or ""
            )
            if child_status in {"failed", "step_limit"}:
                reasons.add("child_task_failed")
            if child_status in {
                "running",
                "awaiting_approval",
                "awaiting_user_input",
                "in_progress",
                "pausing",
                "cancelling",
            } and not child.get("process_online"):
                reasons.add("child_recovery")
            if child.get("awaiting_user_input"):
                reasons.add("child_user_input")
            if (project, child_thread_id) in pending_approval_keys:
                reasons.add("child_pending_approval")
            if child_state.get("reports"):
                child_report_parents.setdefault(parent_key, []).append(
                    (child, child_state)
                )

        # Child report delivery is already tracked by App Server receipts.
        # Read those bounded receipts once per parent to avoid adding another
        # persisted notification/read state in the Gateway.
        for parent_key, reports in child_report_parents.items():
            parent_project, parent_thread_id = parent_key
            parent = catalog_entries.get(parent_key)
            parent_session_path = session_manager.session_path_for_thread(
                parent_thread_id, parent_project
            )
            parent_session_id = str(
                (parent or {}).get("session_id")
                or (parent_session_path.name if parent_session_path else "")
            )
            if parent_session_path is None or not parent_session_id:
                continue
            receipt_cursors = session_catalog.child_report_receipt_cursors(
                parent_session_path, parent_session_id
            )
            for child, child_state in reports:
                child_thread_id = str(child.get("thread_id") or "")
                operation_id = str(child_state.get("operation_id") or "")
                attempt = child_state.get("attempt") or 1
                delivered_cursor = receipt_cursors.get(
                    (child_thread_id, operation_id, attempt), 0
                )
                if any(
                    isinstance(report.get("cursor"), int)
                    and not isinstance(report.get("cursor"), bool)
                    and report["cursor"] > delivered_cursor
                    for report in child_state.get("reports", [])
                    if isinstance(report, dict)
                ):
                    child_attention_by_parent.setdefault(parent_key, set()).add(
                        "child_report"
                    )

        enriched_threads: list[dict[str, Any]] = []
        for project_id, tid in sorted(all_bindings):
            meta = session_manager.get_thread_meta(tid, project_id)
            item = {
                "thread_id": tid,
                "title": meta.get("title") or f"会话 {tid}",
                "project": project_id,
                "summary": meta.get("summary", ""),
                "created_at": meta.get("created_at"),
                "updated_at": meta.get("updated_at"),
                "pinned": meta.get("pinned", False),
                "is_child_task": False,
            }
            catalog_entry = catalog_entries.get((project_id, tid))
            if catalog_entry:
                item["is_child_task"] = bool(catalog_entry.get("is_child_task"))
                item["updated_at"] = (
                    catalog_entry.get("updated_at") or item["updated_at"]
                )
                if is_default_thread_title(item["title"], tid) and catalog_entry.get(
                    "title"
                ):
                    item["title"] = catalog_entry["title"]
                item.update(
                    {
                        "project": project_id,
                        "session_id": catalog_entry["session_id"],
                        "session_status": catalog_entry["session_status"],
                        "runtime_status": catalog_entry["runtime_status"],
                        "turn_active": catalog_entry.get("turn_active", False),
                        "process_online": catalog_entry.get("process_online", False),
                        "goal_status": catalog_entry["goal_status"],
                        "cleanup_pending": catalog_entry["cleanup_pending"],
                        "resumable": catalog_entry["resumable"],
                        "plan_review_pending": catalog_entry.get(
                            "plan_review_pending", False
                        ),
                        "last_turn_status": catalog_entry.get("last_turn_status"),
                        "last_stop_reason": catalog_entry.get("last_stop_reason"),
                        "last_turn_error": catalog_entry.get("last_turn_error"),
                        "last_turn_id": catalog_entry.get("last_turn_id"),
                        "last_turn_steps": catalog_entry.get("last_turn_steps", 0),
                        "last_turn_complete": catalog_entry.get(
                            "last_turn_complete", False
                        ),
                    }
                )
            for field in (
                "parent_session_id",
                "parent_checkpoint_seq",
                "session_bytes",
                "context_before_bytes",
                "context_after_bytes",
                "compacted",
                "compaction_method",
            ):
                if field in meta:
                    item[field] = meta[field]
            item["attention_reasons"] = thread_attention_reasons(
                item,
                pending_approval=(project_id, tid) in pending_approval_keys,
                child_reasons=sorted(
                    child_attention_by_parent.get((project_id, tid), set())
                ),
            )
            enriched_threads.append(item)

        enriched_threads.sort(key=_thread_activity_sort_key, reverse=True)

        return {
            "threads": enriched_threads,
            "raw_thread_ids": [tid for _project_id, tid in sorted(all_bindings)],
            "raw_thread_bindings": [
                {"project": project_id, "thread_id": tid}
                for project_id, tid in sorted(all_bindings)
            ],
            "current_project": session_manager._current_project_id,
            "next_cursor": res.next_cursor if res is not None else None,
        }
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/{thread_id}/attach", summary="Attach to a resumable Session")
async def attach_thread(
    thread_id: str,
    req: AttachThreadRequest | None = None,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Attach to a historical/paused Session, or report a live external lock."""
    try:
        requested_project = (
            project_id
            or (req.project_id if req else None)
            or (req.project if req else None)
        )
        return await session_manager.attach_thread(thread_id, requested_project)
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err


@router.post("", summary="Start or attach to a thread")
async def start_thread(req: StartThreadRequest) -> dict[str, Any]:
    """Start or attach to a conversation thread."""
    try:
        requested_project = req.project_id or req.project
        active_id = await session_manager.start_thread(req.thread_id, requested_project)
        updates: dict[str, Any] = {}
        if req.title:
            updates["title"] = req.title
        if requested_project:
            updates["project"] = requested_project
        if updates:
            session_manager.set_thread_meta(active_id, updates, requested_project)
        meta = session_manager.get_thread_meta(active_id, requested_project)
        return {
            "thread_id": active_id,
            "status": "active",
            "title": meta.get("title"),
            "project": meta.get("project"),
            "summary": meta.get("summary"),
        }
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/{thread_id}/events", summary="Replay Thread events")
async def replay_thread_events(
    thread_id: str,
    after_sequence: int | None = Query(default=None, ge=0),
    limit: int = Query(default=128, ge=1, le=128),
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Replay a bounded App Server event page after a sequence cursor."""
    try:
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        result = await client.replay_events(
            thread_id=thread_id,
            after_sequence=after_sequence,
            limit=limit,
        )
        return {
            "thread_id": thread_id,
            "data": result.data,
            "next_cursor": result.next_cursor,
            "oldest_sequence": result.oldest_sequence,
            "has_gap": result.has_gap,
        }
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/{thread_id}/context-manifest", summary="Read Session Context Manifest")
async def read_context_manifest(
    thread_id: str,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Read bounded source provenance from the canonical App Server Session."""
    try:
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        manifest = await client.read_context_manifest(thread_id)
        return {"thread_id": thread_id, **manifest.to_dict()}
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.get("/{thread_id}/runtime/status", summary="Read runtime status")
async def get_runtime_status(
    thread_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    """Read the non-blocking live App Server runtime snapshot."""
    try:
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        status = await client.get_runtime_status(thread_id)
        return {
            "phase": status.phase,
            "thread_id": status.thread_id,
            "turn_id": status.turn_id,
            "operation_id": status.operation_id,
            "checkpoint_seq": status.checkpoint_seq,
            "state_revision": status.state_revision,
            "timestamp_ms": status.timestamp_ms,
            "error": status.error,
        }
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/{thread_id}/background-tasks", summary="List background Shell tasks")
async def list_background_tasks(
    thread_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    """Read the authoritative local background Shell task list."""
    try:
        client, owner_thread_id, _ = await session_manager.get_background_task_target(
            thread_id, project_id
        )
        tasks = await client.list_background_tasks(owner_thread_id)
        return {
            "thread_id": thread_id,
            "owner_thread_id": owner_thread_id,
            "data": [_background_task_json(task) for task in tasks],
        }
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


async def _background_task_action(
    thread_id: str,
    task_id: str,
    project_id: str | None,
    action: str,
) -> dict[str, Any]:
    (
        client,
        owner_thread_id,
        is_child,
    ) = await session_manager.get_background_task_target(thread_id, project_id)
    if is_child and action in {"stop", "restart"}:
        raise HTTPException(
            status_code=403,
            detail="Child Sessions can read background Shell tasks but cannot control them",
        )
    if action == "read":
        value = await client.read_background_task(task_id, owner_thread_id)
    elif action == "logs":
        value = await client.read_background_task_logs(task_id, owner_thread_id)
    elif action == "stop":
        value = await client.stop_background_task(task_id, owner_thread_id)
    else:
        value = await client.restart_background_task(task_id, owner_thread_id)
    return {
        "thread_id": thread_id,
        "owner_thread_id": owner_thread_id,
        **_background_task_json(value),
    }


@router.get(
    "/{thread_id}/background-tasks/{task_id}", summary="Read a background Shell task"
)
async def read_background_task(
    thread_id: str, task_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    try:
        return await _background_task_action(thread_id, task_id, project_id, "read")
    except HTTPException:
        raise
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get(
    "/{thread_id}/background-tasks/{task_id}/logs", summary="Read background Shell logs"
)
async def read_background_task_logs(
    thread_id: str, task_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    try:
        return await _background_task_action(thread_id, task_id, project_id, "logs")
    except HTTPException:
        raise
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post(
    "/{thread_id}/background-tasks/{task_id}/stop",
    summary="Stop a background Shell task",
)
async def stop_background_task(
    thread_id: str, task_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    try:
        return await _background_task_action(thread_id, task_id, project_id, "stop")
    except HTTPException:
        raise
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post(
    "/{thread_id}/background-tasks/{task_id}/restart",
    summary="Restart a background Shell task",
)
async def restart_background_task(
    thread_id: str, task_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    try:
        return await _background_task_action(thread_id, task_id, project_id, "restart")
    except HTTPException:
        raise
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/{thread_id}/scheduled-tasks", summary="List scheduled delay markers")
async def list_scheduled_tasks(
    thread_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    """Read bounded delay markers owned by the Thread runtime."""
    try:
        client, owner_thread_id, _ = await session_manager.get_scheduled_task_target(
            thread_id, project_id
        )
        tasks = await client.list_scheduled_tasks(owner_thread_id)
        return {
            "thread_id": thread_id,
            "owner_thread_id": owner_thread_id,
            "data": [_scheduled_task_json(task) for task in tasks],
        }
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


async def _scheduled_task_action(
    thread_id: str,
    task_id: str,
    project_id: str | None,
    action: str,
) -> dict[str, Any]:
    client, owner_thread_id, is_child = await session_manager.get_scheduled_task_target(
        thread_id, project_id
    )
    if is_child and action == "cancel":
        raise HTTPException(
            status_code=403,
            detail="Child Sessions can read scheduled tasks but cannot cancel them",
        )
    if action == "read":
        value = await client.read_scheduled_task(task_id, owner_thread_id)
    else:
        value = await client.cancel_scheduled_task(task_id, owner_thread_id)
    return {
        "thread_id": thread_id,
        "owner_thread_id": owner_thread_id,
        **_scheduled_task_json(value),
    }


@router.get(
    "/{thread_id}/scheduled-tasks/{task_id}", summary="Read a scheduled delay marker"
)
async def read_scheduled_task(
    thread_id: str, task_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    try:
        return await _scheduled_task_action(thread_id, task_id, project_id, "read")
    except HTTPException:
        raise
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post(
    "/{thread_id}/scheduled-tasks/{task_id}/cancel",
    summary="Cancel a scheduled delay marker",
)
async def cancel_scheduled_task(
    thread_id: str, task_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    try:
        return await _scheduled_task_action(thread_id, task_id, project_id, "cancel")
    except HTTPException:
        raise
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/fork", summary="Fork a thread")
async def fork_thread(req: ForkThreadRequest) -> dict[str, Any]:
    """Fork an existing thread history into a new branched thread."""
    try:
        return await session_manager.fork_thread(
            req.source_thread_id,
            req.new_thread_id,
            req.title,
            req.project_id or req.project,
            req.context_policy,
        )
    except SessionForkConflictError as err:
        raise HTTPException(
            status_code=409,
            detail={"code": err.code, "message": err.message, "data": err.data},
        ) from err
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except AppServerError as err:
        if err.code == SESSION_FORK_CONFLICT_CODE:
            raise HTTPException(
                status_code=409,
                detail={"code": err.code, "message": err.message, "data": err.data},
            ) from err
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/{thread_id}/children", summary="List child task Sessions")
async def list_child_tasks(
    thread_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    """List child Sessions derived from a parent Thread."""
    try:
        children = await session_manager.list_child_tasks(thread_id, project_id)
        session_control = await session_manager.session_control_state(
            thread_id, project_id
        )
        await session_manager.recover_pending_session_resume(
            thread_id, project_id, state=session_control
        )
        return {
            "parent_thread_id": thread_id,
            "project": session_manager.resolve_thread_project(thread_id, project_id),
            "session_control": session_control,
            "children": children,
        }
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except (ServerProcessError, AppServerError) as err:
        raise HTTPException(status_code=503, detail=str(err)) from err


@router.post("/{thread_id}/session-control", summary="Freeze or continue a Session")
async def control_session(
    thread_id: str,
    req: SessionControlRequest,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Freeze the parent and children, or explicitly resume the Session."""
    try:
        if req.action == "freeze":
            return await session_manager.freeze_session(
                thread_id, project_id, request_id=req.request_id
            )
        return await session_manager.continue_session(
            thread_id, project_id, request_id=req.request_id
        )
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.post("/{thread_id}/children", summary="Start a child task")
async def start_child_task(thread_id: str, req: ChildTaskRequest) -> dict[str, Any]:
    """Create an exact child Session and start one independent child Turn."""
    try:
        return await session_manager.start_child_task(
            source_thread_id=thread_id,
            new_thread_id=req.new_thread_id,
            prompt=req.prompt,
            title=req.title,
            project_id=req.project_id or req.project,
            group_id=req.group_id,
            execution_mode=req.execution_mode,
            sequence=req.sequence,
        )
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except (RuntimeError, ValueError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except SessionForkConflictError as err:
        raise HTTPException(
            status_code=409,
            detail={"code": err.code, "message": err.message, "data": err.data},
        ) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post(
    "/{thread_id}/children/{child_thread_id}/cancel", summary="Cancel a child task"
)
async def cancel_child_task(
    thread_id: str,
    child_thread_id: str,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    try:
        return await session_manager.cancel_child_task(
            thread_id, child_thread_id, project_id
        )
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.post(
    "/{thread_id}/children/{child_thread_id}/control",
    summary="Control a child task",
)
async def control_child_task(
    thread_id: str,
    child_thread_id: str,
    req: ChildTaskControlRequest,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Apply one operation-bound, idempotent runtime-panel action."""
    try:
        return await session_manager.control_child_task(
            thread_id,
            child_thread_id,
            req.action,
            req.operation_id,
            req.attempt,
            req.request_id,
            project_id,
            prompt=req.prompt,
            text=req.text,
        )
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except (ServerProcessError, AppServerError) as err:
        raise HTTPException(status_code=503, detail=str(err)) from err


@router.post(
    "/{thread_id}/children/{child_thread_id}/retry", summary="Retry a child task"
)
async def retry_child_task(
    thread_id: str,
    child_thread_id: str,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    try:
        return await session_manager.retry_child_task(
            thread_id, child_thread_id, project_id
        )
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except (ServerProcessError, AppServerError) as err:
        raise HTTPException(status_code=503, detail=str(err)) from err


@router.get("/{thread_id}/notebook", summary="Read the Session notebook")
async def read_thread_notebook(
    thread_id: str,
    scope: Literal["self", "parent"] = Query(default="self"),
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    try:
        notebook = session_manager.read_thread_notebook(thread_id, project_id, scope)
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    if notebook is None:
        raise HTTPException(status_code=404, detail=f"Thread '{thread_id}' not found")
    return notebook


@router.get("/{thread_id}/notebook/search", summary="Search Session notebook")
async def search_thread_notebook(
    thread_id: str,
    q: str = Query(..., min_length=1, max_length=128),
    scope: Literal["self", "parent"] = Query(default="self"),
    limit: int = Query(default=8, ge=1, le=8),
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    try:
        notebook = session_manager.search_thread_notebook(
            thread_id, q, project_id, scope, limit
        )
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    if notebook is None:
        raise HTTPException(status_code=404, detail=f"Thread '{thread_id}' not found")
    return notebook


@router.post("/{thread_id}/notebook", summary="Write the Session notebook")
async def write_thread_notebook(
    thread_id: str,
    req: NotebookWriteRequest,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Write the current Thread notebook; parent snapshots are read-only."""
    try:
        return await session_manager.write_thread_notebook(
            thread_id,
            req.key,
            req.content,
            req.append,
            req.importance,
            req.keywords,
            req.evidence,
            project_id,
        )
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except (RuntimeError, ValueError, AppServerError, ServerProcessError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.delete("/{thread_id}/notebook", summary="Forget a Session notebook entry")
async def forget_thread_notebook(
    thread_id: str,
    req: NotebookForgetRequest,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Forget one entry from the current Thread notebook."""
    try:
        return await session_manager.forget_thread_notebook(
            thread_id, req.key, project_id
        )
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except (RuntimeError, ValueError, AppServerError, ServerProcessError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.get("/{thread_id}", summary="Read canonical thread history")
async def read_thread(
    thread_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    """Read canonical App Server Session history for a specific thread."""
    try:
        canonical = session_manager.read_any_project_thread(thread_id, project_id)
        if canonical:
            try:
                runtime_client = await session_manager.get_client_for_thread(
                    thread_id, project_id
                )
                runtime_checkpoint = await runtime_client.read_thread(thread_id)
                recovery = runtime_checkpoint.execution_recovery
                canonical["pending_user_question"] = (
                    runtime_checkpoint.pending_user_question
                )
                canonical["execution_recovery"] = (
                    recovery.to_dict() if recovery is not None else None
                )
            except (RuntimeError, ServerProcessError, AppServerError):
                # The catalog remains a valid historical projection when the
                # owning runtime is unavailable. It cannot expose a live
                # execution checkpoint until the App Server can be read.
                canonical["execution_recovery"] = None
            meta = session_manager.get_thread_meta(thread_id, project_id)
            catalog_title = canonical.get("session", {}).get("title")
            if is_default_thread_title(meta.get("title"), thread_id) and catalog_title:
                meta = {**meta, "title": catalog_title}
            return {
                **canonical,
                "metadata": meta,
                "raw": {"session": canonical["session"]},
            }
        try:
            client = await session_manager.get_client_for_thread(thread_id, project_id)
            cp = await client.read_thread(thread_id)
        except AppServerError:
            client = await session_manager.get_client_for_thread(thread_id, project_id)
            await client.start_thread(thread_id)
            cp = await client.read_thread(thread_id)

        meta = session_manager.get_thread_meta(thread_id, project_id)
        return {
            "thread_id": cp.thread_id if cp else thread_id,
            "status": cp.status if cp else "active",
            "next_turn_number": cp.next_turn_number if cp else 1,
            "messages": cp.messages if cp else [],
            "execution_recovery": (
                cp.execution_recovery.to_dict()
                if cp and cp.execution_recovery
                else None
            ),
            "pending_user_question": cp.pending_user_question if cp else None,
            "metadata": meta,
            "raw": cp.raw if cp else {},
        }
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get(
    "/{thread_id}/text-attachments/{attachment_id}",
    summary="Read a bounded pasted text attachment",
)
async def read_text_attachment(
    thread_id: str,
    attachment_id: str,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Read only Gateway-created pasted text files for this Project/Thread."""
    if not TEXT_ATTACHMENT_ID_PATTERN.fullmatch(attachment_id):
        raise HTTPException(status_code=404, detail="文本附件不存在")

    try:
        root = session_manager.attachments_path_for_thread(
            thread_id, project_id
        ).resolve()
        target = (root / attachment_id).resolve(strict=True)
    except (FileNotFoundError, OSError) as err:
        raise HTTPException(status_code=404, detail="文本附件不存在") from err
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err

    if not target.is_relative_to(root):
        raise HTTPException(status_code=403, detail="文本附件路径无效")

    try:
        with target.open("rb") as attachment_file:
            content = attachment_file.read(MAX_TEXT_ATTACHMENT_BYTES + 1)
    except OSError as err:
        raise HTTPException(status_code=404, detail="文本附件不存在") from err
    if len(content) > MAX_TEXT_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="文本附件超过 128 KiB 限制")
    return {
        "attachment_id": attachment_id,
        "content": content.decode("utf-8", errors="replace"),
        "size_bytes": len(content),
    }


@router.get("/{thread_id}/turns/{turn_id}", summary="Read Turn recovery status")
async def read_turn_recovery(
    thread_id: str,
    turn_id: str,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Read bounded Turn status and execution-recovery metadata."""
    try:
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        turn = await client.read_turn(turn_id)
        return {
            "thread_id": thread_id,
            "turn_id": turn.turn_id,
            "status": turn.status,
            "error": turn.error,
            "recovery": turn.recovery.to_dict() if turn.recovery else None,
        }
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post(
    "/{thread_id}/turns/{turn_id}/resume",
    summary="Continue a Turn from its execution checkpoint",
)
async def resume_turn(
    thread_id: str,
    turn_id: str,
    req: ResumeTurnRequest,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Explicitly resume one durable execution checkpoint."""
    try:
        return await session_manager.resume_execution_turn(
            thread_id,
            turn_id,
            req.checkpoint_seq,
            req.request_id,
            project_id,
        )
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.post(
    "/{thread_id}/turns/{turn_id}/reconcile",
    summary="Reconcile one uncertain tool invocation",
)
async def reconcile_turn(
    thread_id: str,
    turn_id: str,
    req: ReconcileTurnRequest,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Record a bounded operator decision before the interrupted Turn resumes."""
    try:
        return await session_manager.reconcile_execution_turn(
            thread_id,
            turn_id,
            req.checkpoint_seq,
            req.tool_call_id,
            req.request_id,
            req.disposition,
            req.evidence_summary,
            req.result.status if req.result else None,
            req.result.content if req.result else None,
            project_id,
        )
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.get("/{thread_id}/items", summary="List ThreadItem projections")
async def list_thread_items(
    thread_id: str,
    turn_id: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=128),
    sort_direction: Literal["asc", "desc"] | None = Query(default=None),
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Expose the App Server's bounded Session-backed item projection."""
    try:
        canonical = session_manager.read_any_project_thread(thread_id, project_id)
        if canonical:
            result = session_manager.list_any_project_thread_items(
                thread_id=thread_id,
                project_id=project_id,
                turn_id=turn_id,
                cursor=cursor,
                limit=limit,
                sort_direction=sort_direction,
            )
            if result is not None:
                return result
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        result = await client.list_thread_items(
            thread_id=thread_id,
            turn_id=turn_id,
            cursor=cursor,
            limit=limit,
            sort_direction=sort_direction,
        )
        return {
            "thread_id": thread_id,
            "data": to_json_serializable(result.data),
            "next_cursor": result.next_cursor,
            "backwards_cursor": result.backwards_cursor,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.patch("/{thread_id}/summary", summary="Update thread summary")
async def update_thread_summary(
    thread_id: str,
    req: UpdateThreadSummaryRequest,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Set or update custom summary for a thread."""
    meta = session_manager.set_thread_meta(
        thread_id, {"summary": req.summary}, project_id
    )
    return {"thread_id": thread_id, "metadata": meta}


@router.patch("/{thread_id}/rename", summary="Rename thread title")
async def rename_thread(
    thread_id: str,
    req: RenameThreadRequest,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Rename thread display title."""
    meta = session_manager.set_thread_meta(thread_id, {"title": req.title}, project_id)
    return {"thread_id": thread_id, "metadata": meta}


@router.post("/{thread_id}/close", summary="Close thread")
async def close_thread(
    thread_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    """Close an active thread and release server resources."""
    try:
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        closed = await client.close_thread(thread_id)
        return {"thread_id": thread_id, "closed": closed}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
