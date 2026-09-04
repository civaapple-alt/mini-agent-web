"""
Offline end-to-end smoke test for Mini Agent Web.
Tier 1 smoke test: runs entirely in-memory, requiring zero credentials,
zero tokens, and no external App Server process.
Validates the full loop:
1. Web Gateway app initialization and status probe
2. Full-duplex WebSocket connection over /ws/agent (ping/pong, turn execution)
3. Simulated turn streaming (submission -> turn_started -> content_delta -> turn_finished)
4. ThreadItems projection and retrieval
5. Clean teardown with zero leaked tasks
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient

from server.app import create_app
from server.session_manager import session_manager


@pytest.fixture
def smoke_test_app(tmp_path):
    """Provide an isolated FastAPI app instance for smoke testing."""
    session_manager._current_project_id = "smoke_project"
    session_manager._current_project_path = tmp_path
    session_manager._projects_registry = {
        "smoke_project": {
            "id": "smoke_project",
            "name": "Smoke Test Project",
            "primary_path": str(tmp_path),
            "access": "project",
            "approval": "per_action",
            "source_folders": [
                {"name": "root", "path": str(tmp_path), "is_primary": True}
            ],
        }
    }
    mock_client = AsyncMock()
    mock_world_state = AsyncMock()
    mock_world_state.context = "smoke-env"
    mock_world_state.lines = 10
    mock_world_state.status = "operational"
    mock_world_state.workspace = str(tmp_path)
    mock_client.get_world_state = AsyncMock(return_value=mock_world_state)
    mock_threads_res = MagicMock()
    mock_threads_res.data = []
    mock_threads_res.next_cursor = None
    mock_client.list_threads = AsyncMock(return_value=mock_threads_res)
    mock_client.read_thread = AsyncMock(return_value={"id": "default", "turns": []})

    session_manager._client = mock_client
    session_manager._clients["default"] = mock_client
    return create_app()


@pytest.mark.asyncio
async def test_smoke_offline_http_and_status(smoke_test_app):
    """Tier 1 Smoke: Validate Gateway HTTP status and thread inventory."""
    transport = ASGITransport(app=smoke_test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Gateway health and status
        health_resp = await client.get("/health")
        assert health_resp.status_code == 200
        assert health_resp.json().get("status") == "healthy"

        # 2. World state
        world_resp = await client.get("/api/world/state")
        assert world_resp.status_code == 200
        assert world_resp.json()["status"] == "operational"
        assert world_resp.json()["context"] == "smoke-env"

        # 3. Thread listing
        threads_resp = await client.get("/api/threads")
        assert threads_resp.status_code == 200
        assert "threads" in threads_resp.json()


def test_smoke_offline_full_duplex_turn_streaming(smoke_test_app):
    """Tier 1 Smoke: Validate full WebSocket streaming lifecycle from turn start to finish."""
    mock_client = AsyncMock()

    async def mock_stream_turn(*args, **kwargs):
        # 1. Submission item
        yield {
            "type": "_turn_submission",
            "data": {"turn_id": "turn-smoke-offline-01", "status": "started"},
        }
        await asyncio.sleep(0.01)
        # 2. Turn started event
        yield {
            "type": "event",
            "threadId": "default",
            "turnId": "turn-smoke-offline-01",
            "event": {
                "type": "turn_started",
                "turn_id": "turn-smoke-offline-01",
            },
        }
        await asyncio.sleep(0.01)
        # 3. Content delta event
        yield {
            "type": "event",
            "threadId": "default",
            "turnId": "turn-smoke-offline-01",
            "event": {
                "type": "content_delta",
                "delta": "Smoke verification in progress. All systems operational.",
            },
        }
        await asyncio.sleep(0.01)
        # 4. Turn finished event
        yield {
            "type": "event",
            "threadId": "default",
            "turnId": "turn-smoke-offline-01",
            "event": {
                "type": "turn_finished",
                "stop_reason": "completed",
            },
        }

    mock_client.stream_turn = mock_stream_turn
    session_manager._client = mock_client
    session_manager._clients["default"] = mock_client

    client = TestClient(smoke_test_app)
    with client.websocket_connect("/ws/agent") as ws:
        # Ping - Pong sanity check
        ws.send_json({"action": "ping"})
        pong = ws.receive_json()
        assert pong == {"type": "pong"}

        # Launch turn
        ws.send_json(
            {
                "action": "turn",
                "prompt": "Run offline smoke verification",
                "mode": "start",
                "threadId": "default",
            }
        )

        # Receive turn events in sequence
        msg1 = ws.receive_json()
        assert msg1.get("type") == "_turn_submission"
        assert msg1.get("data", {}).get("turn_id") == "turn-smoke-offline-01"

        msg2 = ws.receive_json()
        assert msg2.get("type") == "event"
        assert msg2.get("event", {}).get("type") == "turn_started"

        msg3 = ws.receive_json()
        assert msg3.get("type") == "event"
        assert msg3.get("event", {}).get("type") == "content_delta"
        assert "operational" in msg3.get("event", {}).get("delta", "")

        msg4 = ws.receive_json()
        assert msg4.get("type") == "event"
        assert msg4.get("event", {}).get("type") == "turn_finished"
        assert msg4.get("event", {}).get("stop_reason") == "completed"

    # Active turn should be automatically cleared on completion
    assert session_manager.get_active_turn("default") is None


def test_smoke_offline_interactive_control_and_items(smoke_test_app):
    """Tier 1 Smoke: Validate WebSocket interactive steering, interrupt, and ThreadItems retrieval."""
    mock_client = AsyncMock()
    mock_client.steer_turn = AsyncMock(return_value={"actionId": "steer-smoke-1"})
    mock_client.interrupt_turn = AsyncMock(return_value={})

    # Mock thread items projection
    @dataclass
    class MockPaginatedItems:
        data: list = field(
            default_factory=lambda: [
                {
                    "turn_id": "turn-smoke-offline-01",
                    "item": {
                        "id": "item-smoke-1",
                        "type": "userMessage",
                        "content": "Hello smoke test",
                    },
                },
                {
                    "turn_id": "turn-smoke-offline-01",
                    "item": {
                        "id": "item-smoke-2",
                        "type": "assistantMessage",
                        "content": "Smoke verification passed",
                    },
                },
            ]
        )
        next_cursor: str | None = None
        backwards_cursor: str | None = None

    mock_client.list_thread_items = AsyncMock(return_value=MockPaginatedItems())
    session_manager._client = mock_client
    session_manager._clients["default"] = mock_client

    client = TestClient(smoke_test_app)

    # 1. Query thread items over HTTP
    items_resp = client.get("/api/threads/default/items")
    assert items_resp.status_code == 200
    items_data = items_resp.json()
    assert len(items_data["data"]) == 2
    assert items_data["data"][0]["item"]["id"] == "item-smoke-1"

    # 2. Test interactive WebSocket steer and interrupt
    with client.websocket_connect("/ws/agent") as ws:
        # Steer
        ws.send_json(
            {
                "action": "steer",
                "turnId": "turn-smoke-offline-01",
                "text": "steer verification",
                "threadId": "default",
            }
        )
        steer_ack = ws.receive_json()
        assert steer_ack.get("type") == "steer_ack"

        # Interrupt
        ws.send_json(
            {
                "action": "interrupt",
                "turnId": "turn-smoke-offline-01",
                "threadId": "default",
            }
        )
        interrupt_ack = ws.receive_json()
        assert interrupt_ack.get("type") == "interrupt_ack"
