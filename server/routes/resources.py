"""Resource snapshots for Gateway-owned App Server processes."""

from __future__ import annotations

from fastapi import APIRouter, Query

from server.session_manager import session_manager

router = APIRouter(prefix="/api/resources", tags=["Resources"])


@router.get("", summary="Read Gateway and App Server resource usage")
async def get_resources() -> dict:
    """Return a live process snapshot and bounded system memory warning."""
    return await session_manager.resource_snapshot()


@router.get("/history", summary="Read recent process resource samples")
async def get_resource_history(
    process_key: str = Query(..., min_length=1, max_length=512),
) -> dict:
    """Return at most ten minutes of numeric samples for one process identity."""
    return await session_manager.resource_history(process_key)
