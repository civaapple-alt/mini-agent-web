"""
Thread management endpoints with metadata enrichment (title, summary, date grouping).
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from mini_agent.errors import AppServerError
from pydantic import BaseModel, Field

from server.session_manager import session_manager, to_json_serializable

router = APIRouter(prefix="/api/threads", tags=["Threads"])


class StartThreadRequest(BaseModel):
    thread_id: str = Field(
        default="default", description="Identifier of the thread to create or attach"
    )
    title: str | None = Field(default=None, description="Optional custom display title")
    project: str | None = Field(
        default=None, description="Optional project ID or name to bind this thread to"
    )


class ForkThreadRequest(BaseModel):
    source_thread_id: str = Field(..., description="Existing thread ID to fork from")
    new_thread_id: str = Field(
        ..., description="New thread ID for the branched session"
    )
    title: str | None = Field(
        default=None, description="Optional title for forked branch"
    )


class UpdateThreadSummaryRequest(BaseModel):
    summary: str = Field(..., description="Summary content for the thread")


class RenameThreadRequest(BaseModel):
    title: str = Field(..., description="New title for the thread")


@router.get("", summary="List all threads with enriched metadata")
async def list_threads(
    cursor: str | None = None, limit: int | None = None
) -> dict[str, Any]:
    """List active and historical conversation threads with titles and summaries."""
    try:
        res = await session_manager.client.list_threads(cursor=cursor, limit=limit)
        live_thread_ids = list(res.data) if isinstance(res.data, list) else []

        # Combine active App Server threads and historical metadata threads
        seen = set(live_thread_ids)
        all_thread_ids = list(live_thread_ids)
        for tid in session_manager._thread_metadata:
            if tid not in seen:
                all_thread_ids.append(tid)
                seen.add(tid)

        enriched_threads: list[dict[str, Any]] = []
        cur_project_name = session_manager._current_project_path.name
        for tid in all_thread_ids:
            meta = session_manager.get_thread_meta(tid)
            enriched_threads.append(
                {
                    "thread_id": tid,
                    "title": meta.get("title") or f"会话 {tid}",
                    "project": meta.get("project") or cur_project_name,
                    "summary": meta.get("summary", ""),
                    "created_at": meta.get("created_at"),
                    "updated_at": meta.get("updated_at"),
                    "pinned": meta.get("pinned", False),
                }
            )

        return {
            "threads": enriched_threads,
            "raw_thread_ids": all_thread_ids,
            "next_cursor": res.next_cursor,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("", summary="Start or attach to a thread")
async def start_thread(req: StartThreadRequest) -> dict[str, Any]:
    """Start or attach to a conversation thread."""
    try:
        active_id = await session_manager.client.start_thread(req.thread_id)
        updates: dict[str, Any] = {}
        if req.title:
            updates["title"] = req.title
        if req.project:
            updates["project"] = req.project
        if updates:
            session_manager.set_thread_meta(active_id, updates)
        meta = session_manager.get_thread_meta(active_id)
        return {
            "thread_id": active_id,
            "status": "active",
            "title": meta.get("title"),
            "project": meta.get("project"),
            "summary": meta.get("summary"),
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/fork", summary="Fork a thread")
async def fork_thread(req: ForkThreadRequest) -> dict[str, Any]:
    """Fork an existing thread history into a new branched thread."""
    try:
        res = await session_manager.client.fork_thread(
            source_thread_id=req.source_thread_id,
            new_thread_id=req.new_thread_id,
        )
        src_meta = session_manager.get_thread_meta(req.source_thread_id)
        fork_title = (
            req.title or f"{src_meta.get('title', req.source_thread_id)} (Fork)"
        )
        session_manager.set_thread_meta(
            res.thread_id,
            {
                "title": fork_title,
                "summary": f"Forked from {req.source_thread_id}",
            },
        )
        return {"thread_id": res.thread_id, "status": "forked", "title": fork_title}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/{thread_id}", summary="Read canonical thread history")
async def read_thread(thread_id: str) -> dict[str, Any]:
    """Read canonical App Server Session history for a specific thread."""
    try:
        try:
            cp = await session_manager.client.read_thread(thread_id)
        except AppServerError:
            await session_manager.client.start_thread(thread_id)
            cp = await session_manager.client.read_thread(thread_id)

        meta = session_manager.get_thread_meta(thread_id)
        return {
            "thread_id": cp.thread_id if cp else thread_id,
            "status": cp.status if cp else "active",
            "next_turn_number": cp.next_turn_number if cp else 1,
            "messages": cp.messages if cp else [],
            "metadata": meta,
            "raw": cp.raw if cp else {},
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/{thread_id}/items", summary="List ThreadItem projections")
async def list_thread_items(
    thread_id: str,
    turn_id: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=128),
    sort_direction: Literal["asc", "desc"] | None = Query(default=None),
) -> dict[str, Any]:
    """Expose the App Server's bounded Session-backed item projection."""
    try:
        result = await session_manager.client.list_thread_items(
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
    thread_id: str, req: UpdateThreadSummaryRequest
) -> dict[str, Any]:
    """Set or update custom summary for a thread."""
    meta = session_manager.set_thread_meta(thread_id, {"summary": req.summary})
    return {"thread_id": thread_id, "metadata": meta}


@router.patch("/{thread_id}/rename", summary="Rename thread title")
async def rename_thread(thread_id: str, req: RenameThreadRequest) -> dict[str, Any]:
    """Rename thread display title."""
    meta = session_manager.set_thread_meta(thread_id, {"title": req.title})
    return {"thread_id": thread_id, "metadata": meta}


@router.post("/{thread_id}/close", summary="Close thread")
async def close_thread(thread_id: str) -> dict[str, Any]:
    """Close an active thread and release server resources."""
    try:
        closed = await session_manager.client.close_thread(thread_id)
        return {"thread_id": thread_id, "closed": closed}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
