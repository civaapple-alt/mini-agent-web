"""Full-duplex WebSocket Agent transport."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Coroutine
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from mini_agent.errors import ServerProcessError

from server.routes.agent_models import (
    MAX_TEXT_ATTACHMENT_BYTES,
    MAX_TEXT_ATTACHMENTS,
    TextAttachment,
)
from server.routes.agent_turns import _process_attachments
from server.session_manager import session_manager, to_json_serializable

logger = logging.getLogger("mini_agent.server.agent")
router = APIRouter(prefix="/api", tags=["Agent"])
ws_router = APIRouter(tags=["WebSocket"])

# -----------------------------------------------------------------------------
# WebSocket Full-Duplex Gateway
# -----------------------------------------------------------------------------

ws_router = APIRouter(tags=["WebSocket"])


def _parse_text_attachments(raw_value: Any) -> list[TextAttachment]:
    """Validate the bounded text attachment shape shared by turn and steer."""
    if raw_value is None:
        return []
    if not isinstance(raw_value, list):
        raise TypeError("text attachments must be a list")
    if len(raw_value) > MAX_TEXT_ATTACHMENTS:
        raise ValueError(f"at most {MAX_TEXT_ATTACHMENTS} text attachments are allowed")

    try:
        attachments = [TextAttachment.model_validate(value) for value in raw_value]
    except Exception as err:
        raise ValueError("invalid text attachment") from err
    total_bytes = sum(
        len(attachment.content.encode("utf-8")) for attachment in attachments
    )
    if total_bytes > MAX_TEXT_ATTACHMENTS * MAX_TEXT_ATTACHMENT_BYTES:
        raise ValueError("text attachments exceed the total size limit")
    return attachments


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
                raw_text_attachments = data.get("textAttachments")
                if raw_text_attachments is None:
                    raw_text_attachments = data.get("text_attachments")
                try:
                    text_attachments = _parse_text_attachments(raw_text_attachments)
                except (TypeError, ValueError) as err:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "scope": "input",
                            "terminal": False,
                            "threadId": thread_id or "default",
                            "projectId": project_id,
                            "message": f"文本附件无效: {err}",
                        }
                    )
                    continue
                selected_skills = (
                    data.get("selectedSkills") or data.get("selected_skills") or []
                )
                if not isinstance(selected_skills, list):
                    selected_skills = []
                selected_skills = [
                    str(skill).strip()
                    for skill in selected_skills[:8]
                    if str(skill).strip()
                ]
                workflow = data.get("workflow")
                if workflow is not None:
                    if not isinstance(workflow, dict):
                        workflow = None
                    else:
                        workflow = {
                            "kind": workflow.get("kind"),
                            "id": str(workflow.get("id", "")).strip(),
                            "mode": workflow.get("mode", "auto"),
                        }
                        if (
                            workflow["kind"] != "skill_group"
                            or not workflow["id"]
                            or workflow["mode"] != "auto"
                        ):
                            workflow = None

                enriched_prompt = _process_attachments(
                    prompt,
                    images,
                    referenced_files,
                    thread_id,
                    project_id,
                    text_attachments=text_attachments,
                )

                # Background task to stream turn events back over WebSocket
                spawn_background(
                    _stream_turn_to_ws(
                        websocket,
                        enriched_prompt,
                        mode,
                        thread_id,
                        project_id,
                        selected_skills,
                        workflow,
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
                raw_text_attachments = data.get("textAttachments")
                if raw_text_attachments is None:
                    raw_text_attachments = data.get("text_attachments")
                source = data.get("source") or "unknown"
                logger.info(
                    "Steer requested for thread %s, turn %s source=%s",
                    thread_id,
                    turn_id,
                    source,
                )
                if turn_id:
                    try:
                        text_attachments = _parse_text_attachments(raw_text_attachments)
                        enriched_text = _process_attachments(
                            text,
                            thread_id=thread_id,
                            project_id=project_id,
                            text_attachments=text_attachments,
                        )
                    except (TypeError, ValueError) as err:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "scope": "input",
                                "terminal": False,
                                "threadId": thread_id,
                                "turnId": turn_id,
                                "projectId": project_id,
                                "message": f"文本附件无效: {err}",
                            }
                        )
                        continue
                    # Steering can wait for the App Server to accept the
                    # action. Keep it off the receive loop so an approval
                    # response can still be read from this same WebSocket.
                    spawn_background(
                        _steer_turn_to_ws(
                            websocket, thread_id, turn_id, enriched_text, project_id
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
                routing_project_id = session_manager.resolve_thread_project(
                    thread_id, project_id
                )
                websocket_project_id = project_id
                session_manager.set_ws_project(websocket, project_id)
                turn_id = data.get("turnId") or session_manager.get_active_turn(
                    thread_id, routing_project_id
                )
                source = data.get("source") or "unknown"
                logger.info(
                    "Interrupt requested for thread %s, turn %s source=%s",
                    thread_id,
                    turn_id,
                    source,
                )

                # Invalidate the approval bridge before cancelling the local
                # stream. A late click must not release a tool from this Turn.
                if turn_id:
                    session_manager.mark_turn_interrupted(
                        thread_id, turn_id, routing_project_id
                    )
                await session_manager.cancel_pending_approvals(
                    project_id=routing_project_id,
                    thread_id=thread_id,
                    turn_id=turn_id,
                )

                # Notify the App Server engine off the receive loop. A
                # successful response only acknowledges admission; the
                # Gateway stream remains authoritative until turn_finished.
                if turn_id:
                    spawn_background(
                        _interrupt_turn_to_ws(
                            websocket, thread_id, turn_id, routing_project_id
                        )
                    )

                # Send an immediate admission acknowledgement. The stream
                # remains authoritative and will emit the real turn_finished.
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
                    data.get("callId") or data.get("call_id"),
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
                            "callId": data.get("callId") or data.get("call_id"),
                            "message": "审批请求不存在、已处理或会话身份不匹配",
                        }
                    )
                    continue
                await session_manager.broadcast_approval_resolution(
                    request_id=req_id,
                    decision=decision,
                    grant_scope=grant_scope,
                    reason=reason,
                    call_id=data.get("callId") or data.get("call_id"),
                    project_id=project_id,
                    thread_id=data.get("threadId") or data.get("thread_id"),
                    turn_id=data.get("turnId") or data.get("turn_id"),
                )
                await websocket.send_json(
                    {
                        "type": "approval_ack",
                        "requestId": req_id,
                        "projectId": project_id,
                        "threadId": data.get("threadId") or data.get("thread_id"),
                        "turnId": data.get("turnId") or data.get("turn_id"),
                        "callId": data.get("callId") or data.get("call_id"),
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
        # Turn streams are Gateway-owned and must outlive this browser
        # connection. A reconnecting Studio can recover them from catalog,
        # runtime status, and bounded event replay.
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
        # ``turn/interrupt`` is an acceptance acknowledgement, not the
        # terminal boundary. Keep the stream/task registered until the App
        # Server emits turn_finished so late tool/approval settlement remains
        # observable and cannot be replaced by a synthetic completion.
    except asyncio.CancelledError:
        raise
    except Exception as err:  # noqa: BLE001
        logger.warning("Failed to call client.interrupt_turn: %s", err)
        try:
            await session_manager.broadcast_ws(
                {
                    "type": "error",
                    "scope": "turn",
                    "terminal": False,
                    "threadId": thread_id,
                    "turnId": turn_id,
                    "projectId": project_id,
                    "message": f"停止请求下发失败，请重试: {err}",
                }
            )
        except Exception:
            logger.debug(
                "WebSocket closed before interrupt error response", exc_info=True
            )


async def _stream_turn_to_ws(
    websocket: WebSocket,
    prompt: str,
    mode: str,
    thread_id: str | None,
    requested_project_id: str | None = None,
    selected_skills: list[str] | None = None,
    workflow: dict[str, Any] | None = None,
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
        stream_kwargs = {
            "prompt": prompt,
            "mode": mode,
            "thread_id": target_thread,
            "effort": effort,
        }
        if selected_skills:
            stream_kwargs["selected_skills"] = selected_skills
        if workflow:
            stream_kwargs["workflow"] = workflow
        async for item in client.stream_turn(**stream_kwargs):
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
                try:
                    await websocket.send_json(safe_item)
                except Exception:  # noqa: BLE001
                    # The initiating browser may have disconnected. Keep
                    # consuming the App Server stream so the Turn can settle
                    # and other Studio connections can still observe it.
                    logger.info(
                        "Origin WebSocket closed while Turn %s continued",
                        active_turn_id,
                    )
    except asyncio.CancelledError:
        logger.info("WebSocket stream turn cancelled for thread: %s", target_thread)
        # Task cancellation is a transport/lifecycle event, not an
        # authoritative Turn settlement. The App Server must publish the
        # real turn_finished event before the Gateway clears a Turn.
    except Exception as err:
        if isinstance(err, ServerProcessError):
            logger.warning(
                "App Server stream ended before Turn %s settled: %s",
                active_turn_id,
                err,
            )
            return
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
        await session_manager.broadcast_ws(error_payload)
    finally:
        session_manager.clear_active_turn(
            target_thread,
            project_id,
            active_turn_id,
            current_task,
        )
