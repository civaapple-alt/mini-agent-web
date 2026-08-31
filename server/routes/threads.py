"""
Thread management endpoints.
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


class ForkThreadRequest(BaseModel):
    source_thread_id: str = Field(..., description="Existing thread ID to fork from")
    new_thread_id: str = Field(
        ..., description="New thread ID for the branched session"
    )


@router.get("", summary="List all threads")
async def list_threads(
    cursor: str | None = None, limit: int | None = None
) -> dict[str, Any]:
    """List active and historical conversation threads."""
    try:
        res = await session_manager.client.list_threads(cursor=cursor, limit=limit)
        return {
            "threads": res.data,
            "next_cursor": res.next_cursor,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("", summary="Start or attach to a thread")
async def start_thread(req: StartThreadRequest) -> dict[str, Any]:
    """Start or attach to a conversation thread."""
    try:
        active_id = await session_manager.client.start_thread(req.thread_id)
        return {"thread_id": active_id, "status": "active"}
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
        return {"thread_id": res.thread_id, "status": "forked"}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/{thread_id}", summary="Read thread checkpoint")
async def read_thread(thread_id: str) -> dict[str, Any]:
    """Read settled checkpoint and message history for a specific thread."""
    try:
        cp = await session_manager.client.read_thread(thread_id)
        return {
            "thread_id": cp.thread_id,
            "status": cp.status,
            "next_turn_number": cp.next_turn_number,
            "messages": cp.messages,
            "raw": cp.raw,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/{thread_id}/close", summary="Close thread")
async def close_thread(thread_id: str) -> dict[str, Any]:
    """Close an active thread and release server resources."""
    try:
        closed = await session_manager.client.close_thread(thread_id)
        return {"thread_id": thread_id, "closed": closed}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
