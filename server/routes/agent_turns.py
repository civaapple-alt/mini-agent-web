"""REST and SSE Agent turn control routes."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from mini_agent.errors import AppServerError

from server.routes.agent_models import (
    ApprovalResponseRequest,
    InterruptTurnRequest,
    StartTurnRequest,
    SteerTurnRequest,
)
from server.session_manager import session_manager, to_json_serializable

logger = logging.getLogger("mini_agent.server.agent")
router = APIRouter(prefix="/api", tags=["Agent"])


def _process_attachments(
    prompt: str,
    images: list[str] | None = None,
    referenced_files: list[str] | None = None,
    thread_id: str | None = None,
    project_id: str | None = None,
    attachment_dir: Path | None = None,
) -> str:
    """Save image attachments to Gateway state and enrich prompt context.

    ``attachment_dir`` is an internal test seam. Production callers use the
    SessionManager-owned per-Project/per-Thread directory and never write to a
    Project workspace.
    """
    extra_context_parts = []

    if images:
        import base64

        attach_dir = attachment_dir or session_manager.attachments_path_for_thread(
            thread_id, project_id
        )
        attach_dir.mkdir(parents=True, exist_ok=True)

        for idx, img_data in enumerate(images):
            try:
                if "," in img_data:
                    header, b64_str = img_data.split(",", 1)
                    ext = "png"
                    if "image/jpeg" in header or "image/jpg" in header:
                        ext = "jpg"
                    elif "image/webp" in header:
                        ext = "webp"
                else:
                    b64_str = img_data
                    ext = "png"

                img_bytes = base64.b64decode(b64_str)
                fname = f"clipboard_{uuid4().hex}_{idx + 1}.{ext}"
                file_path = attach_dir / fname
                file_path.write_bytes(img_bytes)
                extra_context_parts.append(
                    f"[User Attached Image: {file_path} (Gateway session attachment)]"
                )
            except Exception as err:  # noqa: BLE001
                logger.warning("Failed to save attached image: %s", err)

    if referenced_files:
        clean_refs = [f.strip() for f in referenced_files if f.strip()]
        if clean_refs:
            extra_context_parts.append(
                f"[User Referenced Files: {', '.join(clean_refs)}]"
            )

    if extra_context_parts:
        return f"{prompt}\n\n" + "\n".join(extra_context_parts)
    return prompt


# -----------------------------------------------------------------------------
# REST & SSE Endpoints
# -----------------------------------------------------------------------------


@router.post("/agent/turn", summary="Start and execute a turn synchronously")
async def execute_turn(req: StartTurnRequest) -> dict[str, Any]:
    """Submit a prompt and wait for turn completion."""
    enriched_prompt = _process_attachments(
        req.prompt,
        req.images,
        req.referenced_files,
        req.thread_id,
        req.project_id,
    )
    try:
        client = await session_manager.get_client_for_thread(
            req.thread_id, req.project_id
        )
        start_kwargs = {
            "prompt": enriched_prompt,
            "mode": req.mode,
            "thread_id": req.thread_id,
        }
        if req.selected_skills:
            start_kwargs["selected_skills"] = req.selected_skills
        if req.workflow:
            start_kwargs["workflow"] = req.workflow.model_dump()
        sub = await client.start_turn(**start_kwargs)
        if not sub.turn_id:
            return {"status": sub.status, "reason": sub.reason}

        result = await client.wait_for_turn(sub.turn_id)
        return {
            "turn_id": result.turn_id,
            "status": result.status,
            "stop_reason": result.stop_reason,
            "final_text": result.final_text,
            "steps": result.steps,
            "messages": result.messages,
            "items": to_json_serializable(result.items),
            "error": result.error,
        }
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/agent/stream", summary="Stream turn events via SSE")
@router.post("/agent/stream", summary="Stream turn events via SSE")
async def stream_turn(
    prompt: str = Query(..., description="Prompt text"),
    mode: str = Query("start", description="Execution mode"),
    thread_id: str | None = Query(None, description="Thread ID"),
    project_id: str | None = Query(None, description="Project ID"),
    selected_skills: list[str] | None = None,
    workflow_id: str | None = Query(None, description="Optional Skill Group ID"),
) -> StreamingResponse:
    """Stream token deltas, tool executions, and turn events via Server-Sent Events (SSE)."""

    async def event_generator():
        try:
            client = await session_manager.get_client_for_thread(thread_id, project_id)
            stream_kwargs = {"prompt": prompt, "mode": mode, "thread_id": thread_id}
            if selected_skills:
                stream_kwargs["selected_skills"] = selected_skills[:8]
            if workflow_id:
                stream_kwargs["workflow"] = {
                    "kind": "skill_group",
                    "id": workflow_id,
                    "mode": "auto",
                }
            async for item in client.stream_turn(**stream_kwargs):
                safe_item = to_json_serializable(item)
                payload = json.dumps(safe_item, ensure_ascii=False)
                yield f"data: {payload}\n\n"
        except Exception as err:
            logger.exception("SSE stream error")
            err_payload = json.dumps(
                {
                    "type": "error",
                    "scope": "turn",
                    "terminal": True,
                    "threadId": thread_id or "default",
                    "projectId": project_id,
                    "message": str(err),
                },
                ensure_ascii=False,
            )
            yield f"data: {err_payload}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/agent/steer", summary="Steer active turn")
async def steer_turn(req: SteerTurnRequest) -> dict[str, Any]:
    """Inject a dynamic steering instruction into a currently executing turn."""
    try:
        client = await session_manager.get_client_for_thread(
            req.thread_id, req.project_id
        )
        res = await client.steer_turn(
            turn_id=req.turn_id,
            text=req.text,
            thread_id=req.thread_id,
        )
        return {"status": "steered", "action_id": res.get("actionId")}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/agent/interrupt", summary="Interrupt active turn")
async def interrupt_turn(req: InterruptTurnRequest) -> dict[str, Any]:
    """Cooperatively interrupt and cancel an active turn."""
    try:
        thread_id = req.thread_id or "default"
        project_id = session_manager.resolve_thread_project(thread_id, req.project_id)
        session_manager.mark_turn_interrupted(thread_id, req.turn_id, project_id)
        await session_manager.cancel_pending_approvals(
            project_id=project_id,
            thread_id=thread_id,
            turn_id=req.turn_id,
        )
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        await client.interrupt_turn(
            turn_id=req.turn_id,
            thread_id=thread_id,
        )
        # The App Server response only acknowledges the cooperative stop
        # request. Keep the Gateway stream and active-turn identity alive until
        # the authoritative turn_finished event arrives; cancelling the stream
        # here would make a still-settling Turn disappear from Studio.
        return {"status": "interrupted", "turn_id": req.turn_id}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/approval/respond", summary="Respond to security approval request")
async def respond_approval(req: ApprovalResponseRequest) -> dict[str, Any]:
    """Submit a typed human approval decision to unblock a sensitive action."""
    resolved = session_manager.resolve_approval(
        request_id=req.request_id,
        decision=req.decision,
        grant_scope=req.grant_scope,
        reason=req.reason,
        project_id=req.project_id,
        thread_id=req.thread_id,
        turn_id=req.turn_id,
        call_id=req.call_id,
    )
    if not resolved:
        raise HTTPException(
            status_code=404,
            detail=f"Approval request '{req.request_id}' not found or already settled",
        )
    await session_manager.broadcast_approval_resolution(
        request_id=req.request_id,
        decision=req.decision,
        grant_scope=req.grant_scope,
        reason=req.reason,
        call_id=req.call_id,
        project_id=req.project_id,
        thread_id=req.thread_id,
        turn_id=req.turn_id,
    )
    return {
        "status": "resolved",
        "request_id": req.request_id,
        "decision": req.decision,
        "call_id": req.call_id,
    }


@router.get("/approval/pending", summary="List pending approval requests")
async def list_pending_approvals(
    project_id: str | None = Query(default=None),
    thread_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """List IDs of active approval requests currently waiting for human decision."""
    return {
        "project_id": project_id,
        "pending_requests": session_manager.list_pending_approvals(
            project_id, thread_id
        ),
    }
