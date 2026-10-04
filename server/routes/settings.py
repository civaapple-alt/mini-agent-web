"""
Settings management endpoints.
Manages UI preferences; execution access and approval live with the Project.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from server.session_manager import session_manager

router = APIRouter(prefix="/api/settings", tags=["Settings"])


class UpdateSettingsRequest(BaseModel):
    theme: str | None = None
    auto_scroll: bool | None = None
    word_wrap: bool | None = None
    font_size: int | None = None


_UI_PREFERENCES = ("theme", "auto_scroll", "word_wrap", "font_size")


def _ui_preferences() -> dict[str, Any]:
    settings = session_manager.get_settings()
    return {key: settings[key] for key in _UI_PREFERENCES if key in settings}


@router.get("", summary="Get current system settings")
async def get_settings() -> dict[str, Any]:
    """Retrieve global Web Studio interface preferences."""
    return _ui_preferences()


@router.post("", summary="Update system settings")
async def update_settings(req: UpdateSettingsRequest) -> dict[str, Any]:
    """Update global Web Studio interface preferences."""
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    try:
        updated = session_manager.update_settings(payload)
    except ValueError as err:
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail=str(err)) from err
    return {
        "status": "ok",
        "settings": {key: updated[key] for key in _UI_PREFERENCES if key in updated},
    }
