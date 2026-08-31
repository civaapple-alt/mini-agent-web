"""
Automated tests for FastAPI Web Gateway endpoints.
"""

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

            # Start thread
            resp_start = await client.post(
                "/api/threads", json={"thread_id": "test-gw-thread"}
            )
            assert resp_start.status_code == 200
            assert resp_start.json().get("thread_id") == "test-gw-thread"

            # Fork thread
            resp_fork = await client.post(
                "/api/threads/fork",
                json={
                    "source_thread_id": "test-gw-thread",
                    "new_thread_id": "test-gw-forked",
                },
            )
            assert resp_fork.status_code == 200
            assert resp_fork.json().get("thread_id") == "test-gw-forked"

            # Read thread
            resp_read = await client.get("/api/threads/test-gw-thread")
            assert resp_read.status_code == 200
            assert resp_read.json().get("thread_id") == "test-gw-thread"

            # 2. World & Workflows
            resp_world = await client.get("/api/world/state")
            assert resp_world.status_code == 200
            assert "context" in resp_world.json()

            resp_wf = await client.get("/api/workflows/state")
            assert resp_wf.status_code == 200
            assert "plan_active" in resp_wf.json()

            # Toggle Plan Mode
            resp_plan = await client.post(
                "/api/workflows/plan", json={"active": True, "prompt": "GW Plan"}
            )
            assert resp_plan.status_code == 200
            assert resp_plan.json().get("plan_active") is True

            # Approvals pending list
            resp_appr = await client.get("/api/approval/pending")
            assert resp_appr.status_code == 200
            assert "pending_requests" in resp_appr.json()

    finally:
        await session_manager.stop()
