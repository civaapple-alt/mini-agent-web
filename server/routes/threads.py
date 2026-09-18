"""
Thread management endpoints with metadata enrichment (title, summary, date grouping).
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from mini_agent.errors import (
    SESSION_FORK_CONFLICT_CODE,
    AppServerError,
    ServerProcessError,
)
from pydantic import BaseModel, Field

from server.control.fork_errors import SessionForkConflictError
from server.session_manager import (
    MAX_CHILD_TASK_PROMPT_BYTES,
    session_manager,
    to_json_serializable,
)

router = APIRouter(prefix="/api/threads", tags=["Threads"])


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
            }
            catalog_entry = catalog_entries.get((project_id, tid))
            if catalog_entry:
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
            enriched_threads.append(item)

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
    client, owner_thread_id, is_child = await session_manager.get_background_task_target(
        thread_id, project_id
    )
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


@router.get("/{thread_id}/background-tasks/{task_id}", summary="Read a background Shell task")
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


@router.get("/{thread_id}/background-tasks/{task_id}/logs", summary="Read background Shell logs")
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


@router.post("/{thread_id}/background-tasks/{task_id}/stop", summary="Stop a background Shell task")
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


@router.post("/{thread_id}/background-tasks/{task_id}/restart", summary="Restart a background Shell task")
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


@router.get("/{thread_id}/scheduled-tasks", summary="List scheduled wake-up tasks")
async def list_scheduled_tasks(
    thread_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    """Read bounded wake-up markers owned by the Thread runtime."""
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


@router.get("/{thread_id}/scheduled-tasks/{task_id}", summary="Read a scheduled wake-up task")
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


@router.post("/{thread_id}/scheduled-tasks/{task_id}/cancel", summary="Cancel a scheduled wake-up task")
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
        return {
            "parent_thread_id": thread_id,
            "project": session_manager.resolve_thread_project(thread_id, project_id),
            "children": children,
        }
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.post("/{thread_id}/children", summary="Start a child task")
async def start_child_task(
    thread_id: str, req: ChildTaskRequest
) -> dict[str, Any]:
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


@router.post("/{thread_id}/children/{child_thread_id}/cancel", summary="Cancel a child task")
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
    except (ServerProcessError, AppServerError) as err:
        raise HTTPException(status_code=503, detail=str(err)) from err


@router.post("/{thread_id}/children/{child_thread_id}/retry", summary="Retry a child task")
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
            meta = session_manager.get_thread_meta(thread_id, project_id)
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
            "metadata": meta,
            "raw": cp.raw if cp else {},
        }
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


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
