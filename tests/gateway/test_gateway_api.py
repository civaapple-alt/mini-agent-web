"""
Automated tests for FastAPI Web Gateway endpoints.
"""

from types import SimpleNamespace
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
async def test_gateway_lists_catalog_when_runtime_is_read_only(test_app):
    """The sidebar remains usable when the canonical Session is externally locked."""
    previous_client = session_manager._client
    session_manager._client = None
    try:
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/threads")

        assert response.status_code == 200
        assert "threads" in response.json()
    finally:
        session_manager._client = previous_client


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
            assert "available_builtin_tools" in resp_wf.json()
            assert "builtin_tools" in resp_wf.json()
            assert resp_wf.json()["builtin_tools"] == [
                "read_file",
                "apply_patch",
                "shell",
                "read_image",
            ]
            assert resp_wf.json()["available_builtin_tools"] == [
                "read_file",
                "apply_patch",
                "shell",
                "read_image",
                "web_fetch",
            ]

            # Toggle Plan Mode and filter Builtin tools
            resp_settings = await client.post(
                "/api/threads/default/settings",
                json={
                    "mode": "plan",
                    "builtin_tools": ["read_file", "shell"],
                },
            )
            assert resp_settings.status_code == 200
            assert resp_settings.json()["collaboration_mode"]["mode"] == "plan"
            assert "available_builtin_tools" in resp_settings.json()
            assert "builtin_tools" in resp_settings.json()

            empty_settings = await client.post(
                "/api/threads/default/settings",
                json={
                    "mode": "plan",
                    "builtin_tools": [],
                },
            )
            assert empty_settings.status_code == 200
            assert empty_settings.json()["builtin_tools"] == []
            empty_state = await client.get("/api/workflows/state")
            assert empty_state.json()["builtin_tools"] == []

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
            assert resp_settings.json()["access"] == "project"
            assert resp_settings.json()["policy"] == "interactive"

            resp_set_update = await client.post(
                "/api/settings",
                json={"theme": "cyberpunk"},
            )
            assert resp_set_update.status_code == 200
            assert (
                resp_set_update.json().get("settings", {}).get("theme") == "cyberpunk"
            )

            resp_execution = await client.post(
                "/api/world/execution",
                json={"access": "full_machine", "policy": "automatic"},
            )
            assert resp_execution.status_code == 200
            assert resp_execution.json()["access"] == "full_machine"
            assert resp_execution.json()["policy"] == "automatic"

    finally:
        await session_manager.stop()


@pytest.mark.asyncio
async def test_execution_policy_change_does_not_restart_runtime(test_app, monkeypatch):
    """Changing execution policy must leave active runtime streams untouched."""
    client_mock = AsyncMock()
    client_mock.set_world_execution.return_value = SimpleNamespace(
        changed=True,
        state={"access": "project", "policy": "automatic"},
    )
    restart = AsyncMock()
    monkeypatch.setattr(
        session_manager,
        "get_client_for_project",
        AsyncMock(return_value=client_mock),
    )
    monkeypatch.setattr(
        session_manager,
        "project_execution",
        lambda _project_id=None: ("project", "interactive"),
    )
    monkeypatch.setattr(session_manager, "set_project_execution", lambda *args: None)
    monkeypatch.setattr(session_manager, "restart_for_current_project", restart)

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/world/execution",
            json={
                "access": "project",
                "policy": "automatic",
                "project_id": "project-1",
            },
        )

    assert response.status_code == 200
    assert response.json()["policy"] == "automatic"
    client_mock.set_world_execution.assert_awaited_once_with(
        access="project", policy="automatic"
    )
    restart.assert_not_awaited()


@pytest.mark.asyncio
async def test_project_switch_keeps_existing_runtime_tasks(test_app, monkeypatch):
    """Switching the UI project must not invoke the project restart path."""
    project = {"id": "project-2", "name": "Project 2", "primary_path": "C:/project-2"}

    def switch(path):
        assert path == project["primary_path"]
        return project

    start = AsyncMock()
    restart = AsyncMock()
    monkeypatch.setattr(session_manager, "switch_project", switch)
    monkeypatch.setattr(session_manager, "start", start)
    monkeypatch.setattr(session_manager, "restart_for_current_project", restart)

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/projects/switch",
            json={"path": project["primary_path"]},
        )

    assert response.status_code == 200
    assert response.json() == {"project": project, "status": "switched"}
    start.assert_awaited_once_with()
    restart.assert_not_awaited()


@pytest.mark.asyncio
async def test_workflow_state_and_goal_artifacts_use_canonical_session(
    test_app, tmp_path, monkeypatch
):
    """Goal state and verifier Markdown remain readable when live RPC is unavailable."""
    session_dir = tmp_path / "s-goal"
    (session_dir / "plan").mkdir(parents=True)
    (session_dir / "goal").mkdir(parents=True)
    (session_dir / "plan" / "plan.md").write_text(
        "# Session Plan\n\n- [ ] Inspect the workspace\n", encoding="utf-8"
    )
    (session_dir / "goal" / "plan.md").write_text(
        "# Goal Plan\n\n- [ ] Verify the fix\n", encoding="utf-8"
    )
    (session_dir / "goal" / "verifier_verdict.md").write_text(
        "# Goal Verification\n\n- Status: running\n", encoding="utf-8"
    )
    (session_dir / "goal" / "state.json").write_text("{}", encoding="utf-8")
    canonical = {
        "session": {
            "goal": {
                "thread_id": "t-goal-artifacts",
                "objective": "make verification observable",
                "status": "active",
                "verification_status": "running",
                "current_milestone": 1,
                "total_milestones": 3,
                "loop_count": 0,
            },
            "plan_active": False,
            "continuation_mode": "manual",
            "state_revision": 12,
            "session_status": "locked",
            "runtime_status": "running",
        }
    }
    monkeypatch.setattr(
        session_manager, "read_any_project_thread", lambda _thread_id: canonical
    )
    monkeypatch.setattr(
        session_manager, "session_path_for_thread", lambda _thread_id: session_dir
    )
    monkeypatch.setattr(session_manager, "_current_project_path", tmp_path)

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        state = await client.get(
            "/api/workflows/state", params={"thread_id": "t-goal-artifacts"}
        )
        assert state.status_code == 200
        assert state.json()["goal"]["verification_status"] == "running"

        files = await client.get(
            "/api/workflows/files", params={"thread_id": "t-goal-artifacts"}
        )
        assert files.status_code == 200
        assert {item["path"] for item in files.json()["files"]} >= {
            "plan/plan.md",
            "goal/plan.md",
            "goal/verifier_verdict.md",
        }

        plan_content = await client.get(
            "/api/workflows/file/content",
            params={"path": "plan/plan.md", "thread_id": "t-goal-artifacts"},
        )
        assert plan_content.status_code == 200
        assert "Inspect the workspace" in plan_content.json()["content"]

        content = await client.get(
            "/api/workflows/file/content",
            params={
                "path": "goal/verifier_verdict.md",
                "thread_id": "t-goal-artifacts",
            },
        )
        assert content.status_code == 200
        assert "Status: running" in content.json()["content"]


@pytest.mark.asyncio
async def test_runtime_observation_routes_expose_snapshot_and_replay(
    test_app, monkeypatch
):
    client_mock = AsyncMock()
    client_mock.get_runtime_status.return_value = SimpleNamespace(
        phase="goal_verification",
        thread_id="t-observe",
        turn_id="turn-2",
        operation_id="goal-verification:g-1:9",
        checkpoint_seq=9,
        state_revision=12,
        timestamp_ms=1234,
        error=None,
    )
    client_mock.replay_events.return_value = SimpleNamespace(
        data=[
            {"threadId": "t-observe", "sequence": 5, "event": {"type": "run_started"}}
        ],
        next_cursor=5,
        oldest_sequence=1,
        has_gap=False,
    )
    monkeypatch.setattr(
        session_manager,
        "get_client_for_thread",
        AsyncMock(return_value=client_mock),
    )

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        status = await client.get("/api/threads/t-observe/runtime/status")
        replay = await client.get(
            "/api/threads/t-observe/events",
            params={"after_sequence": 4, "limit": 2},
        )

    assert status.status_code == 200
    assert status.json()["phase"] == "goal_verification"
    assert status.json()["operation_id"] == "goal-verification:g-1:9"
    assert replay.status_code == 200
    assert replay.json()["next_cursor"] == 5
    assert replay.json()["data"][0]["sequence"] == 5
    client_mock.get_runtime_status.assert_awaited_once_with("t-observe")
    client_mock.replay_events.assert_awaited_once_with(
        thread_id="t-observe", after_sequence=4, limit=2
    )


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
        event = {
            "type": "event",
            "threadId": thread_id,
            "turnId": "turn-test-123",
            "event": {"type": "turn_started"},
        }
        await session_manager._handle_runtime_notification(event)
        event = {
            "type": "event",
            "threadId": thread_id,
            "turnId": "turn-test-123",
            "event": {"type": "turn_finished", "stop_reason": "completed"},
        }
        await session_manager._handle_runtime_notification(event)
        yield event

    mock_client = AsyncMock()
    mock_client.stream_turn = mock_stream_turn
    session_manager._client = mock_client
    session_manager._clients["t-1"] = mock_client

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


@pytest.mark.asyncio
async def test_gateway_history_uses_canonical_session_store(test_app):
    """Verify history reads the App Server and never rehydrates Web checkpoints."""
    from mini_agent.types import ThreadCheckpoint

    session_manager.set_thread_meta("test-persisted", {"title": "Persisted Session"})

    # Setup mock client that initially reports empty thread or unknown thread
    mock_client = AsyncMock()
    empty_cp = ThreadCheckpoint(
        thread_id="test-persisted",
        messages=[],
        status="idle",
        next_turn_number=1,
    )
    mock_client.read_thread = AsyncMock(return_value=empty_cp)
    mock_client.resume_thread = AsyncMock()
    session_manager._client = mock_client
    session_manager._clients["test-persisted"] = mock_client

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/threads/test-persisted")
        assert resp.status_code == 200
        data = resp.json()
        assert data["thread_id"] == "test-persisted"
        assert data["messages"] == []
        mock_client.resume_thread.assert_not_awaited()
