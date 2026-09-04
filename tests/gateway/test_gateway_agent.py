"""
Unit and integration tests for Gateway Agent interaction endpoints:
- Synchronous REST turn execution (/api/agent/turn)
- SSE streaming (/api/agent/stream)
- Dynamic steering (/api/agent/steer)
- Task interruption (/api/agent/interrupt)
- Attachment processing (_process_attachments)
- HTTP security approval response (/api/approval/respond)
- WebSocket interactive actions (steer, interrupt, approval_response)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from mini_agent.errors import AppServerError
from mini_agent.types import TurnSubmissionResult

from server.app import create_app
from server.routes.agent import _process_attachments
from server.session_manager import session_manager


@pytest.fixture
def agent_test_app(tmp_path):
    """Create a test FastAPI app with mock session manager workspace."""
    session_manager._current_project_id = "agent_test_proj"
    session_manager._current_project_path = tmp_path
    session_manager._projects_registry = {
        "agent_test_proj": {
            "id": "agent_test_proj",
            "name": "Agent Test Project",
            "primary_path": str(tmp_path),
            "access": "project",
            "approval": "per_action",
            "source_folders": [
                {"name": "root", "path": str(tmp_path), "is_primary": True}
            ],
        }
    }
    return create_app()


@pytest.mark.asyncio
async def test_agent_turn_execution_success_and_error(agent_test_app):
    """Test POST /api/agent/turn synchronous execution and AppServerError mapping."""
    mock_client = AsyncMock()

    @dataclass
    class MockTurnResult:
        turn_id: str = "turn-sync-1"
        status: str = "completed"
        stop_reason: str = "finished"
        final_text: str = "Done successfully"
        steps: int = 1
        messages: list = field(
            default_factory=lambda: [{"role": "assistant", "text": "Done successfully"}]
        )
        items: list = field(default_factory=list)
        error: str | None = None

    mock_client.start_turn = AsyncMock(
        return_value=TurnSubmissionResult(
            turn_id="turn-sync-1", status="started", reason=None
        )
    )
    mock_client.wait_for_turn = AsyncMock(return_value=MockTurnResult())
    session_manager._client = mock_client
    session_manager._clients["default"] = mock_client

    transport = ASGITransport(app=agent_test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Successful turn execution
        resp = await client.post(
            "/api/agent/turn",
            json={"prompt": "echo hello", "mode": "start"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["turn_id"] == "turn-sync-1"
        assert data["status"] == "completed"
        assert data["final_text"] == "Done successfully"

        # 2. Start turn rejected (e.g. busy/conflict)
        mock_client.start_turn = AsyncMock(
            return_value=TurnSubmissionResult(
                turn_id="", status="busy", reason="Turn already running"
            )
        )
        resp_busy = await client.post(
            "/api/agent/turn",
            json={"prompt": "echo concurrent", "mode": "start"},
        )
        assert resp_busy.status_code == 200
        assert resp_busy.json()["status"] == "busy"
        assert resp_busy.json()["reason"] == "Turn already running"

        # 3. AppServerError mapping to HTTP 400
        mock_client.start_turn = AsyncMock(
            side_effect=AppServerError(-32603, "App Server crashed or unavailable")
        )
        resp_err = await client.post(
            "/api/agent/turn",
            json={"prompt": "trigger error", "mode": "start"},
        )
        assert resp_err.status_code == 400
        assert "App Server crashed" in resp_err.json()["detail"]


@pytest.mark.asyncio
async def test_agent_stream_sse(agent_test_app):
    """Test GET /api/agent/stream Server-Sent Events (SSE) streaming."""

    async def mock_stream_turn(prompt, mode="start", thread_id=None):
        yield {
            "type": "_turn_submission",
            "threadId": thread_id or "default",
            "data": {"turn_id": "turn-sse-1"},
        }
        yield {
            "type": "event",
            "threadId": thread_id or "default",
            "turnId": "turn-sse-1",
            "event": {"type": "token_delta", "text": "Hello "},
        }
        yield {
            "type": "event",
            "threadId": thread_id or "default",
            "turnId": "turn-sse-1",
            "event": {"type": "token_delta", "text": "World!"},
        }

    mock_client = AsyncMock()
    mock_client.stream_turn = mock_stream_turn
    session_manager._client = mock_client
    session_manager._clients["default"] = mock_client

    transport = ASGITransport(app=agent_test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/agent/stream", params={"prompt": "say hello"})
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]
        body = resp.text
        assert "data: {" in body
        assert "turn-sse-1" in body
        assert "token_delta" in body


@pytest.mark.asyncio
async def test_agent_steer_and_interrupt_endpoints(agent_test_app):
    """Test POST /api/agent/steer and POST /api/agent/interrupt REST endpoints."""
    mock_client = AsyncMock()
    mock_client.steer_turn = AsyncMock(return_value={"actionId": "act-steer-10"})
    mock_client.interrupt_turn = AsyncMock(return_value={"status": "interrupted"})
    session_manager._client = mock_client
    session_manager._clients["default"] = mock_client

    transport = ASGITransport(app=agent_test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Steer
        steer_resp = await client.post(
            "/api/agent/steer",
            json={"turn_id": "turn-1", "text": "use python instead of bash"},
        )
        assert steer_resp.status_code == 200
        assert steer_resp.json()["status"] == "steered"
        assert steer_resp.json()["action_id"] == "act-steer-10"

        # Interrupt
        interrupt_resp = await client.post(
            "/api/agent/interrupt",
            json={"turn_id": "turn-1"},
        )
        assert interrupt_resp.status_code == 200
        assert interrupt_resp.json()["status"] == "interrupted"
        assert interrupt_resp.json()["turn_id"] == "turn-1"


def test_process_attachments_pipeline(tmp_path):
    """Test _process_attachments Base64 image decoding, file saving, and prompt enrichment."""
    session_manager._current_project_path = tmp_path

    # Create a 1x1 transparent PNG Base64 data URL
    tiny_png_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

    raw_prompt = "Analyze this diagram"
    enriched = _process_attachments(
        raw_prompt,
        images=[tiny_png_b64],
        referenced_files=["src/main.py", "README.md"],
    )

    assert "[User Attached Image: .mini-agent/attachments/" in enriched
    assert "[User Referenced Files: src/main.py, README.md]" in enriched

    # Verify image file was created in attachments directory
    attach_dir = tmp_path / ".mini-agent" / "attachments"
    assert attach_dir.is_dir()
    saved_files = list(attach_dir.glob("*.png"))
    assert len(saved_files) == 1
    assert saved_files[0].stat().st_size > 0


@pytest.mark.asyncio
async def test_approval_respond_http_endpoint(agent_test_app):
    """Test POST /api/approval/respond resolution and 404 validation."""
    # Pre-populate an approval request
    req_id = "req-test-approval-99"
    import asyncio

    fut = asyncio.get_event_loop().create_future()
    session_manager._pending_approvals[req_id] = fut
    session_manager._pending_approval_details[req_id] = {
        "data": {
            "requestId": req_id,
            "toolName": "shell",
            "actionSummary": "Execute command",
            "projectId": "default",
            "access": "project",
            "allowedApprovalModes": ["per_action", "current_project"],
        }
    }

    transport = ASGITransport(app=agent_test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Resolve pending request
        resp = await client.post(
            "/api/approval/respond",
            json={
                "request_id": req_id,
                "decision": "approve",
                "access": "project",
                "approval": "per_action",
                "reason": "Approved by developer",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "resolved"
        assert resp.json()["request_id"] == req_id
        assert resp.json()["decision"] == "approve"

        # 2. Non-existent or already resolved request returns 404
        resp_404 = await client.post(
            "/api/approval/respond",
            json={
                "request_id": "non-existent-id",
                "decision": "deny",
                "access": "project",
                "approval": "per_action",
            },
        )
        assert resp_404.status_code == 404
        assert "not found" in resp_404.json()["detail"]


def test_gateway_websocket_steer_interrupt_actions(agent_test_app):
    """Test WebSocket steer, interrupt, and approval actions over /ws/agent."""
    from starlette.testclient import TestClient

    mock_client = AsyncMock()
    mock_client.steer_turn = AsyncMock(return_value={"actionId": "steer-ws-1"})
    mock_client.interrupt_turn = AsyncMock(return_value={})
    session_manager._client = mock_client
    session_manager._clients["default"] = mock_client

    client = TestClient(agent_test_app)
    with client.websocket_connect("/ws/agent") as ws:
        # 1. Steer with active turn ID
        ws.send_json(
            {
                "action": "steer",
                "turnId": "turn-ws-1",
                "text": "redirect to test",
                "threadId": "default",
            }
        )
        ack = ws.receive_json()
        assert ack.get("type") == "steer_ack"
        assert ack.get("turnId") == "turn-ws-1"

        # 2. Interrupt
        ws.send_json(
            {
                "action": "interrupt",
                "turnId": "turn-ws-1",
                "threadId": "default",
            }
        )
        ack_int = ws.receive_json()
        assert ack_int.get("type") == "interrupt_ack"
        assert ack_int.get("turnId") == "turn-ws-1"

        # 3. Steer with no active turn returns error
        ws.send_json({"action": "steer", "text": "nowhere", "threadId": "default"})
        err = ws.receive_json()
        assert err.get("type") == "error"
        assert "没有正在执行的任务轮次" in err.get("message", "")
