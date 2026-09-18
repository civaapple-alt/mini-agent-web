"""Project and workspace management routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from server.builtin_skills import builtin_skill_group_specs
from server.routes.world_models import (
    CreateProjectRequest,
    SwitchProjectRequest,
    UpdateProjectRequest,
)
from server.session_manager import session_manager

router = APIRouter(prefix="/api", tags=["World & Workflows"])


@router.get("/skills", summary="List effective project Skills")
async def list_skills(project_id: str | None = None) -> dict[str, Any]:
    """Return the bounded Skill catalog advertised by the project runtime."""
    client = await session_manager.get_client_for_project(project_id)
    manifest = getattr(client, "capability_manifest", {}) or {}
    raw_groups = manifest.get("builtinSkillGroups", []) or []
    raw_skills = manifest.get("availableSkills", []) or []
    groups = (
        [
            group
            for group in raw_groups
            if isinstance(group, dict) and isinstance(group.get("id"), str)
        ][:8]
        if isinstance(raw_groups, list)
        else []
    )
    group_ids = {group.get("id") for group in groups}
    for spec in builtin_skill_group_specs():
        if len(groups) >= 8:
            break
        if spec["id"] not in group_ids:
            groups.append(
                {
                    "id": spec["id"],
                    "version": spec["version"],
                    "enabled": False,
                }
            )
            group_ids.add(spec["id"])
    skills = (
        [skill for skill in raw_skills if isinstance(skill, dict)][:64]
        if isinstance(raw_skills, list)
        else []
    )
    return {
        "projectId": project_id or session_manager._current_project_id,
        "builtinSkillGroups": groups,
        "skills": skills,
    }

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
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
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
        if (
            (
                req.builtin_skill_groups is not None
                or req.subagent is not None
                or req.notebook is not None
            )
            and (
                session_manager.project_has_active_turn(project_id)
                or session_manager.project_has_pending_approval(project_id)
            )
        ):
            raise RuntimeError(
                f"Project '{project_id}' has an active Turn or pending approval; wait for it to settle before changing runtime settings"
            )
        proj = session_manager.update_project(project_id, updates)
        resolved_project_id = str(proj.get("id") or project_id)
        if resolved_project_id == session_manager._current_project_id:
            await session_manager.restart_for_current_project()
        else:
            await session_manager.restart_for_project(resolved_project_id)
        return {"project": proj, "status": "updated"}
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
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
