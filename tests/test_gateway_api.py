"""
Automated tests for FastAPI Web Gateway endpoints.
"""

from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

from server.app import create_app
from server.session_manager import session_manager


@pytest.fixture
def test_app():
    return create_app()


@pytest.mark.asyncio
async def test_gateway_health_and_index(test_app):
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Health
        resp = await client.get("/health")
        assert resp.status_code == 200
        assert resp.json().get("status") == "healthy"

        # Index
        resp_index = await client.get("/")
        assert resp_index.status_code == 200


@pytest.mark.asyncio
async def test_gateway_threads_and_workflows(test_app):
    # Initialize background session manager for testing
    await session_manager.start()
    try:
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Threads
            resp = await client.get("/api/threads")
            assert resp.status_code == 200
            assert "threads" in resp.json()

            # Start thread with title
            resp_start = await client.post(
                "/api/threads",
                json={"thread_id": "test-gw-thread", "title": "Custom Test Thread"},
            )
            assert resp_start.status_code == 200
            assert resp_start.json().get("thread_id") == "test-gw-thread"
            assert resp_start.json().get("title") == "Custom Test Thread"

            # Rename thread
            resp_rename = await client.patch(
                "/api/threads/test-gw-thread/rename",
                json={"title": "Renamed Thread Title"},
            )
            assert resp_rename.status_code == 200
            assert (
                resp_rename.json().get("metadata", {}).get("title")
                == "Renamed Thread Title"
            )

            # Update thread summary
            resp_sum = await client.patch(
                "/api/threads/test-gw-thread/summary",
                json={"summary": "Detailed summary of this session"},
            )
            assert resp_sum.status_code == 200
            assert (
                resp_sum.json().get("metadata", {}).get("summary")
                == "Detailed summary of this session"
            )

            # Fork thread
            resp_fork = await client.post(
                "/api/threads/fork",
                json={
                    "source_thread_id": "test-gw-thread",
                    "new_thread_id": "test-gw-forked",
                    "title": "Forked Branch Alpha",
                },
            )
            assert resp_fork.status_code == 200
            assert resp_fork.json().get("thread_id") == "test-gw-forked"
            assert resp_fork.json().get("title") == "Forked Branch Alpha"

            # Read thread
            resp_read = await client.get("/api/threads/test-gw-thread")
            assert resp_read.status_code == 200
            assert resp_read.json().get("thread_id") == "test-gw-thread"
            assert "metadata" in resp_read.json()

            # Thread management is independent from the runtime-bound thread;
            # attach the default runtime before testing Thread settings.
            await session_manager.client.start_thread("default")

            # 2. World & Workflows
            resp_world = await client.get("/api/world/state")
            assert resp_world.status_code == 200
            assert "context" in resp_world.json()

            resp_wf = await client.get("/api/workflows/state")
            assert resp_wf.status_code == 200
            assert resp_wf.json()["collaboration_mode"]["mode"] in ("default", "plan")

            # Toggle Plan Mode
            resp_settings = await client.post(
                "/api/workflows/settings", json={"mode": "plan"}
            )
            assert resp_settings.status_code == 200
            assert resp_settings.json()["collaboration_mode"]["mode"] == "plan"

            # Workflow files
            resp_wffiles = await client.get("/api/workflows/files")
            assert resp_wffiles.status_code == 200
            assert "files" in resp_wffiles.json()

            # Git status
            resp_git = await client.get("/api/world/git/status")
            assert resp_git.status_code == 200
            assert "branch" in resp_git.json()

            # Approvals pending list
            resp_appr = await client.get("/api/approval/pending")
            assert resp_appr.status_code == 200
            assert "pending_requests" in resp_appr.json()

            # 3. Settings
            resp_settings = await client.get("/api/settings")
            assert resp_settings.status_code == 200
            assert "approval_policy" in resp_settings.json()

            resp_set_update = await client.post(
                "/api/settings",
                json={"approval_policy": "auto_approve", "theme": "cyberpunk"},
            )
            assert resp_set_update.status_code == 200
            assert (
                resp_set_update.json().get("settings", {}).get("approval_policy")
                == "auto_approve"
            )

    finally:
        await session_manager.stop()


def test_gateway_websocket(test_app):
    from starlette.testclient import TestClient

    client = TestClient(test_app)
    with client.websocket_connect("/ws/agent") as ws:
        ws.send_json({"action": "ping"})
        data = ws.receive_json()
        assert data.get("type") == "pong"


def test_gateway_websocket_turn_mode_sanitation(test_app):
    from starlette.testclient import TestClient

    captured_modes = []

    async def mock_stream_turn(
        prompt, mode="start", thread_id="default", effort="medium"
    ):
        captured_modes.append(mode)
        yield {
            "type": "_turn_submission",
            "threadId": thread_id,
            "data": {"turn_id": "turn-test-123"},
        }
        yield {
            "type": "event",
            "threadId": thread_id,
            "turnId": "turn-test-123",
            "event": {"type": "turn_started"},
        }
        yield {
            "type": "event",
            "threadId": thread_id,
            "turnId": "turn-test-123",
            "event": {"type": "turn_finished", "stop_reason": "completed"},
        }

    mock_client = AsyncMock()
    mock_client.stream_turn = mock_stream_turn
    session_manager._client = mock_client

    client = TestClient(test_app)
    with client.websocket_connect("/ws/agent") as ws:
        # 1. Send turn without mode (should default to "start")
        ws.send_json({"action": "turn", "prompt": "Hello", "threadId": "t-1"})
        sub = ws.receive_json()
        assert sub.get("type") == "_turn_submission"
        start_evt = ws.receive_json()
        assert start_evt.get("event", {}).get("type") == "turn_started"
        finish_evt = ws.receive_json()
        assert finish_evt.get("event", {}).get("type") == "turn_finished"

        assert len(captured_modes) == 1
        assert captured_modes[0] == "start"

        # 2. Send turn with invalid mode "chat" (should be sanitized to "start")
        ws.send_json(
            {
                "action": "turn",
                "prompt": "Hello again",
                "mode": "chat",
                "threadId": "t-1",
            }
        )
        ws.receive_json()
        ws.receive_json()
        ws.receive_json()

        assert len(captured_modes) == 2
        assert captured_modes[1] == "start"
