"""
World governance, MCP, Workflow, and File/Git inspection endpoints.
"""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from mini_agent.errors import AppServerError
from pydantic import BaseModel, Field

from server.session_manager import session_manager

router = APIRouter(prefix="/api", tags=["World & Workflows"])


DEFAULT_BUILTIN_TOOLS: list[str] = [
    "read_file",
    "apply_patch",
    "shell",
    "read_image",
]

ALL_BUILTIN_TOOLS: list[str] = [
    *DEFAULT_BUILTIN_TOOLS,
    "write_file",
    "edit_file",
    "web_fetch",
]


class SetExecutionRequest(BaseModel):
    approval: str = Field(default="interactive", description="interactive or automatic")
    copilot: bool = Field(default=False, description="Enable copilot assistance")


class UpdateThreadSettingsRequest(BaseModel):
    mode: Literal["default", "plan"] = Field(
        ..., description="Thread collaboration mode: default or plan"
    )
    builtin_tools: list[str] | None = Field(
        default=None,
        description="Optional bounded Builtin tool selection for this Thread",
    )
    thread_id: str | None = Field(
        default=None,
        description="Optional target Thread ID (defaults to active runtime thread)",
    )


class SetGoalRequest(BaseModel):
    objective: str = Field(
        ..., min_length=1, max_length=4096, description="Bounded Thread Goal objective"
    )
    status: (
        Literal[
            "active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"
        ]
        | None
    ) = Field(default=None, description="Optional Goal status")
    token_budget: int | None = Field(
        default=None, ge=1, description="Optional total token budget"
    )
    thread_id: str | None = Field(
        default=None,
        description="Optional target Thread ID (defaults to active runtime thread)",
    )


class CreateProjectRequest(BaseModel):
    name: str = Field(..., description="Project folder name or identifier")
    path: str | None = Field(default=None, description="Optional custom directory path")
    source_folders: list[dict[str, Any]] | None = Field(
        default=None, description="List of source folders with is_primary flag"
    )
    init_readme: bool = Field(
        default=True, description="Create initial README.md and AGENTS.md"
    )


class UpdateProjectRequest(BaseModel):
    name: str | None = Field(default=None, description="Updated project display name")
    pinned: bool | None = Field(default=None, description="Pinned status")
    source_folders: list[dict[str, Any]] | None = Field(
        default=None, description="List of source folders with is_primary flag"
    )


class SwitchProjectRequest(BaseModel):
    path: str = Field(..., description="Target directory path")


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
        return {"project": proj, "status": "switched"}
    except Exception as err:
        raise HTTPException(
            status_code=400, detail=f"Failed to switch project: {err}"
        ) from err


def _ask_directory_dialog() -> str:
    """Prompt native Windows/OS directory dialog."""
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(title="Select Project Root")
        root.destroy()
        return selected or ""
    except Exception:  # noqa: BLE001
        import subprocess

        ps_cmd = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$f = New-Object System.Windows.Forms.FolderBrowserDialog; "
            "$f.Description = 'Select Project Root'; "
            "if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.SelectedPath }"
        )
        res = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_cmd],
            capture_output=True,
            text=True,
            check=False,
        )
        return res.stdout.strip()


@router.post("/world/browse-folder", summary="Open native OS folder picker dialog")
async def browse_folder_endpoint() -> dict[str, Any]:
    """Open native OS directory picker dialog on local host."""
    loop = asyncio.get_running_loop()
    selected_path = await loop.run_in_executor(None, _ask_directory_dialog)
    if not selected_path:
        return {"selected": False, "path": "", "name": ""}
    p = Path(selected_path).resolve()
    return {"selected": True, "path": str(p), "name": p.name}


# -----------------------------------------------------------------------------
# World & MCP Endpoints
# -----------------------------------------------------------------------------


@router.get("/world/state", summary="Get environment & world state")
async def get_world_state() -> dict[str, Any]:
    """Retrieve snapshot of environment, available tools, and sandbox configuration."""
    try:
        res = await session_manager.client.get_world_state()
        return {
            "context": res.context,
            "lines": res.lines,
            "status": res.status,
            "workspace": res.workspace,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/world/refresh", summary="Refresh environment detection")
async def refresh_world() -> dict[str, Any]:
    """Re-scan workspace commands, installed packages, and toolchains."""
    try:
        res = await session_manager.client.refresh_world()
        return {
            "changed": res.changed,
            "state": res.state,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/world/execution", summary="Configure execution policy")
async def set_world_execution(req: SetExecutionRequest) -> dict[str, Any]:
    """Configure runtime approval policy and execution mode."""
    try:
        res = await session_manager.client.set_world_execution(
            approval=req.approval,
            copilot=req.copilot,
        )
        return {
            "changed": res.changed,
            "state": res.state,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/mcp/status", summary="Get MCP servers and tool status")
async def get_mcp_status() -> dict[str, Any]:
    """Retrieve registered MCP tools, enabled servers, and connectivity."""
    try:
        res = await session_manager.client.get_mcp_status()
        return {
            "enabled_servers": res.enabled_servers,
            "inactive_servers": res.inactive_servers,
            "tool_count": res.tool_count,
            "retry_available": res.retry_available,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/mcp/retry", summary="Retry MCP connections")
async def retry_mcp() -> dict[str, Any]:
    """Retry connection to failed or inactive MCP servers."""
    try:
        res = await session_manager.client.retry_mcp()
        return {
            "enabled_servers": res.enabled_servers,
            "inactive_servers": res.inactive_servers,
            "diagnostics": res.diagnostics,
            "tool_count": res.tool_count,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


# -----------------------------------------------------------------------------
# Thread Settings, Goals, and Artifact Inspection
# -----------------------------------------------------------------------------


@router.get("/workflows/state", summary="Get workflow state")
async def get_workflow_state(thread_id: str | None = None) -> dict[str, Any]:
    """Retrieve current collaboration mode, active Thread Goal, and builtin tools."""
    try:
        wf = await session_manager.client.get_workflow_state()
        goal_dict = None
        if wf.goal:
            g = wf.goal
            goal_dict = {
                "thread_id": g.thread_id,
                "objective": g.objective,
                "status": g.status,
                "token_budget": g.token_budget,
                "tokens_used": g.tokens_used,
                "time_used_seconds": g.time_used_seconds,
                "created_at": g.created_at,
                "updated_at": g.updated_at,
            }
        workflow_payload = (
            wf.raw.get("value", wf.raw) if isinstance(wf.raw, dict) else {}
        )
        has_builtin_selection = isinstance(workflow_payload, dict) and (
            "builtinTools" in workflow_payload or "builtin_tools" in workflow_payload
        )
        effective_builtin_tools = (
            wf.builtin_tools if has_builtin_selection else DEFAULT_BUILTIN_TOOLS
        )
        return {
            "collaboration_mode": {"mode": wf.collaboration_mode.mode},
            "builtin_tools": effective_builtin_tools,
            "available_builtin_tools": ALL_BUILTIN_TOOLS,
            "goal": goal_dict,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/workflows/settings", summary="Update Thread settings")
async def update_thread_settings(req: UpdateThreadSettingsRequest) -> dict[str, Any]:
    """Update collaboration mode and optional Builtin tool selection."""
    try:
        res = await session_manager.client.update_thread_settings(
            mode=req.mode,
            builtin_tools=req.builtin_tools,
            thread_id=req.thread_id,
        )
        return {
            "collaboration_mode": {"mode": res.collaboration_mode.mode},
            "builtin_tools": res.builtin_tools,
            "available_builtin_tools": ALL_BUILTIN_TOOLS,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/workflows/goal", summary="Set Thread Goal")
async def set_goal(req: SetGoalRequest) -> dict[str, Any]:
    """Set or replace the active Thread Goal."""
    try:
        res = await session_manager.client.set_goal(
            objective=req.objective,
            status=req.status,
            token_budget=req.token_budget,
            thread_id=req.thread_id,
        )
        return {"goal": _goal_dict(res.goal)}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/workflows/goal", summary="Get Thread Goal")
async def get_goal(thread_id: str | None = None) -> dict[str, Any]:
    """Read the active Thread Goal."""
    try:
        res = await session_manager.client.get_goal(thread_id=thread_id)
        return {"goal": _goal_dict(res.goal) if res.goal else None}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.delete("/workflows/goal", summary="Clear Thread Goal")
async def clear_goal(thread_id: str | None = None) -> dict[str, Any]:
    """Clear the active Thread Goal."""
    try:
        res = await session_manager.client.clear_goal(thread_id=thread_id)
        return {"cleared": res.cleared}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


def _goal_dict(goal: Any) -> dict[str, Any]:
    return {
        "thread_id": goal.thread_id,
        "objective": goal.objective,
        "status": goal.status,
        "token_budget": goal.token_budget,
        "tokens_used": goal.tokens_used,
        "time_used_seconds": goal.time_used_seconds,
        "created_at": goal.created_at,
        "updated_at": goal.updated_at,
    }


@router.get("/workflows/files", summary="List workflow and plan files")
async def list_workflow_files() -> dict[str, Any]:
    """Scan workspace for plan/goal files like plan.md, goal/plan.md, etc."""
    cwd = session_manager.current_project_path
    candidate_paths = [
        "plan.md",
        "goal/plan.md",
        "goal/milestones.json",
        "AGENTS.md",
        "README.md",
    ]
    discovered = []
    for rel in candidate_paths:
        p = cwd / rel
        if p.is_file():
            discovered.append(
                {
                    "path": rel,
                    "size": p.stat().st_size,
                    "mtime": p.stat().st_mtime,
                }
            )

    return {"files": discovered, "workspace": str(cwd)}


@router.get("/workflows/file/content", summary="Read workflow file content")
async def read_workflow_file_content(
    path: str = Query(..., description="Relative file path"),
) -> dict[str, Any]:
    """Read full text content of a workflow/plan file."""
    cwd = session_manager.current_project_path.resolve()
    target = (cwd / path).resolve()
    if not target.is_relative_to(cwd):
        raise HTTPException(status_code=403, detail="File path is outside workspace")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
        return {"path": path, "content": content, "size": len(content)}
    except Exception as err:
        raise HTTPException(
            status_code=500, detail=f"Failed to read file: {err}"
        ) from err


# -----------------------------------------------------------------------------
# Git & Workspace Files Inspection
# -----------------------------------------------------------------------------


def _get_git_status_sync() -> dict[str, Any]:
    cwd = str(session_manager.current_project_path)
    try:
        branch_proc = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2.0,
            check=False,
        )
        branch = branch_proc.stdout.strip() or "main"

        status_proc = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2.0,
            check=False,
        )
        lines = [
            line.strip() for line in status_proc.stdout.splitlines() if line.strip()
        ]

        modified = []
        untracked = []
        for line in lines:
            if line.startswith("??"):
                untracked.append(line[3:])
            else:
                modified.append(line)

        return {
            "branch": branch,
            "dirty": len(lines) > 0,
            "modified": modified,
            "untracked": untracked,
            "total_changes": len(lines),
            "workspace": cwd,
        }
    except Exception as err:  # noqa: BLE001
        return {
            "branch": "unknown",
            "dirty": False,
            "modified": [],
            "untracked": [],
            "error": str(err),
            "workspace": cwd,
        }


@router.get("/world/git/status", summary="Get git status and branch")
async def get_git_status() -> dict[str, Any]:
    """Retrieve Git repository status, current branch, and changed files."""
    return await asyncio.to_thread(_get_git_status_sync)


@router.get(
    "/world/workspace-files", summary="List files in workspace for autocomplete"
)
async def list_workspace_files(
    query: str = Query("", description="Optional search filter"),
    limit: int = Query(80, description="Max files to return"),
) -> dict[str, Any]:
    """Fast list of workspace relative file paths for @-mention autocomplete."""
    cwd = session_manager.current_project_path.resolve()
    ignore_dirs = {
        ".git",
        "node_modules",
        "__pycache__",
        ".venv",
        "venv",
        ".pytest_cache",
        ".ruff_cache",
        "dist",
        "build",
        "target",
        ".gemini",
        ".mini-agent",
    }

    q = query.lower().strip()

    def _scan_sync() -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []

        def _scan_dir(base_dir: Path, prefix: str = "", depth: int = 0) -> None:
            if depth > 7 or not base_dir.is_dir():
                return
            try:
                for entry in base_dir.iterdir():
                    if entry.name in ignore_dirs or (
                        entry.name.startswith(".") and entry.name != ".env.example"
                    ):
                        continue
                    rel_path = f"{prefix}/{entry.name}" if prefix else entry.name
                    if entry.is_dir():
                        _scan_dir(entry, rel_path, depth + 1)
                    elif entry.is_file() and (
                        not q or q in rel_path.lower() or q in entry.name.lower()
                    ):
                        results.append(
                            {
                                "name": entry.name,
                                "path": rel_path,
                                "abs_path": str(entry.resolve()),
                            }
                        )
                        if len(results) >= limit:
                            return
            except Exception:  # noqa: BLE001, S110
                pass

        _scan_dir(cwd)
        return results[:limit]

    files = await asyncio.to_thread(_scan_sync)
    return {"files": files, "workspace": str(cwd)}
