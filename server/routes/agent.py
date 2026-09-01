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
    mode: str = Field(
        default="start", description="Input mode: start, steer, follow_up"
    )
    thread_id: str | None = Field(default=None, description="Target thread ID")


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


# -----------------------------------------------------------------------------
# REST & SSE Endpoints
# -----------------------------------------------------------------------------


@router.post("/agent/turn", summary="Start and execute a turn synchronously")
async def execute_turn(req: StartTurnRequest) -> dict[str, Any]:
    """Submit a prompt and wait for turn completion."""
    try:
        sub = await session_manager.client.start_turn(
            prompt=req.prompt,
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

                # Background task to stream turn events back over WebSocket
                asyncio.create_task(
                    _stream_turn_to_ws(websocket, prompt, mode, thread_id)
                )

            elif action == "steer":
                turn_id = data.get("turnId")
                text = data.get("text", "")
                thread_id = data.get("threadId")
                if turn_id:
                    try:
                        await session_manager.client.steer_turn(
                            turn_id, text, thread_id
                        )
                        await websocket.send_json(
                            {"type": "steer_ack", "turnId": turn_id}
                        )
                    except Exception as err:  # noqa: BLE001
                        await websocket.send_json(
                            {"type": "error", "message": str(err)}
                        )

            elif action == "interrupt":
                turn_id = data.get("turnId")
                thread_id = data.get("threadId")
                if turn_id:
                    try:
                        await session_manager.client.interrupt_turn(turn_id, thread_id)
                        await websocket.send_json(
                            {"type": "interrupt_ack", "turnId": turn_id}
                        )
                    except Exception as err:  # noqa: BLE001
                        await websocket.send_json(
                            {"type": "error", "message": str(err)}
                        )

            elif action == "approval_response":
                req_id = data.get("requestId", "")
                decision = data.get("decision", "denied")
                reason = data.get("reason")
                session_manager.resolve_approval(req_id, decision, reason)
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
    try:
        async for item in session_manager.client.stream_turn(
            prompt=prompt,
            mode=mode,
            thread_id=thread_id,
        ):
            safe_item = to_json_serializable(item)
            await websocket.send_json(safe_item)
    except Exception as err:
        logger.exception("WebSocket stream error")
        await websocket.send_json({"type": "error", "message": str(err)})
