"""
World governance, MCP, and Workflow endpoints.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from mini_agent.errors import AppServerError
from pydantic import BaseModel, Field

from server.session_manager import session_manager

router = APIRouter(prefix="/api", tags=["World & Workflows"])


class SetExecutionRequest(BaseModel):
    approval: str = Field(default="interactive", description="interactive or automatic")
    copilot: bool = Field(default=False, description="Enable copilot assistance")


class SetPlanModeRequest(BaseModel):
    active: bool = Field(..., description="Enable or disable read-only plan mode")
    prompt: str | None = Field(
        default=None, description="Optional high-level planning prompt"
    )


class StartGoalRequest(BaseModel):
    objective: str = Field(
        ..., description="High-level goal objective to execute across milestones"
    )


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
# Workflows (Plan Mode & Multi-Milestone Goals)
# -----------------------------------------------------------------------------


@router.get("/workflows/state", summary="Get workflow state")
async def get_workflow_state() -> dict[str, Any]:
    """Retrieve current Plan Mode and active Goal status."""
    try:
        wf = await session_manager.client.get_workflow_state()
        goal_dict = None
        if wf.goal:
            g = wf.goal
            goal_dict = {
                "goal_id": g.goal_id,
                "status": g.status,
                "current_milestone": g.current_milestone,
                "total_milestones": g.total_milestones,
                "loop_count": g.loop_count,
                "max_loops": g.max_loops,
            }
        return {
            "plan_active": wf.plan_active,
            "goal": goal_dict,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/workflows/plan", summary="Set Plan Mode")
async def set_plan_mode(req: SetPlanModeRequest) -> dict[str, Any]:
    """Enable or disable read-only exploration Plan Mode."""
    try:
        res = await session_manager.client.set_plan_mode(
            active=req.active, prompt=req.prompt
        )
        return {
            "plan_active": res.plan_active,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/workflows/goal/start", summary="Start Goal workflow")
async def start_goal(req: StartGoalRequest) -> dict[str, Any]:
    """Start a new multi-milestone goal workflow."""
    try:
        res = await session_manager.client.start_goal(req.objective)
        return {
            "goal_id": res.goal_id,
            "status": res.status,
            "current_milestone": res.current_milestone,
            "total_milestones": res.total_milestones,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/workflows/goal/pause", summary="Pause Goal workflow")
async def pause_goal() -> dict[str, Any]:
    """Pause active goal execution."""
    try:
        res = await session_manager.client.pause_goal()
        return {
            "goal_id": res.goal_id,
            "status": res.status,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/workflows/goal/fail", summary="Fail Goal workflow")
async def fail_goal() -> dict[str, Any]:
    """Mark active goal as failed."""
    try:
        res = await session_manager.client.fail_goal()
        return {
            "goal_id": res.goal_id,
            "status": res.status,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/workflows/goal/criteria", summary="Get milestone criteria")
async def get_goal_criteria() -> dict[str, Any]:
    """Retrieve evaluation criteria for current milestone."""
    try:
        criteria = await session_manager.client.get_goal_criteria()
        return {"criteria": criteria}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
