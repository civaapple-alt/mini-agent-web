"""
Agent interaction endpoints: REST, SSE streaming, and WebSocket.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from mini_agent.errors import AppServerError
from pydantic import BaseModel, Field

from server.session_manager import session_manager, to_json_serializable

logger = logging.getLogger("mini_agent.server.agent")

router = APIRouter(prefix="/api", tags=["Agent"])


class StartTurnRequest(BaseModel):
    prompt: str = Field(..., description="Prompt or instruction for the agent")
    mode: str = Field(default="start", description="Input mode: start or start_if_idle")
    thread_id: str | None = Field(default=None, description="Target thread ID")
    images: list[str] | None = Field(
        default=None, description="Optional Base64 data URLs for attached images"
    )
    referenced_files: list[str] | None = Field(
        default=None, description="Optional relative file paths referenced in prompt"
    )


class SteerTurnRequest(BaseModel):
    turn_id: str = Field(..., description="Active turn ID to steer")
    text: str = Field(..., description="Corrective steering instruction")
    thread_id: str | None = Field(default=None, description="Target thread ID")


class InterruptTurnRequest(BaseModel):
    turn_id: str = Field(..., description="Active turn ID to interrupt/cancel")
    thread_id: str | None = Field(default=None, description="Target thread ID")


class ApprovalResponseRequest(BaseModel):
    request_id: str = Field(
        ..., description="Approval request ID returned by approval_request event"
    )
    decision: str = Field(..., description="Decision: 'approved' or 'denied'")
    reason: str | None = Field(
        default=None, description="Optional explanation or restriction"
    )
    remember: bool = Field(
        default=False, description="Remember approval decision for this tool"
    )
    action: str | None = Field(
        default=None, description="Optional tool/action name to remember"
    )


def _process_attachments(
    prompt: str,
    images: list[str] | None = None,
    referenced_files: list[str] | None = None,
) -> str:
    """Save image attachments to workspace .mini-agent/attachments/ and enrich prompt context."""
    extra_context_parts = []

    if images:
        import base64
        import time

        attach_dir = (
            session_manager.current_project_path / ".mini-agent" / "attachments"
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
                fname = f"clipboard_{int(time.time())}_{idx + 1}.{ext}"
                file_path = attach_dir / fname
                file_path.write_bytes(img_bytes)
                rel_path = f".mini-agent/attachments/{fname}"
                extra_context_parts.append(
                    f"[User Attached Image: {rel_path} (Local path: {file_path})]"
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
    enriched_prompt = _process_attachments(req.prompt, req.images, req.referenced_files)
    try:
        sub = await session_manager.client.start_turn(
            prompt=enriched_prompt,
            mode=req.mode,
            thread_id=req.thread_id,
        )
        if not sub.turn_id:
            return {"status": sub.status, "reason": sub.reason}

        result = await session_manager.client.wait_for_turn(sub.turn_id)
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
) -> StreamingResponse:
    """Stream token deltas, tool executions, and turn events via Server-Sent Events (SSE)."""

    async def event_generator():
        try:
            async for item in session_manager.client.stream_turn(
                prompt=prompt,
                mode=mode,
                thread_id=thread_id,
            ):
                safe_item = to_json_serializable(item)
                # Also broadcast to active WebSockets for synced UI displays
                await session_manager.broadcast_ws(safe_item)

                payload = json.dumps(safe_item, ensure_ascii=False)
                yield f"data: {payload}\n\n"
        except Exception as err:
            logger.exception("SSE stream error")
            err_payload = json.dumps(
                {"type": "error", "message": str(err)}, ensure_ascii=False
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
        res = await session_manager.client.steer_turn(
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
        await session_manager.client.interrupt_turn(
            turn_id=req.turn_id,
            thread_id=req.thread_id,
        )
        return {"status": "interrupted", "turn_id": req.turn_id}
    except AppServerError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/approval/respond", summary="Respond to security approval request")
async def respond_approval(req: ApprovalResponseRequest) -> dict[str, Any]:
    """Submit human approval decision ('approved' or 'denied') to unblock sensitive action."""
    resolved = session_manager.resolve_approval(
        request_id=req.request_id,
        decision=req.decision,
        reason=req.reason,
        remember=req.remember,
        action_name=req.action,
    )
    if not resolved:
        raise HTTPException(
            status_code=404,
            detail=f"Approval request '{req.request_id}' not found or already settled",
        )
    return {
        "status": "resolved",
        "request_id": req.request_id,
        "decision": req.decision,
    }


@router.get("/approval/pending", summary="List pending approval requests")
async def list_pending_approvals() -> dict[str, Any]:
    """List IDs of active approval requests currently waiting for human decision."""
    return {"pending_requests": session_manager.list_pending_approvals()}


# -----------------------------------------------------------------------------
# WebSocket Full-Duplex Gateway
# -----------------------------------------------------------------------------

ws_router = APIRouter(tags=["WebSocket"])


@ws_router.websocket("/ws/agent")
@router.websocket("/ws/agent")
async def websocket_agent_endpoint(websocket: WebSocket) -> None:
    """
    Bidirectional WebSocket endpoint.
    Handles real-time streaming, interactive steering, interrupts, and security approval round-trips.
    """
    await session_manager.connect_ws(websocket)
    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                data = json.loads(raw_text)
            except json.JSONDecodeError:
                await websocket.send_json(
                    {"type": "error", "message": "Invalid JSON message"}
                )
                continue

            action = data.get("action")
            logger.debug("Received WebSocket action: %s", action)

            if action == "turn":
                prompt = data.get("prompt", "")
                thread_id = data.get("threadId")
                mode = data.get("mode", "start")
                if mode not in ("start", "start_if_idle"):
                    mode = "start"
                images = data.get("images")
                referenced_files = data.get("referencedFiles")

                enriched_prompt = _process_attachments(prompt, images, referenced_files)

                # Background task to stream turn events back over WebSocket
                asyncio.create_task(
                    _stream_turn_to_ws(websocket, enriched_prompt, mode, thread_id)
                )

            elif action == "steer":
                thread_id = data.get("threadId") or "default"
                turn_id = data.get("turnId") or session_manager.get_active_turn(
                    thread_id
                )
                text = data.get("text", "")
                if turn_id:
                    try:
                        await session_manager.client.steer_turn(
                            turn_id, text, thread_id
                        )
                        await websocket.send_json(
                            {"type": "steer_ack", "turnId": turn_id}
                        )
                    except Exception as err:  # noqa: BLE001
                        logger.warning("Failed to steer turn %s: %s", turn_id, err)
                        await websocket.send_json(
                            {"type": "error", "message": f"纠偏下发失败: {err}"}
                        )
                else:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "无法执行纠偏：当前没有正在执行的任务轮次",
                        }
                    )

            elif action == "interrupt":
                thread_id = data.get("threadId") or "default"
                turn_id = data.get("turnId") or session_manager.get_active_turn(
                    thread_id
                )
                logger.info(
                    "Interrupt requested for thread %s, turn %s", thread_id, turn_id
                )

                # 1. Cancel background stream task
                session_manager.cancel_active_task(thread_id)

                # 2. Notify App Server engine
                if turn_id:
                    try:
                        await session_manager.client.interrupt_turn(turn_id, thread_id)
                    except Exception as err:  # noqa: BLE001
                        logger.warning("Failed to call client.interrupt_turn: %s", err)

                # Send immediate interrupt ack to client (stream CancelledError will emit turn_finished)
                await websocket.send_json({"type": "interrupt_ack", "turnId": turn_id})

            elif action == "approval_response":
                req_id = data.get("requestId", "")
                decision = data.get("decision", "denied")
                reason = data.get("reason")
                remember = bool(data.get("remember", False))
                action_name = data.get("action") or data.get("tool")
                session_manager.resolve_approval(
                    req_id, decision, reason, remember=remember, action_name=action_name
                )
                await websocket.send_json({"type": "approval_ack", "requestId": req_id})

            elif action == "ping":
                await websocket.send_json({"type": "pong"})

    except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
        pass
    except Exception:
        logger.exception("WebSocket unhandled exception")
    finally:
        session_manager.disconnect_ws(websocket)


async def _stream_turn_to_ws(
    websocket: WebSocket,
    prompt: str,
    mode: str,
    thread_id: str | None,
) -> None:
    """Stream events from MiniAgentClient directly to the initiating WebSocket."""
    target_thread = thread_id or "default"
    current_task = asyncio.current_task()
    effort = session_manager.get_settings().get("reasoning_effort", "medium")
    try:
        async for item in session_manager.client.stream_turn(
            prompt=prompt,
            mode=mode,
            thread_id=target_thread,
            effort=effort,
        ):
            # Capture active turn id from submission or event
            if item.get("type") == "_turn_submission":
                turn_id = item.get("data", {}).get("turn_id") or getattr(
                    item.get("submission"), "turn_id", None
                )
                if turn_id:
                    session_manager.set_active_turn(
                        target_thread, str(turn_id), current_task
                    )
            elif item.get("type") == "event":
                turn_id = item.get("turnId")
                if turn_id:
                    session_manager.set_active_turn(
                        target_thread, str(turn_id), current_task
                    )

            safe_item = to_json_serializable(item)
            await websocket.send_json(safe_item)
    except asyncio.CancelledError:
        logger.info("WebSocket stream turn cancelled for thread: %s", target_thread)
        try:
            await websocket.send_json(
                {
                    "type": "event",
                    "threadId": target_thread,
                    "event": {
                        "type": "turn_finished",
                        "stop_reason": "interrupted",
                    },
                }
            )
        except Exception:  # noqa: BLE001, S110
            pass
    except Exception as err:
        logger.exception("WebSocket stream error")
        await websocket.send_json({"type": "error", "message": str(err)})
    finally:
        session_manager.clear_active_turn(target_thread)
        try:
            cp = await session_manager.client.read_thread(target_thread)
            session_manager.save_thread_checkpoint(target_thread, cp)
        except Exception as err:  # noqa: BLE001
            logger.debug(
                "Failed to checkpoint thread %s on turn finish: %s", target_thread, err
            )
