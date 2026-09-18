"""
Settings management endpoints.
Manages UI preferences; execution access and approval live with the Project.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from server.session_manager import session_manager

router = APIRouter(prefix="/api/settings", tags=["Settings"])


class UpdateSettingsRequest(BaseModel):
    class SubagentSettings(BaseModel):
        max_concurrent_children: int = Field(default=2, ge=1, le=8)
        default_execution_mode: Literal["parallel", "sequential"] = "parallel"

    default_mode: str | None = Field(
        default=None, description="Default workflow mode (chat, plan, goal)"
    )
    reasoning_effort: str | None = Field(
        default=None, description="Reasoning effort (low, medium, high)"
    )
    theme: str | None = Field(
        default=None, description="UI theme (dark, light, cyberpunk)"
    )
    auto_scroll: bool | None = Field(
        default=None, description="Auto-scroll message stream"
    )
    word_wrap: bool | None = Field(default=None, description="Wrap code and text")
    font_size: int | None = Field(default=None, description="Editor and chat font size")
    subagent: SubagentSettings | None = Field(
        default=None, description="Child Session concurrency and scheduling mode"
    )


@router.get("", summary="Get current system settings")
async def get_settings(project_id: str | None = Query(default=None)) -> dict[str, Any]:
    """Retrieve current runtime and UI settings."""
    return session_manager.get_settings(project_id)


@router.post("", summary="Update system settings")
async def update_settings(
    req: UpdateSettingsRequest, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    """Update runtime settings."""
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    try:
        updated = session_manager.update_settings(payload)
    except ValueError as err:
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail=str(err)) from err
    return {"status": "ok", "settings": updated}
