"""Project and workspace management routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from server.routes.world_models import (
    CreateProjectRequest,
    SwitchProjectRequest,
    UpdateProjectRequest,
)
from server.session_manager import session_manager

router = APIRouter(prefix="/api", tags=["World & Workflows"])

# -----------------------------------------------------------------------------
# Projects & Workspace Management
# -----------------------------------------------------------------------------


@router.get("/projects", summary="List current and recent projects")
async def list_projects() -> dict[str, Any]:
    """Retrieve current workspace project and recently opened projects."""
    return session_manager.get_projects()


@router.post("/projects/new", summary="Create new project workspace")
async def create_project_endpoint(req: CreateProjectRequest) -> dict[str, Any]:
    """Create a new project workspace directory with initial scaffold."""
    try:
        proj = session_manager.create_project(
            name=req.name,
            path=req.path,
            source_folders=req.source_folders,
            init_readme=req.init_readme,
        )
        await session_manager.restart_for_current_project()
        return {"project": proj, "status": "created"}
    except Exception as err:
        raise HTTPException(
            status_code=400, detail=f"Failed to create project: {err}"
        ) from err


@router.patch("/projects/{project_id}", summary="Update project configuration")
async def update_project_endpoint(
    project_id: str, req: UpdateProjectRequest
) -> dict[str, Any]:
    """Update project name, primary path, or source folders."""
    try:
        updates = {k: v for k, v in req.model_dump().items() if v is not None}
        proj = session_manager.update_project(project_id, updates)
        if (
            project_id == session_manager._current_project_id
            or proj.get("id") == session_manager._current_project_id
        ):
            await session_manager.restart_for_current_project()
        return {"project": proj, "status": "updated"}
    except Exception as err:
        raise HTTPException(
            status_code=400, detail=f"Failed to update project: {err}"
        ) from err


@router.delete("/projects/{project_id}", summary="Delete local project")
async def delete_project_endpoint(project_id: str) -> dict[str, Any]:
    """Remove a project from the workspace registry."""
    success = session_manager.delete_project(project_id)
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "deleted", "project_id": project_id}


@router.post("/projects/{project_id}/pin", summary="Toggle project pin state")
async def pin_project_endpoint(project_id: str) -> dict[str, Any]:
    """Toggle pin/unpin for a project."""
    try:
        proj = session_manager.toggle_pin_project(project_id)
        return {"project": proj, "status": "pinned_toggled"}
    except Exception as err:
        raise HTTPException(
            status_code=400, detail=f"Failed to pin project: {err}"
        ) from err


@router.post("/projects/switch", summary="Switch project workspace")
async def switch_project_endpoint(req: SwitchProjectRequest) -> dict[str, Any]:
    """Switch active project workspace."""
    try:
        proj = session_manager.switch_project(req.path)
        # Project switching only changes the routing context. Existing clients,
        # turns, approvals, and stream tasks in other Projects stay alive.
        await session_manager.start()
        return {"project": proj, "status": "switched"}
    except Exception as err:
        raise HTTPException(
            status_code=400, detail=f"Failed to switch project: {err}"
        ) from err
