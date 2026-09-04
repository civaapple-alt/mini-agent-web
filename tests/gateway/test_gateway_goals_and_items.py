"""
Unit and integration tests for Gateway ThreadItems, Goal control plane,
Session attach/close, and MCP/governance endpoints:
- ThreadItems cursor-bounded pagination (/api/threads/{thread_id}/items)
- Goal lifecycle state machine (/api/threads/{thread_id}/goal: set, get, pause, resume, delete)
- Session attach and multi-process lock detection (/api/threads/{thread_id}/attach)
- Thread close (/api/threads/{thread_id}/close)
- MCP status and retry (/api/mcp/status, /api/mcp/retry)
- Approval revocation (/api/world/approval/revoke)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from mini_agent.types import ThreadItem, ThreadItemEntry, ThreadItemsListResult

from server.app import create_app
from server.session_manager import session_manager


@dataclass
class MockGoalObject:
    thread_id: str
    objective: str
    status: str
    token_budget: int | None = None
    tokens_used: int = 0
    time_used_seconds: int = 0
    created_at: int = 1000
    updated_at: int = 1000


@dataclass
class MockGoalResult:
    goal: MockGoalObject | None = None
    cleared: bool = False


@dataclass
class MockMcpResult:
    enabled_servers: list[str] = field(default_factory=lambda: ["server-fs"])
    inactive_servers: list[str] = field(default_factory=list)
    tool_count: int = 4
    retry_available: bool = False
    diagnostics: list[str] = field(default_factory=list)


@pytest.fixture
def gateway_test_app(tmp_path):
    """Fixture to set up isolated test app with mock session manager state."""
    session_manager._current_project_id = "goals_test_proj"
    session_manager._current_project_path = tmp_path
    session_manager._projects_registry = {
        "goals_test_proj": {
            "id": "goals_test_proj",
            "name": "Goals Test Project",
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
async def test_thread_items_cursor_pagination(gateway_test_app):
    """Test GET /api/threads/{thread_id}/items with cursor-based pagination."""
    item1 = ThreadItemEntry(
        turn_id="turn-1",
        item=ThreadItem(id="item-1", type="userMessage", text="Step 1"),
    )
    item2 = ThreadItemEntry(
        turn_id="turn-1",
        item=ThreadItem(id="item-2", type="assistantMessage", text="Step 2"),
    )

    mock_client = AsyncMock()

    async def mock_list_items(
        thread_id, turn_id=None, cursor=None, limit=None, sort_direction=None
    ):
        if cursor == "cur-next":
            return ThreadItemsListResult(
                data=[item2], next_cursor=None, backwards_cursor="cur-prev"
            )
        return ThreadItemsListResult(
            data=[item1], next_cursor="cur-next", backwards_cursor=None
        )

    mock_client.list_thread_items = mock_list_items
    session_manager._client = mock_client
    session_manager._clients["t-items"] = mock_client

    transport = ASGITransport(app=gateway_test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Page 1
        resp1 = await client.get("/api/threads/t-items/items", params={"limit": 1})
        assert resp1.status_code == 200
        data1 = resp1.json()
        assert data1["thread_id"] == "t-items"
        assert len(data1["data"]) == 1
        assert data1["data"][0]["item"]["id"] == "item-1"
        assert data1["next_cursor"] == "cur-next"

        # Page 2
        resp2 = await client.get(
            "/api/threads/t-items/items", params={"cursor": "cur-next", "limit": 1}
        )
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert len(data2["data"]) == 1
        assert data2["data"][0]["item"]["id"] == "item-2"
        assert data2["next_cursor"] is None
        assert data2["backwards_cursor"] == "cur-prev"


@pytest.mark.asyncio
async def test_goal_lifecycle_full_state_machine(gateway_test_app):
    """Test POST, GET, PAUSE, RESUME, DELETE endpoints for Thread Goals."""
    current_goal = None

    mock_client = AsyncMock()

    async def mock_set_goal(
        objective, status=None, token_budget=None, thread_id="default"
    ):
        nonlocal current_goal
        current_goal = MockGoalObject(
            thread_id=thread_id,
            objective=objective,
            status=status or "active",
            token_budget=token_budget,
        )
        return MockGoalResult(goal=current_goal)

    async def mock_get_goal(thread_id="default"):
        return MockGoalResult(goal=current_goal)

    async def mock_clear_goal(thread_id="default"):
        nonlocal current_goal
        current_goal = None
        return MockGoalResult(cleared=True)

    mock_client.set_goal = mock_set_goal
    mock_client.get_goal = mock_get_goal
    mock_client.clear_goal = mock_clear_goal
    session_manager._client = mock_client
    session_manager._clients["t-goal"] = mock_client

    transport = ASGITransport(app=gateway_test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Set new Goal
        resp_set = await client.post(
            "/api/threads/t-goal/goal",
            json={"objective": "重构网关测试体系", "token_budget": 50000},
        )
        assert resp_set.status_code == 200
        goal_data = resp_set.json()["goal"]
        assert goal_data["objective"] == "重构网关测试体系"
        assert goal_data["status"] == "active"
        assert goal_data["token_budget"] == 50000

        # 2. Get active Goal
        resp_get = await client.get("/api/threads/t-goal/goal")
        assert resp_get.status_code == 200
        assert resp_get.json()["goal"]["objective"] == "重构网关测试体系"

        # 3. Pause Goal
        resp_pause = await client.post("/api/threads/t-goal/goal/pause")
        assert resp_pause.status_code == 200
        assert resp_pause.json()["goal"]["status"] == "paused"

        # 4. Resume Goal
        resp_resume = await client.post("/api/threads/t-goal/goal/resume")
        assert resp_resume.status_code == 200
        assert resp_resume.json()["goal"]["status"] == "active"

        # 5. Clear Goal
        resp_del = await client.delete("/api/threads/t-goal/goal")
        assert resp_del.status_code == 200
        assert resp_del.json()["cleared"] is True

        # Verify Goal is cleared
        resp_check = await client.get("/api/threads/t-goal/goal")
        assert resp_check.status_code == 200
        assert resp_check.json()["goal"] is None


@pytest.mark.asyncio
async def test_thread_attach_locked_and_resumable(gateway_test_app, monkeypatch):
    """Test POST /api/threads/{thread_id}/attach handling of locked and unlocked sessions."""

    # Mock read_any_project_thread for locked scenario
    def mock_read_locked(thread_id):
        if thread_id == "t-locked":
            return {
                "session": {
                    "project_id": "goals_test_proj",
                    "session_id": "s-locked-123",
                    "session_status": "locked",
                    "runtime_status": "active",
                    "locked_by": 54321,
                }
            }
        return None

    monkeypatch.setattr(session_manager, "read_any_project_thread", mock_read_locked)

    mock_client = AsyncMock()
    session_manager._client = mock_client
    session_manager._clients["t-free"] = mock_client

    transport = ASGITransport(app=gateway_test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Attach to locked thread returns attached=False and metadata without stealing lock
        resp_locked = await client.post("/api/threads/t-locked/attach")
        assert resp_locked.status_code == 200
        locked_data = resp_locked.json()
        assert locked_data["attached"] is False
        assert locked_data["session_status"] == "locked"
        assert locked_data["locked_by"] == 54321

        # 2. Attach to free thread succeeds with attached=True
        resp_free = await client.post("/api/threads/t-free/attach")
        assert resp_free.status_code == 200
        assert resp_free.json()["attached"] is True


@pytest.mark.asyncio
async def test_thread_close_endpoint(gateway_test_app):
    """Test POST /api/threads/{thread_id}/close releases active thread resources."""
    mock_client = AsyncMock()
    mock_client.close_thread = AsyncMock(return_value=True)
    session_manager._client = mock_client
    session_manager._clients["t-close-target"] = mock_client

    transport = ASGITransport(app=gateway_test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/threads/t-close-target/close")
        assert resp.status_code == 200
        data = resp.json()
        assert data["thread_id"] == "t-close-target"
        assert data["closed"] is True
        mock_client.close_thread.assert_awaited_with("t-close-target")


@pytest.mark.asyncio
async def test_mcp_and_world_governance(gateway_test_app):
    """Test MCP status/retry and approval revocation endpoints."""
    mock_client = AsyncMock()
    mock_client.get_mcp_status = AsyncMock(
        return_value=MockMcpResult(enabled_servers=["fs-server"], tool_count=5)
    )
    mock_client.retry_mcp = AsyncMock(
        return_value=MockMcpResult(enabled_servers=["fs-server"], retry_available=False)
    )
    session_manager._client = mock_client

    # Add dummy approval grant to verify revoke
    session_manager._project_approval_grants.add(("default", "shell"))

    transport = ASGITransport(app=gateway_test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # MCP status
        resp_mcp = await client.get("/api/mcp/status")
        assert resp_mcp.status_code == 200
        assert resp_mcp.json()["enabled_servers"] == ["fs-server"]
        assert resp_mcp.json()["tool_count"] == 5

        # MCP retry
        resp_retry = await client.post("/api/mcp/retry")
        assert resp_retry.status_code == 200
        assert resp_retry.json()["enabled_servers"] == ["fs-server"]

        # Revoke project approvals
        resp_revoke = await client.post("/api/world/approval/revoke")
        assert resp_revoke.status_code == 200
        assert resp_revoke.json()["revoked"] is True
        assert resp_revoke.json()["project_id"] == "goals_test_proj"
        assert len(session_manager._project_approval_grants) == 0
