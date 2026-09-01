"""
Settings management endpoints.
Manages profile, approval policy, theme, reasoning settings, and UI preferences.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from server.session_manager import session_manager

router = APIRouter(prefix="/api/settings", tags=["Settings"])


class UpdateSettingsRequest(BaseModel):
    profile: str | None = Field(
        default=None, description="Client profile (interactive, auto, ask)"
    )
    approval_policy: str | None = Field(
        default=None, description="Approval policy: per_action, auto_approve, strict"
    )
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


@router.get("", summary="Get current system settings")
async def get_settings() -> dict[str, Any]:
    """Retrieve current runtime and UI settings."""
    return session_manager.get_settings()


@router.post("", summary="Update system settings")
async def update_settings(req: UpdateSettingsRequest) -> dict[str, Any]:
    """Update runtime settings."""
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    updated = session_manager.update_settings(payload)
    return {"status": "ok", "settings": updated}
