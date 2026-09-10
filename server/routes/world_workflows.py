"""Workflow, Plan, Goal, and Thread settings routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from mini_agent.errors import AppServerError, ServerProcessError

from server.routes.world_execution import ALL_BUILTIN_TOOLS, DEFAULT_BUILTIN_TOOLS
from server.routes.world_models import SetGoalRequest, UpdateThreadSettingsRequest
from server.session_manager import session_manager

router = APIRouter(prefix="/api", tags=["World & Workflows"])

# -----------------------------------------------------------------------------
# Thread Settings, Goals, and Artifact Inspection
# -----------------------------------------------------------------------------


@router.get("/workflows/state", summary="Get workflow state")
async def get_workflow_state(
    thread_id: str | None = None,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Retrieve current collaboration mode, active Thread Goal, and builtin tools."""
    try:
        target_thread = thread_id or "default"
        canonical = (
            session_manager.read_any_project_thread(target_thread, project_id)
            if project_id
            else session_manager.read_any_project_thread(target_thread)
        )
        if canonical:
            session = canonical.get("session", {})
            goal = session.get("goal")
            if isinstance(goal, dict) and goal.get("objective"):
                status = str(
                    goal.get("status") or session.get("goal_status") or "active"
                )
                goal_dict = {
                    "thread_id": goal.get("thread_id") or target_thread,
                    "objective": goal.get("objective", ""),
                    "status": status,
                    "token_budget": goal.get("token_budget"),
                    "tokens_used": goal.get("tokens_used", 0),
                    "time_used_seconds": goal.get("time_used_seconds", 0),
                    "created_at": goal.get("created_at", goal.get("created_at_ms", 0)),
                    "updated_at": goal.get("updated_at", goal.get("updated_at_ms", 0)),
                    "current_milestone": goal.get("current_milestone", 0),
                    "total_milestones": goal.get("total_milestones", 0),
                    "loop_count": goal.get("loop_count", 0),
                    "last_verifier_score": goal.get("last_verifier_score"),
                    "last_error": goal.get("last_error"),
                    "verification_status": goal.get("verification_status", "idle"),
                }
            else:
                goal_dict = None
            selected_builtin_tools = session_manager.builtin_tools_for_thread(
                target_thread,
                project_id,
            )
            effective_builtin_tools = (
                selected_builtin_tools
                if selected_builtin_tools is not None
                else DEFAULT_BUILTIN_TOOLS
            )
            continuation_mode = session.get("continuation_mode", "manual")
            return {
                "collaboration_mode": {
                    "mode": "plan" if session.get("plan_active") else "default"
                },
                "plan_review_pending": bool(session.get("plan_review_pending", False)),
                "builtin_tools": effective_builtin_tools,
                "continuation_mode": continuation_mode,
                "available_builtin_tools": ALL_BUILTIN_TOOLS,
                "goal": goal_dict,
                "state_revision": session.get("state_revision"),
                "source": "session_store",
                "session_status": session.get("session_status"),
                "runtime_status": session.get("runtime_status"),
            }

        client = await session_manager.get_client_for_thread(thread_id, project_id)
        wf = await client.get_workflow_state(thread_id=thread_id)
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
                "current_milestone": getattr(g, "current_milestone", 0),
                "total_milestones": getattr(g, "total_milestones", 0),
                "loop_count": getattr(g, "loop_count", 0),
                "last_verifier_score": getattr(g, "last_verifier_score", None),
                "last_error": getattr(g, "last_error", None),
                "verification_status": getattr(g, "verification_status", "idle"),
            }
        workflow_payload = (
            wf.raw.get("value", wf.raw) if isinstance(wf.raw, dict) else {}
        )
        has_builtin_selection = isinstance(workflow_payload, dict) and (
            "builtinTools" in workflow_payload or "builtin_tools" in workflow_payload
        )
        target_thread = thread_id or "default"
        selected_builtin_tools = session_manager.builtin_tools_for_thread(
            target_thread, project_id
        )
        if selected_builtin_tools is not None:
            effective_builtin_tools = selected_builtin_tools
        else:
            effective_builtin_tools = (
                wf.builtin_tools if has_builtin_selection else DEFAULT_BUILTIN_TOOLS
            )
        return {
            "collaboration_mode": {"mode": wf.collaboration_mode.mode},
            "builtin_tools": effective_builtin_tools,
            "continuation_mode": wf.continuation_mode,
            "state_revision": wf.state_revision,
            "available_builtin_tools": ALL_BUILTIN_TOOLS,
            "goal": goal_dict,
        }
    except ServerProcessError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/threads/{thread_id}/settings", summary="Update Thread settings")
async def update_thread_settings(
    thread_id: str,
    req: UpdateThreadSettingsRequest,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Update collaboration mode and optional Builtin tool selection."""
    try:
        routing_project_id = session_manager.resolve_thread_project(
            thread_id, project_id
        )
        if session_manager.get_active_turn(thread_id, routing_project_id) or (
            session_manager.list_pending_approvals(routing_project_id, thread_id)
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "当前 Turn 正在执行或等待审批，需先完成/停止本轮后才能切换 Plan Mode"
                ),
            )
        client = await session_manager.get_client_for_thread(
            thread_id, routing_project_id
        )
        res = await client.update_thread_settings(
            mode=req.mode,
            builtin_tools=req.builtin_tools,
            thread_id=thread_id,
            continuation_mode=req.continuation_mode,
        )
        session_manager.set_builtin_tools_for_thread(
            thread_id, res.builtin_tools, routing_project_id
        )
        return {
            "collaboration_mode": {"mode": res.collaboration_mode.mode},
            "builtin_tools": res.builtin_tools,
            "continuation_mode": res.continuation_mode,
            "state_revision": res.state_revision,
            "available_builtin_tools": ALL_BUILTIN_TOOLS,
        }
    except HTTPException:
        raise
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/threads/{thread_id}/goal", summary="Set Thread Goal")
async def set_goal(
    thread_id: str,
    req: SetGoalRequest,
    project_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Set or replace the active Thread Goal."""
    try:
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        res = await client.set_goal(
            objective=req.objective,
            status=req.status,
            token_budget=req.token_budget,
            thread_id=thread_id,
        )
        return {"goal": _goal_dict(res.goal), "state_revision": res.state_revision}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/threads/{thread_id}/goal", summary="Get Thread Goal")
async def get_goal(
    thread_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    """Read the active Thread Goal."""
    try:
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        res = await client.get_goal(thread_id=thread_id)
        return {
            "goal": _goal_dict(res.goal) if res.goal else None,
            "state_revision": res.state_revision,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.delete("/threads/{thread_id}/goal", summary="Clear Thread Goal")
async def clear_goal(
    thread_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    """Clear the active Thread Goal."""
    try:
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        res = await client.clear_goal(thread_id=thread_id)
        return {"cleared": res.cleared, "state_revision": res.state_revision}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/threads/{thread_id}/goal/pause", summary="Pause Thread Goal")
async def pause_goal(
    thread_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    """Pause a Goal while retaining its objective and progress."""
    try:
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        current = await client.get_goal(thread_id=thread_id)
        if not current.goal:
            raise HTTPException(status_code=404, detail="Thread Goal not found")
        result = await client.set_goal(
            # A status-only pause is explicitly admitted by the runtime while
            # a Goal turn is active. Re-sending objective/token budget makes
            # the mutation look like a replacement and is rejected as Busy.
            objective=None,
            status="paused",
            token_budget=None,
            thread_id=thread_id,
        )
        return {
            "goal": _goal_dict(result.goal),
            "state_revision": result.state_revision,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/threads/{thread_id}/goal/resume", summary="Resume Thread Goal")
async def resume_goal(
    thread_id: str, project_id: str | None = Query(default=None)
) -> dict[str, Any]:
    """Resume a paused Goal with the same objective and progress."""
    try:
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        current = await client.get_goal(thread_id=thread_id)
        if not current.goal:
            raise HTTPException(status_code=404, detail="Thread Goal not found")
        result = await client.set_goal(
            objective=current.goal.objective,
            status="active",
            token_budget=current.goal.token_budget,
            thread_id=thread_id,
        )
        return {
            "goal": _goal_dict(result.goal),
            "state_revision": result.state_revision,
        }
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
        "current_milestone": getattr(goal, "current_milestone", 0),
        "total_milestones": getattr(goal, "total_milestones", 0),
        "loop_count": getattr(goal, "loop_count", 0),
        "last_verifier_score": getattr(goal, "last_verifier_score", None),
        "last_error": getattr(goal, "last_error", None),
        "verification_status": getattr(goal, "verification_status", "idle"),
    }
