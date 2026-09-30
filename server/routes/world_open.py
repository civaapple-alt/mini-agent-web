"""Local desktop application launch routes for registered Project workspaces."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from server.project_launcher import (
    available_project_open_targets,
    open_project_in_target,
)
from server.routes.world_models import OpenProjectRequest
from server.session_manager import session_manager

router = APIRouter(prefix="/api/world", tags=["World & Workflows"])


def _project_path(project_id: str | None) -> Path:
    try:
        path = (
            session_manager.project_primary_path(project_id)
            if project_id
            else session_manager.current_project_path
        ).resolve(strict=True)
    except (KeyError, FileNotFoundError) as err:
        raise HTTPException(status_code=404, detail="项目工作区不存在") from err
    if not path.is_dir():
        raise HTTPException(status_code=404, detail="项目工作区路径不是目录")
    return path


@router.get("/open-targets", summary="List local Project workspace open targets")
async def get_project_open_targets() -> dict[str, object]:
    """List fixed local application targets and whether each is available."""
    return available_project_open_targets()


@router.post("/open-project", summary="Open a registered Project workspace locally")
async def open_project_endpoint(
    req: OpenProjectRequest,
    project_id: str | None = Query(default=None),
) -> dict[str, object]:
    """Open the registered workspace in a fixed, host-local application."""
    path = _project_path(project_id)
    try:
        label = open_project_in_target(req.target, path)
    except FileNotFoundError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except (NotADirectoryError, OSError) as err:
        raise HTTPException(status_code=400, detail=f"无法启动所选应用：{err}") from err
    return {"opened": True, "target": req.target, "label": label}
