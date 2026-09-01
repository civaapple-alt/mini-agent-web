"""
Thread management endpoints with metadata enrichment (title, summary, date grouping).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from mini_agent.errors import AppServerError
from pydantic import BaseModel, Field

from server.session_manager import session_manager

router = APIRouter(prefix="/api/threads", tags=["Threads"])


class StartThreadRequest(BaseModel):
    thread_id: str = Field(
        default="default", description="Identifier of the thread to create or attach"
    )
    title: str | None = Field(default=None, description="Optional custom display title")


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
        thread_ids = res.data if isinstance(res.data, list) else []

        # Ensure all discovered threads have metadata records
        enriched_threads: list[dict[str, Any]] = []
        for tid in thread_ids:
            meta = session_manager.get_thread_meta(tid)
            enriched_threads.append(
                {
                    "thread_id": tid,
                    "title": meta.get("title") or f"会话 {tid}",
                    "summary": meta.get("summary", ""),
                    "created_at": meta.get("created_at"),
                    "updated_at": meta.get("updated_at"),
                    "pinned": meta.get("pinned", False),
                }
            )

        return {
            "threads": enriched_threads,
            "raw_thread_ids": thread_ids,
            "next_cursor": res.next_cursor,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("", summary="Start or attach to a thread")
async def start_thread(req: StartThreadRequest) -> dict[str, Any]:
    """Start or attach to a conversation thread."""
    try:
        active_id = await session_manager.client.start_thread(req.thread_id)
        if req.title:
            session_manager.set_thread_meta(active_id, {"title": req.title})
        meta = session_manager.get_thread_meta(active_id)
        return {
            "thread_id": active_id,
            "status": "active",
            "title": meta.get("title"),
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


@router.get("/{thread_id}", summary="Read thread checkpoint")
async def read_thread(thread_id: str) -> dict[str, Any]:
    """Read settled checkpoint and message history for a specific thread."""
    try:
        cp = await session_manager.client.read_thread(thread_id)
        meta = session_manager.get_thread_meta(thread_id)
        return {
            "thread_id": cp.thread_id,
            "status": cp.status,
            "next_turn_number": cp.next_turn_number,
            "messages": cp.messages,
            "metadata": meta,
            "raw": cp.raw,
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
