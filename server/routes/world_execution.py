"""World environment, execution policy, approval, and MCP routes."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from mini_agent.errors import AppServerError

from server.routes.world_models import SetExecutionRequest
from server.session_manager import session_manager

router = APIRouter(prefix="/api", tags=["World & Workflows"])

DEFAULT_BUILTIN_TOOLS: list[str] = [
    "read_file",
    "apply_patch",
    "shell",
    "read_image",
    "scheduled_task",
]

ALL_BUILTIN_TOOLS: list[str] = [
    *DEFAULT_BUILTIN_TOOLS,
    "web_fetch",
]


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
async def get_world_state(
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Retrieve snapshot of environment, available tools, and sandbox configuration."""
    try:
        client = await session_manager.get_client_for_project(project_id)
        res = await client.get_world_state()
        return {
            "context": res.context,
            "lines": res.lines,
            "status": res.status,
            "workspace": res.workspace,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/world/refresh", summary="Refresh environment detection")
async def refresh_world(project_id: str | None = Query(default=None)) -> dict[str, Any]:
    """Re-scan workspace commands, installed packages, and toolchains."""
    try:
        client = await session_manager.get_client_for_project(project_id)
        res = await client.refresh_world()
        return {
            "changed": res.changed,
            "state": res.state,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/world/execution", summary="Configure execution policy")
async def set_world_execution(
    req: SetExecutionRequest, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    """Configure independent access and approval policy."""
    try:
        target_project = project_id or req.project_id
        res = await session_manager.update_project_execution(
            req.access,
            req.policy,
            target_project,
        )
        return {
            "changed": res.changed,
            "access": req.access,
            "policy": req.policy,
            "state": res.state,
        }
    except (AppServerError, RuntimeError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/world/approval", summary="Inspect current project approvals")
async def get_world_approval(
    project_id: str | None = Query(default=None),
    thread_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Show the project policy and pending requests, never raw approval grants."""
    return session_manager.approval_snapshot(project_id, thread_id)


@router.post("/world/approval/revoke", summary="Revoke current project approvals")
async def revoke_world_approval(
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Restart the bound App Server so cached project approvals are discarded."""
    try:
        return await session_manager.revoke_current_project_approvals(project_id)
    except Exception as err:
        raise HTTPException(
            status_code=500, detail=f"Failed to revoke approvals: {err}"
        ) from err


@router.get("/mcp/status", summary="Get MCP servers and tool status")
async def get_mcp_status(
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Retrieve registered MCP tools, enabled servers, and connectivity."""
    try:
        client = await session_manager.get_client_for_project(project_id)
        res = await client.get_mcp_status()
        return {
            "enabled_servers": res.enabled_servers,
            "inactive_servers": res.inactive_servers,
            "tool_count": res.tool_count,
            "retry_available": res.retry_available,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/mcp/retry", summary="Retry MCP connections")
async def retry_mcp(project_id: str | None = Query(default=None)) -> dict[str, Any]:
    """Retry connection to failed or inactive MCP servers."""
    try:
        client = await session_manager.get_client_for_project(project_id)
        res = await client.retry_mcp()
        return {
            "enabled_servers": res.enabled_servers,
            "inactive_servers": res.inactive_servers,
            "diagnostics": res.diagnostics,
            "tool_count": res.tool_count,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
