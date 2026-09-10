"""
Agent interaction endpoints: REST, SSE streaming, and WebSocket.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Coroutine
from typing import Any, Literal

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
    project_id: str | None = Field(
        default=None, description="Canonical project routing context"
    )


class SteerTurnRequest(BaseModel):
    turn_id: str = Field(..., description="Active turn ID to steer")
    text: str = Field(..., description="Corrective steering instruction")
    thread_id: str | None = Field(default=None, description="Target thread ID")
    project_id: str | None = Field(
        default=None, description="Canonical project routing context"
    )


class InterruptTurnRequest(BaseModel):
    turn_id: str = Field(..., description="Active turn ID to interrupt/cancel")
    thread_id: str | None = Field(default=None, description="Target thread ID")
    project_id: str | None = Field(
        default=None, description="Canonical project routing context"
    )


class ApprovalResponseRequest(BaseModel):
    request_id: str = Field(
        ..., description="Approval request ID returned by approval_request event"
    )
    decision: Literal["approve", "deny"] = Field(
        ..., description="Decision: approve or deny"
    )
    grant_scope: Literal["once", "session", "project"] | None = Field(
        ..., description="Requested lifetime for the Host-owned action grant"
    )
    reason: str | None = Field(
        default=None, description="Optional explanation or restriction"
    )
    project_id: str | None = Field(
        default=None, description="Canonical project routing context"
    )
    thread_id: str | None = Field(default=None, description="Target Thread ID")
    turn_id: str | None = Field(default=None, description="Target active Turn ID")


def _process_attachments(
    prompt: str,
    images: list[str] | None = None,
    referenced_files: list[str] | None = None,
    thread_id: str | None = None,
    project_id: str | None = None,
) -> str:
    """Save image attachments to workspace .mini-agent/attachments/ and enrich prompt context."""
    extra_context_parts = []

    if images:
        import base64
        import time

        attach_dir = (
            session_manager.project_path_for_thread(thread_id, project_id)
            / ".mini-agent"
            / "attachments"
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
        sub = await client.start_turn(
            prompt=enriched_prompt,
            mode=req.mode,
            thread_id=req.thread_id,
        )
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
) -> StreamingResponse:
    """Stream token deltas, tool executions, and turn events via Server-Sent Events (SSE)."""

    async def event_generator():
        try:
            client = await session_manager.get_client_for_thread(thread_id, project_id)
            async for item in client.stream_turn(
                prompt=prompt,
                mode=mode,
                thread_id=thread_id,
            ):
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
        client = await session_manager.get_client_for_thread(
            req.thread_id, req.project_id
        )
        await client.interrupt_turn(
            turn_id=req.turn_id,
            thread_id=req.thread_id,
        )
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
async def list_pending_approvals(
    project_id: str | None = Query(default=None),
    thread_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """List IDs of active approval requests currently waiting for human decision."""
    return {
        "project_id": project_id,
        "pending_requests": session_manager.list_pending_approvals(project_id, thread_id),
    }


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
    websocket_project_id = websocket.query_params.get("project_id")
    await session_manager.connect_ws(websocket, websocket_project_id)
    background_tasks: set[asyncio.Task[None]] = set()

    def project_for_message(data: dict[str, Any]) -> str | None:
        # An explicit null clears a previous project binding when Studio
        # returns to the unqualified/default workspace.
        if "project_id" in data:
            return data.get("project_id")
        if "projectId" in data:
            return data.get("projectId")
        return websocket_project_id

    def spawn_background(coroutine: Coroutine[Any, Any, None]) -> None:
        task = asyncio.create_task(coroutine)
        background_tasks.add(task)
        task.add_done_callback(background_tasks.discard)

    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                data = json.loads(raw_text)
            except json.JSONDecodeError:
                await websocket.send_json(
                    {
                        "type": "error",
                        "message": "Invalid JSON message",
                        "projectId": websocket_project_id,
                    }
                )
                continue

            action = data.get("action")
            logger.debug("Received WebSocket action: %s", action)

            if action == "turn":
                prompt = data.get("prompt", "")
                thread_id = data.get("threadId")
                project_id = project_for_message(data)
                websocket_project_id = project_id
                session_manager.set_ws_project(websocket, project_id)
                mode = data.get("mode", "start")
                if mode not in ("start", "start_if_idle"):
                    mode = "start"
                images = data.get("images")
                referenced_files = data.get("referencedFiles")

                enriched_prompt = _process_attachments(
                    prompt, images, referenced_files, thread_id, project_id
                )

                # Background task to stream turn events back over WebSocket
                spawn_background(
                    _stream_turn_to_ws(
                        websocket, enriched_prompt, mode, thread_id, project_id
                    )
                )

            elif action == "steer":
                thread_id = data.get("threadId") or "default"
                project_id = project_for_message(data)
                websocket_project_id = project_id
                session_manager.set_ws_project(websocket, project_id)
                turn_id = data.get("turnId") or session_manager.get_active_turn(
                    thread_id, project_id
                )
                text = data.get("text", "")
                source = data.get("source") or "unknown"
                logger.info(
                    "Steer requested for thread %s, turn %s source=%s",
                    thread_id,
                    turn_id,
                    source,
                )
                if turn_id:
                    # Steering can wait for the App Server to accept the
                    # action. Keep it off the receive loop so an approval
                    # response can still be read from this same WebSocket.
                    spawn_background(
                        _steer_turn_to_ws(
                            websocket, thread_id, turn_id, text, project_id
                        )
                    )
                else:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "无法执行纠偏：当前没有正在执行的任务轮次",
                            "threadId": thread_id,
                            "projectId": project_id,
                        }
                    )

            elif action == "interrupt":
                thread_id = data.get("threadId") or "default"
                project_id = project_for_message(data)
                websocket_project_id = project_id
                session_manager.set_ws_project(websocket, project_id)
                turn_id = data.get("turnId") or session_manager.get_active_turn(
                    thread_id, project_id
                )
                source = data.get("source") or "unknown"
                logger.info(
                    "Interrupt requested for thread %s, turn %s source=%s",
                    thread_id,
                    turn_id,
                    source,
                )

                # 1. Cancel background stream task
                session_manager.cancel_active_task(thread_id, project_id)

                # 2. Notify App Server engine
                if turn_id:
                    # As with steering, interruption must not stop the
                    # receive loop from accepting an approval response.
                    spawn_background(
                        _interrupt_turn_to_ws(websocket, thread_id, turn_id, project_id)
                    )

                # Send immediate interrupt ack to client (stream CancelledError will emit turn_finished)
                await websocket.send_json(
                    {
                        "type": "interrupt_ack",
                        "threadId": thread_id,
                        "turnId": turn_id,
                        "projectId": project_id,
                        "source": source,
                    }
                )

            elif action == "approval_response":
                req_id = data.get("requestId", "")
                decision = data.get("decision", "denied")
                grant_scope = data.get("grantScope")
                reason = data.get("reason")
                project_id = project_for_message(data)
                websocket_project_id = project_id
                session_manager.set_ws_project(websocket, project_id)
                resolved = session_manager.resolve_approval(
                    req_id,
                    decision,
                    grant_scope,
                    reason,
                    project_id,
                    data.get("threadId") or data.get("thread_id"),
                    data.get("turnId") or data.get("turn_id"),
                )
                if not resolved:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "scope": "approval",
                            "requestId": req_id,
                            "projectId": project_id,
                            "threadId": data.get("threadId") or data.get("thread_id"),
                            "turnId": data.get("turnId") or data.get("turn_id"),
                            "message": "审批请求不存在、已处理或会话身份不匹配",
                        }
                    )
                    continue
                await websocket.send_json(
                    {
                        "type": "approval_ack",
                        "requestId": req_id,
                        "projectId": project_id,
                        "threadId": data.get("threadId") or data.get("thread_id"),
                        "turnId": data.get("turnId") or data.get("turn_id"),
                    }
                )

            elif action == "ping":
                ping_project_id = project_for_message(data)
                websocket_project_id = ping_project_id
                session_manager.set_ws_project(websocket, ping_project_id)
                await websocket.send_json(
                    {
                        "type": "pong",
                        "projectId": ping_project_id,
                    }
                )

    except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
        pass
    except Exception:
        logger.exception("WebSocket unhandled exception")
    finally:
        for task in background_tasks:
            task.cancel()
        session_manager.disconnect_ws(websocket)


async def _steer_turn_to_ws(
    websocket: WebSocket,
    thread_id: str,
    turn_id: str,
    text: str,
    project_id: str | None = None,
) -> None:
    """Submit steering without blocking the WebSocket receive loop."""
    try:
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        await client.steer_turn(turn_id, text, thread_id)
        await websocket.send_json(
            {"type": "steer_ack", "turnId": turn_id, "projectId": project_id}
        )
    except asyncio.CancelledError:
        raise
    except Exception as err:  # noqa: BLE001
        logger.warning("Failed to steer turn %s: %s", turn_id, err)
        try:
            await websocket.send_json(
                {
                    "type": "error",
                    "scope": "turn",
                    "threadId": thread_id,
                    "turnId": turn_id,
                    "projectId": project_id,
                    "message": f"纠偏下发失败: {err}",
                }
            )
        except Exception:
            logger.debug("WebSocket closed before steer error response", exc_info=True)


async def _interrupt_turn_to_ws(
    websocket: WebSocket,
    thread_id: str,
    turn_id: str,
    project_id: str | None = None,
) -> None:
    """Notify the App Server of an interrupt without blocking receives."""
    try:
        client = await session_manager.get_client_for_thread(thread_id, project_id)
        await client.interrupt_turn(turn_id, thread_id)
    except asyncio.CancelledError:
        raise
    except Exception as err:  # noqa: BLE001
        logger.warning("Failed to call client.interrupt_turn: %s", err)


async def _stream_turn_to_ws(
    websocket: WebSocket,
    prompt: str,
    mode: str,
    thread_id: str | None,
    requested_project_id: str | None = None,
) -> None:
    """Stream events from MiniAgentClient directly to the initiating WebSocket."""
    target_thread = thread_id or "default"
    current_task = asyncio.current_task()
    effort = session_manager.get_settings(requested_project_id).get(
        "reasoning_effort", "high"
    )
    active_turn_id: str | None = None
    project_id: str | None = None
    try:
        client = await session_manager.get_client_for_thread(
            target_thread, requested_project_id
        )
        project_id = requested_project_id or session_manager._client_projects.get(
            target_thread
        )
        async for item in client.stream_turn(
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
                    active_turn_id = str(turn_id)
                    session_manager.set_active_turn(
                        target_thread,
                        active_turn_id,
                        current_task,
                        project_id,
                    )
            elif item.get("type") == "event":
                turn_id = item.get("turnId")
                if turn_id:
                    active_turn_id = str(turn_id)
                    session_manager.set_active_turn(
                        target_thread,
                        active_turn_id,
                        current_task,
                        project_id,
                    )

            safe_item = to_json_serializable(item)
            # App Server notifications are centrally broadcast by the SDK
            # notification handler. Only the submission response is local to
            # this request; sending the stream again here would duplicate
            # every event for the initiating WebSocket.
            if safe_item.get("type") == "_turn_submission":
                safe_item["threadId"] = target_thread
                if project_id:
                    safe_item["projectId"] = project_id
                await websocket.send_json(safe_item)
    except asyncio.CancelledError:
        logger.info("WebSocket stream turn cancelled for thread: %s", target_thread)
        try:
            await session_manager.broadcast_ws(
                {
                    "type": "event",
                    "threadId": target_thread,
                    "projectId": project_id,
                    "turnId": active_turn_id,
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
        error_payload = {
            "type": "error",
            "scope": "turn",
            "terminal": True,
            "threadId": target_thread,
            "turnId": active_turn_id,
            "message": str(err),
        }
        if project_id:
            error_payload["projectId"] = project_id
        await websocket.send_json(error_payload)
    finally:
        session_manager.clear_active_turn(target_thread, project_id)
