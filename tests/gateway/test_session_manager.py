"""
Unit and integration tests for SessionManager state, approvals, and projects.
"""

import asyncio
import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from server.control import client_pool as client_pool_module
from server.session_catalog import SessionCatalog
from server.session_manager import SessionManager


@pytest.fixture
def mock_session_manager(tmp_path):
    """Create an isolated SessionManager instance using tmp_path for storage."""
    mgr = SessionManager()
    mgr._state_dir = tmp_path
    mgr._current_project_id = "default"
    mgr._current_project_path = tmp_path
    mgr._projects_registry = {
        "default": {
            "id": "default",
            "name": "Default Project",
            "primary_path": str(tmp_path),
            "access": "project",
            "policy": "interactive",
            "source_folders": [
                {"name": "default", "path": str(tmp_path), "is_primary": True}
            ],
        }
    }
    return mgr


def test_session_manager_project_collision_avoidance(mock_session_manager, tmp_path):
    """Ensure project creation handles duplicate names by appending incremental suffixes."""
    p1 = mock_session_manager.create_project("Alpha Project", path=str(tmp_path / "f1"))
    assert p1["id"] == "alpha-project"

    p2 = mock_session_manager.create_project("Alpha Project", path=str(tmp_path / "f2"))
    assert p2["id"] == "alpha-project-1"

    p3 = mock_session_manager.create_project("Alpha Project", path=str(tmp_path / "f3"))
    assert p3["id"] == "alpha-project-2"

    projects_list = mock_session_manager.get_projects()
    ids = [p["id"] for p in projects_list["projects"]]
    assert "alpha-project" in ids
    assert "alpha-project-1" in ids
    assert "alpha-project-2" in ids


def test_thread_attachment_root_is_gateway_state_and_project_scoped(
    mock_session_manager, tmp_path
):
    """Uploaded files stay outside the workspace and differ by Project/Thread."""
    state_dir = tmp_path / "gateway-state"
    mock_session_manager._state_dir = state_dir
    project_root = tmp_path / "project"
    project_root.mkdir()
    mock_session_manager._current_project_path = project_root
    mock_session_manager._projects_registry["default"]["primary_path"] = str(
        project_root
    )
    mock_session_manager._projects_registry["default"]["source_folders"] = [
        {"name": "default", "path": str(project_root), "is_primary": True}
    ]

    first = mock_session_manager.attachments_path_for_thread("thread-a", "default")
    second = mock_session_manager.attachments_path_for_thread("thread-b", "default")

    assert first.parent == second.parent
    assert first != second
    assert first.is_relative_to(state_dir)
    assert not first.is_relative_to(project_root)


def test_thread_attachment_root_rejects_state_inside_project(mock_session_manager):
    """A misconfigured state directory must never cause workspace writes."""
    project_root = mock_session_manager._current_project_path
    mock_session_manager._state_dir = project_root / "state"

    with pytest.raises(RuntimeError, match="must not be inside a Project workspace"):
        mock_session_manager.attachments_path_for_thread("thread-a", "default")


@pytest.mark.asyncio
async def test_client_runtime_receives_only_thread_attachment_root(
    mock_session_manager, tmp_path, monkeypatch
):
    """New runtimes can read their Thread uploads without widening workspace access."""
    state_dir = tmp_path.parent / f"{tmp_path.name}-gateway-state"
    mock_session_manager._state_dir = state_dir
    project = mock_session_manager._projects_registry["default"]
    captured: dict[str, object] = {}

    class FakeClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def __aenter__(self):
            return self

        async def initialize(self):
            return {"serverName": "fake", "serverVersion": "test"}

        async def set_world_execution(self, **kwargs):
            return None

        async def start_thread(self, thread_id):
            return None

        async def stop(self):
            return None

    monkeypatch.setattr(client_pool_module, "MiniAgentClient", FakeClient)
    monkeypatch.setattr(
        mock_session_manager,
        "_apply_persisted_thread_continuation",
        AsyncMock(),
    )

    await mock_session_manager._client_pool.create_client("thread-a", project, "new")

    attachment_root = str(
        mock_session_manager.attachments_path_for_thread(
            "thread-a", "default"
        ).resolve()
    )
    read_roots = captured["env"]["MINI_AGENT_EXTRA_READ_ROOTS"].split(os.pathsep)
    assert attachment_root in read_roots
    assert not Path(attachment_root).is_relative_to(Path(project["primary_path"]))


@pytest.mark.asyncio
async def test_session_manager_approval_is_typed_and_not_web_persisted(
    mock_session_manager,
):
    req_payload = {
        "requestId": "req-123",
        "actionSummary": "shell:run_command",
        "toolName": "shell",
        "actionClass": "shell_execute",
        "access": "project",
        "allowedGrantScopes": ["once", "project"],
        "projectId": "default",
        "workspaceId": "workspace-1",
        "workspaceRevision": 7,
        "pathScope": {"kind": "project", "paths": ["src"]},
        "threadId": "thread-1",
        "turnId": "turn-1",
        "callId": "call-1",
    }

    # 1. First approval request creates a pending future
    task = asyncio.create_task(
        mock_session_manager._handle_approval_request(req_payload)
    )
    await asyncio.sleep(0.01)

    assert len(mock_session_manager._pending_approvals) == 1
    assert "req-123" in mock_session_manager._pending_approvals
    assert (
        mock_session_manager._pending_approval_details["req-123"]["data"] == req_payload
    )

    # 2. Resolve approval with a typed project-scoped decision
    resolved = mock_session_manager.resolve_approval(
        request_id="req-123",
        decision="approve",
        grant_scope="project",
        reason="User approved permanently",
    )
    assert resolved is True
    assert (
        mock_session_manager.resolve_approval(
            request_id="req-123",
            decision="deny",
            grant_scope=None,
        )
        is False
    )

    result = await task
    assert result.get("decision") == "approve"
    assert result.get("grantScope") == "project"
    assert not hasattr(mock_session_manager, "_project_approval_grants")
    assert not hasattr(mock_session_manager, "_session_approval_grants")

    # A second request is still relayed; Host/Capabilities owns grant reuse.
    second_payload = {**req_payload, "requestId": "req-456"}
    second_task = asyncio.create_task(
        mock_session_manager._handle_approval_request(second_payload)
    )
    await asyncio.sleep(0.01)
    assert mock_session_manager.list_pending_approvals() == ["req-456"]
    mock_session_manager.resolve_approval("req-456", "deny", None)
    await second_task


@pytest.mark.asyncio
async def test_duplicate_provider_request_ids_are_resolved_by_call_identity(
    mock_session_manager,
):
    """A reused provider request ID cannot overwrite another tool wait."""
    base = {
        "requestId": "approval-reused",
        "actionSummary": "shell command",
        "toolName": "shell",
        "access": "project",
        "allowedGrantScopes": ["once"],
        "projectId": "default",
        "threadId": "thread-reused",
        "turnId": "turn-reused",
    }
    first_task = asyncio.create_task(
        mock_session_manager._handle_approval_request({**base, "callId": "call-first"})
    )
    second_task = asyncio.create_task(
        mock_session_manager._handle_approval_request({**base, "callId": "call-second"})
    )
    await asyncio.sleep(0.01)

    assert len(mock_session_manager._pending_approvals) == 2
    assert mock_session_manager.list_pending_approvals() == [
        "approval-reused",
        "approval-reused",
    ]
    assert mock_session_manager.resolve_approval(
        "approval-reused", "approve", "once", call_id="call-first"
    )
    assert not mock_session_manager.resolve_approval("approval-reused", "deny", None), (
        "request-id-only responses must be rejected while the ID is ambiguous"
    )
    assert mock_session_manager.resolve_approval(
        "approval-reused", "deny", None, call_id="call-second"
    )

    assert (await first_task)["decision"] == "approve"
    assert (await second_task)["decision"] == "deny"


@pytest.mark.asyncio
async def test_websocket_broadcast_is_project_scoped(mock_session_manager):
    """Runtime notifications do not cross project-bound WebSocket clients."""

    class FakeSocket:
        def __init__(self):
            self.send_json = AsyncMock()

    pi_socket = FakeSocket()
    web_socket = FakeSocket()
    global_socket = FakeSocket()
    mock_session_manager._active_connections = {
        pi_socket: "pi",
        web_socket: "mini-agent-web",
        global_socket: None,
    }

    await mock_session_manager.broadcast_ws(
        {"type": "event", "projectId": "pi", "threadId": "default"}
    )

    pi_socket.send_json.assert_awaited_once()
    web_socket.send_json.assert_not_awaited()
    global_socket.send_json.assert_awaited_once()


@pytest.mark.asyncio
async def test_accepted_approval_resolution_reaches_all_same_project_clients(
    mock_session_manager,
):
    """An accepted decision closes stale approval docks in peer browsers."""

    class FakeSocket:
        def __init__(self):
            self.send_json = AsyncMock()

    same_project_a = FakeSocket()
    same_project_b = FakeSocket()
    other_project = FakeSocket()
    mock_session_manager._active_connections = {
        same_project_a: "project-1",
        same_project_b: "project-1",
        other_project: "project-2",
    }
    request_id = "approval-peer-resolution"
    fut = asyncio.get_running_loop().create_future()
    mock_session_manager._pending_approvals[request_id] = fut
    mock_session_manager._pending_approval_details[request_id] = {
        "data": {
            "requestId": request_id,
            "actionSummary": "Run workspace command",
            "allowedGrantScopes": ["once"],
        },
        "projectId": "project-1",
        "threadId": "thread-1",
        "turnId": "turn-1",
    }

    assert mock_session_manager.resolve_approval(request_id, "approve", "once")
    assert await mock_session_manager.broadcast_approval_resolution(
        request_id, "approve", "once", "approved by peer"
    )

    for socket in (same_project_a, same_project_b):
        socket.send_json.assert_awaited_once()
        payload = socket.send_json.await_args.args[0]
        assert payload["type"] == "approval"
        assert payload["approval"]["phase"] == "resolved"
        assert payload["approval"]["requestId"] == request_id
        assert payload["approval"]["decision"] == "approve"
        assert payload["projectId"] == "project-1"
        assert payload["threadId"] == "thread-1"
        assert payload["turnId"] == "turn-1"
    other_project.send_json.assert_not_awaited()
    mock_session_manager._active_connections.clear()
    await fut


def test_session_manager_settings_persistence(mock_session_manager, tmp_path):
    """Ensure UI settings and Project execution settings persist separately."""
    assert mock_session_manager.get_settings()["reasoning_effort"] == "high"
    mock_session_manager.set_project_execution("full_machine", "automatic")
    mock_session_manager.update_settings(
        {"reasoning_effort": "low", "auto_scroll": False}
    )

    assert mock_session_manager.project_execution() == (
        "full_machine",
        "automatic",
    )
    assert mock_session_manager.get_settings()["access"] == "full_machine"
    assert mock_session_manager.get_settings()["policy"] == "automatic"
    assert mock_session_manager._settings["reasoning_effort"] == "low"
    assert mock_session_manager._settings["auto_scroll"] is False

    # Create new manager loading from same state dir
    new_mgr = SessionManager()
    new_mgr._state_dir = tmp_path
    new_mgr._load_state()

    assert new_mgr.get_settings()["access"] == "full_machine"
    assert new_mgr._settings["reasoning_effort"] == "low"
    assert new_mgr._settings["auto_scroll"] is False


@pytest.mark.asyncio
async def test_continuation_preference_waits_for_goal_runtime_to_settle(
    mock_session_manager, monkeypatch
):
    """An active Goal owns execution; the Web preference resumes afterward."""
    canonical = {
        "session": {
            "goal": {"status": "active"},
            "plan_active": False,
            "continuation_mode": "continuous",
        }
    }
    monkeypatch.setattr(
        mock_session_manager,
        "read_any_project_thread",
        lambda thread_id: canonical,
    )
    client = AsyncMock()

    assert (
        await mock_session_manager._apply_persisted_thread_continuation(
            "goal-thread", client
        )
        is False
    )
    client.update_thread_settings.assert_not_awaited()

    canonical["session"]["goal"]["status"] = "completed"
    assert (
        await mock_session_manager._apply_persisted_thread_continuation(
            "goal-thread", client
        )
        is True
    )
    client.update_thread_settings.assert_awaited_once_with(
        mode="default", continuation_mode="continuous", thread_id="goal-thread"
    )


@pytest.mark.asyncio
async def test_goal_settlement_notification_restores_continuous_preference(
    mock_session_manager, monkeypatch
):
    """A settled Goal releases the runtime and restores the Web preference."""
    monkeypatch.setattr(
        mock_session_manager,
        "read_any_project_thread",
        lambda thread_id: {
            "session": {
                "plan_active": False,
                "continuation_mode": "continuous",
            }
        },
    )
    client = AsyncMock()
    mock_session_manager._clients["goal-thread"] = client

    await mock_session_manager._handle_runtime_notification(
        {
            "method": "thread/goal/updated",
            "data": {
                "threadId": "goal-thread",
                "goal": {"status": "completed"},
            },
        }
    )

    client.update_thread_settings.assert_awaited_once_with(
        mode="default", continuation_mode="continuous", thread_id="goal-thread"
    )


@pytest.mark.asyncio
async def test_runtime_notifications_are_broadcast_to_all_websocket_clients(
    mock_session_manager,
):
    mock_session_manager.broadcast_ws = AsyncMock()
    notification = {
        "type": "notification",
        "method": "goal/verification_started",
        "data": {"threadId": "goal-thread", "operationId": "verify:1"},
    }

    await mock_session_manager._handle_runtime_notification(notification)

    mock_session_manager.broadcast_ws.assert_awaited_once_with(notification)


def test_approval_snapshot_exposes_policy_without_web_grants(mock_session_manager):
    mock_session_manager.set_project_execution("full_machine", "automatic")

    snapshot = mock_session_manager.approval_snapshot()

    assert snapshot["project_id"] == "default"
    assert snapshot["access"] == "full_machine"
    assert snapshot["policy"] == "automatic"
    assert snapshot["grant_store"] == "host-capabilities"
    assert "project_grant_count" not in snapshot
    assert "session_grant_count" not in snapshot
    assert snapshot["pending_requests"] == []


@pytest.mark.asyncio
async def test_project_execution_updates_all_live_clients_in_project(
    mock_session_manager, tmp_path
):
    """Project execution changes fan out without touching another Project."""
    other_root = tmp_path / "other-project"
    other_root.mkdir()
    mock_session_manager._projects_registry["other-project"] = {
        "id": "other-project",
        "name": "Other Project",
        "primary_path": str(other_root),
    }
    default_client = AsyncMock()
    worker_client = AsyncMock()
    other_project_client = AsyncMock()
    for client in (default_client, worker_client, other_project_client):
        client.set_world_execution.return_value = SimpleNamespace(
            changed=True, state={"access": "full_machine", "policy": "trusted"}
        )
    mock_session_manager._project_clients.update(
        {
            ("default", "default"): default_client,
            ("default", "worker"): worker_client,
            ("other-project", "default"): other_project_client,
        }
    )
    mock_session_manager._clients.update(
        {"default": default_client, "worker": worker_client}
    )
    mock_session_manager._client_projects.update(
        {"default": "default", "worker": "default"}
    )

    result = await mock_session_manager.update_project_execution(
        "full_machine", "trusted", "default", primary_client=default_client
    )

    assert result.changed is True
    default_client.set_world_execution.assert_awaited_once_with(
        access="full_machine", policy="trusted"
    )
    worker_client.set_world_execution.assert_awaited_once_with(
        access="full_machine", policy="trusted"
    )
    other_project_client.set_world_execution.assert_not_awaited()
    assert mock_session_manager.project_execution("default") == (
        "full_machine",
        "trusted",
    )


@pytest.mark.asyncio
async def test_approval_identity_survives_background_session_switch(
    mock_session_manager,
):
    """Approval snapshots and responses remain bound to Project/Thread/Turn."""
    mock_session_manager.broadcast_ws = AsyncMock()
    request_id = "approval-background-1"
    task = asyncio.create_task(
        mock_session_manager._handle_approval_request(
            {
                "requestId": request_id,
                "actionSummary": "Run workspace command",
                "allowedGrantScopes": ["once"],
            },
            "default",
            "background-thread",
        )
    )
    await asyncio.sleep(0)

    details = mock_session_manager._pending_approval_details[request_id]
    assert details["projectId"] == "default"
    assert details["threadId"] == "background-thread"
    payload = mock_session_manager.broadcast_ws.await_args.args[0]
    assert payload["projectId"] == "default"
    assert payload["threadId"] == "background-thread"

    snapshot = mock_session_manager.approval_snapshot("default", "background-thread")
    assert snapshot["pending_requests"][0]["thread_id"] == "background-thread"
    assert (
        mock_session_manager.resolve_approval(
            request_id,
            "approve",
            "once",
            project_id="default",
            thread_id="other-thread",
        )
        is False
    )
    assert (
        mock_session_manager.resolve_approval(
            request_id,
            "approve",
            "once",
            project_id="default",
            thread_id="background-thread",
        )
        is True
    )
    assert (await task)["decision"] == "approve"


@pytest.mark.asyncio
async def test_runtime_eof_cancels_pending_approval(
    mock_session_manager,
):
    """A dead App Server cannot leave a tool approval waiting in memory."""
    mock_session_manager.broadcast_ws = AsyncMock()
    request_id = "approval-runtime-eof"
    task = asyncio.create_task(
        mock_session_manager._handle_approval_request(
            {
                "requestId": request_id,
                "actionSummary": "Run workspace command",
                "allowedGrantScopes": ["once"],
                "projectId": "default",
                "threadId": "runtime-thread",
                "turnId": "turn-runtime-eof",
            },
            runtime_id="runtime-a",
        )
    )
    await asyncio.sleep(0)
    other_task = asyncio.create_task(
        mock_session_manager._handle_approval_request(
            {
                "requestId": "approval-other-runtime",
                "actionSummary": "Run another workspace command",
                "allowedGrantScopes": ["once"],
                "projectId": "default",
                "threadId": "runtime-thread",
                "turnId": "turn-other-runtime",
            },
            runtime_id="runtime-b",
        )
    )
    await asyncio.sleep(0)

    await mock_session_manager._handle_runtime_notification(
        {
            "type": "runtime_error",
            "projectId": "default",
            "threadId": "runtime-thread",
            "_runtimeId": "runtime-a",
            "message": "App Server connection closed before stream settlement",
        },
        "default",
    )

    assert mock_session_manager.list_pending_approvals() == ["approval-other-runtime"]
    assert (await task)["decision"] == "deny"
    mock_session_manager.resolve_approval(
        "approval-other-runtime", "deny", None, project_id="default"
    )
    assert (await other_task)["decision"] == "deny"
    assert mock_session_manager.broadcast_ws.await_count == 4
    assert (
        mock_session_manager.broadcast_ws.await_args_list[2].args[0]["scope"]
        == "runtime"
    )
    assert (
        mock_session_manager.broadcast_ws.await_args_list[3].args[0]["approval"][
            "phase"
        ]
        == "resolved"
    )


@pytest.mark.asyncio
async def test_interrupt_cancels_approval_and_denies_late_request(
    mock_session_manager,
):
    """Stopping a Turn invalidates both its current and late approval waits."""
    mock_session_manager.broadcast_ws = AsyncMock()
    request = {
        "requestId": "approval-interrupt",
        "actionSummary": "Run workspace command",
        "allowedGrantScopes": ["once"],
        "projectId": "default",
        "threadId": "interrupt-thread",
        "turnId": "turn-interrupt",
    }
    task = asyncio.create_task(
        mock_session_manager._handle_approval_request(request, runtime_id="runtime-a")
    )
    await asyncio.sleep(0)

    mock_session_manager.mark_turn_interrupted(
        "interrupt-thread", "turn-interrupt", "default"
    )
    cancelled = await mock_session_manager.cancel_pending_approvals(
        project_id="default",
        thread_id="interrupt-thread",
        turn_id="turn-interrupt",
    )

    assert cancelled == 1
    assert mock_session_manager.list_pending_approvals() == []
    result = await task
    assert result == {
        "decision": "deny",
        "grantScope": None,
        "reason": "当前 Turn 已停止，审批已失效",
    }
    assert (
        mock_session_manager.resolve_approval("approval-interrupt", "approve", "once")
        is False
    )

    late_result = await mock_session_manager._handle_approval_request(
        {**request, "requestId": "approval-interrupt-late"}, runtime_id="runtime-a"
    )
    assert late_result["decision"] == "deny"
    assert mock_session_manager.list_pending_approvals() == []
    resolved = mock_session_manager.broadcast_ws.await_args_list[-1].args[0]
    assert resolved["approval"]["reason"] == "当前 Turn 已停止，审批已失效"
    assert resolved["approval"]["state"] == "expired"


@pytest.mark.asyncio
async def test_interrupt_does_not_publish_deny_after_approval_wins(
    mock_session_manager,
):
    """A concurrent stop cannot rewrite an already accepted approval."""
    mock_session_manager.broadcast_ws = AsyncMock()
    request = {
        "requestId": "approval-stop-race",
        "actionSummary": "Run workspace command",
        "allowedGrantScopes": ["once"],
        "projectId": "default",
        "threadId": "race-thread",
        "turnId": "turn-race",
    }
    task = asyncio.create_task(
        mock_session_manager._handle_approval_request(request, runtime_id="runtime-a")
    )
    await asyncio.sleep(0)

    assert mock_session_manager.resolve_approval(
        "approval-stop-race",
        "approve",
        "once",
        project_id="default",
        thread_id="race-thread",
        turn_id="turn-race",
    )
    assert (
        await mock_session_manager.cancel_pending_approvals(
            project_id="default",
            thread_id="race-thread",
            turn_id="turn-race",
        )
        == 0
    )
    assert (await task)["decision"] == "approve"
    assert mock_session_manager.broadcast_ws.await_count == 1


def test_session_manager_thread_metadata_management(mock_session_manager):
    """Ensure thread metadata can be queried, updated, and persisted."""
    meta = mock_session_manager.get_thread_meta("t-custom")
    assert "t-custom" in meta["title"]

    updated = mock_session_manager.set_thread_meta(
        "t-custom", {"title": "Renamed Session", "summary": "Goal 1"}
    )
    assert updated["title"] == "Renamed Session"
    assert updated["summary"] == "Goal 1"

    all_meta = mock_session_manager.list_all_thread_meta()
    assert "t-custom" in all_meta
    assert all_meta["t-custom"]["title"] == "Renamed Session"


def test_session_catalog_reads_bounded_history_without_web_state(tmp_path, monkeypatch):
    """Project history is projected from SessionStore summary/checkpoint files."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    session_base = tmp_path / "sessions"
    monkeypatch.setattr(
        "server.session_catalog._session_base", lambda _workspace: session_base
    )
    session_dir = session_base / "s-1"
    session_dir.mkdir(parents=True)
    records = [
        {
            "seq": 1,
            "kind": "session_created",
            "schema_version": 1,
            "session_id": "s-1",
            "timestamp_ms": 1000,
        },
        {"seq": 2, "kind": "thread_started", "thread_id": "t-1"},
        {
            "seq": 3,
            "kind": "turn_started",
            "thread_id": "t-1",
            "turn_id": "turn-1",
            "prompt": "inspect project",
        },
        {
            "seq": 4,
            "kind": "item",
            "item_id": "item-1",
            "thread_id": "t-1",
            "turn_id": "turn-1",
            "message": {"role": "user", "text": "inspect project"},
        },
        {
            "seq": 5,
            "kind": "turn_settled",
            "thread_id": "t-1",
            "turn_id": "turn-1",
            "status": "step_limit",
            "steps": 8,
            "error": "model request failed: transport error",
        },
        {
            "seq": 6,
            "kind": "checkpoint",
            "thread_id": "t-1",
            "messages": [{"role": "user", "text": "inspect project"}],
            "timestamp_ms": 2000,
        },
    ]
    (session_dir / "session.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8"
    )
    (session_dir / "summary.json").write_text(
        json.dumps(
            {
                "id": "s-1",
                "created_at_ms": 1000,
                "updated_at_ms": 2000,
                "turn_count": 1,
                "last_prompt": "inspect project",
                # Deliberately stale: the settled record is authoritative.
                "last_status": "completed",
            }
        ),
        encoding="utf-8",
    )
    (session_dir / "thread_settings.json").write_text(
        json.dumps(
            {
                "version": 1,
                "thread_id": "t-1",
                "continuation_mode": "continuous",
            }
        ),
        encoding="utf-8",
    )
    (session_base / "thread_index.json").write_text(
        json.dumps({"version": 1, "threads": {"t-1": {"session_id": "s-1"}}}),
        encoding="utf-8",
    )
    (session_dir / "session.lock").write_text("pid=999999\n", encoding="utf-8")
    monkeypatch.setattr("server.session_catalog._process_alive", lambda pid: False)

    catalog = SessionCatalog()
    listed = catalog.list_sessions(workspace, "project-1")
    assert listed["data"][0]["thread_id"] == "t-1"
    assert listed["data"][0]["session_status"] == "historical"
    assert listed["data"][0]["turn_active"] is False
    assert listed["data"][0]["process_online"] is False
    assert listed["data"][0]["resumable"] is True
    assert listed["data"][0]["locked_by"] is None
    assert listed["data"][0]["last_turn_status"] == "step_limit"
    assert listed["data"][0]["last_stop_reason"] == "step_limit"
    assert (
        listed["data"][0]["last_turn_error"] == "model request failed: transport error"
    )
    assert listed["data"][0]["last_turn_id"] == "turn-1"
    assert listed["data"][0]["last_turn_steps"] == 8
    assert listed["data"][0]["last_turn_complete"] is False
    assert listed["data"][0]["continuation_mode"] == "continuous"
    history = catalog.read_thread(workspace, "project-1", "t-1")
    assert history["messages"][0]["text"] == "inspect project"
    assert history["items"][0]["item"]["type"] == "userMessage"
    assert history["last_turn_status"] == "step_limit"
    assert history["last_turn_error"] == "model request failed: transport error"
    assert history["last_turn_id"] == "turn-1"


def test_session_catalog_does_not_mark_dead_unsettled_turn_as_active(
    tmp_path, monkeypatch
):
    """A crashed process is recoverable, not currently running in the sidebar."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    session_base = tmp_path / "sessions"
    session_dir = session_base / "s-crashed"
    session_dir.mkdir(parents=True)
    records = [
        {
            "seq": 1,
            "kind": "session_created",
            "schema_version": 1,
            "session_id": "s-crashed",
            "timestamp_ms": 1000,
        },
        {"seq": 2, "kind": "thread_started", "thread_id": "t-crashed"},
        {
            "seq": 3,
            "kind": "turn_started",
            "thread_id": "t-crashed",
            "turn_id": "turn-crashed",
            "prompt": "inspect before crash",
        },
        {
            "seq": 4,
            "kind": "checkpoint",
            "thread_id": "t-crashed",
            "messages": [{"role": "user", "text": "inspect before crash"}],
            "timestamp_ms": 2000,
        },
    ]
    (session_dir / "session.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8"
    )
    (session_dir / "summary.json").write_text(
        json.dumps({"turn_count": 1, "last_prompt": "inspect before crash"}),
        encoding="utf-8",
    )
    (session_base / "thread_index.json").write_text(
        json.dumps(
            {"version": 1, "threads": {"t-crashed": {"session_id": "s-crashed"}}}
        ),
        encoding="utf-8",
    )
    (session_dir / "session.lock").write_text("pid=999999\n", encoding="utf-8")
    monkeypatch.setattr(
        "server.session_catalog._session_base", lambda _workspace: session_base
    )
    monkeypatch.setattr("server.session_catalog._process_alive", lambda pid: False)

    entry = SessionCatalog().list_sessions(workspace, "project-1")["data"][0]
    assert entry["turn_active"] is False
    assert entry["process_online"] is False
    assert entry["session_status"] == "historical"
    assert entry["resumable"] is True
    assert entry["active_turn_id"] is None
    assert entry["last_turn_status"] == "in_progress"


def test_session_catalog_projects_tool_settlement_content_and_arguments():
    """SessionStore tool records keep output on the tool message itself."""
    from server.session_catalog import _item_projection

    projected = _item_projection(
        {
            "item_id": "call-1",
            "arguments": {"command": "Get-ChildItem"},
            "message": {
                "role": "tool",
                "name": "shell",
                "content": "exit: 0\nstdout:\nfile.txt\nstderr:\n",
                "is_error": False,
                "outcome": "completed",
            },
        }
    )

    assert projected == {
        "type": "toolCall",
        "id": "call-1",
        "name": "shell",
        "arguments": {"command": "Get-ChildItem"},
        "status": "completed",
        "outcome": "completed",
        "output": "exit: 0\nstdout:\nfile.txt\nstderr:\n",
    }


def test_session_catalog_projects_failed_tool_settlement():
    from server.session_catalog import _item_projection

    projected = _item_projection(
        {
            "item_id": "call-2",
            "message": {
                "role": "tool",
                "name": "shell",
                "content": "permission denied",
                "is_error": True,
                "outcome": "failed",
            },
        }
    )

    assert projected["status"] == "failed"
    assert projected["outcome"] == "failed"
    assert projected["output"] == "permission denied"


def test_session_catalog_projects_retryable_tool_outcome():
    from server.session_catalog import _item_projection

    projected = _item_projection(
        {
            "item_id": "call-3",
            "message": {
                "role": "tool",
                "name": "mcp__fixture__slow",
                "content": "MCP tool call timed out",
                "is_error": True,
                "outcome": "retryable",
            },
        }
    )

    assert projected["status"] == "failed"
    assert projected["outcome"] == "retryable"


def test_session_catalog_keeps_legacy_tool_projection_without_outcome():
    from server.session_catalog import _item_projection

    projected = _item_projection(
        {
            "item_id": "call-legacy",
            "message": {
                "role": "tool",
                "name": "shell",
                "content": "exit: 0",
                "is_error": False,
            },
        }
    )

    assert projected["status"] == "completed"
    assert "outcome" not in projected


def test_session_catalog_projects_assistant_reasoning_and_text_items():
    from server.session_catalog import _item_projections

    projected = _item_projections(
        {
            "item_id": "assistant-1",
            "message": {
                "role": "assistant",
                "reasoning": "Inspect the relevant modules first.",
                "text": "I found the relevant workflow path.",
            },
        }
    )

    assert projected == [
        {
            "type": "reasoning",
            "id": "assistant-1:reasoning",
            "text": "Inspect the relevant modules first.",
        },
        {
            "type": "agentMessage",
            "id": "assistant-1:agent",
            "text": "I found the relevant workflow path.",
        },
    ]


def test_session_catalog_skips_oversized_checkpoint_but_keeps_goal_state(
    tmp_path, monkeypatch
):
    """A large checkpoint must not make workflow state fall back to a hung server."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    session_base = tmp_path / "sessions"
    monkeypatch.setattr(
        "server.session_catalog._session_base", lambda _workspace: session_base
    )
    session_dir = session_base / "s-large"
    (session_dir / "goal").mkdir(parents=True)
    records = [
        {"kind": "session_created", "session_id": "s-large", "timestamp_ms": 1},
        {"kind": "thread_started", "thread_id": "t-large"},
        {
            "kind": "turn_started",
            "thread_id": "t-large",
            "turn_id": "turn-1",
        },
        {
            "kind": "turn_settled",
            "thread_id": "t-large",
            "turn_id": "turn-1",
            "status": "completed",
            "timestamp_ms": 2,
        },
        {
            "kind": "checkpoint",
            "thread_id": "t-large",
            "seq": 8,
            "messages": [{"role": "assistant", "text": "x" * 70_000}],
        },
    ]
    (session_dir / "session.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8"
    )
    (session_dir / "goal" / "state.json").write_text(
        json.dumps(
            {
                "thread_id": "t-large",
                "objective": "recover workflow state",
                "status": "failed",
                "verification_status": "failed",
                "last_error": "verifier timed out",
            }
        ),
        encoding="utf-8",
    )
    (session_base / "thread_index.json").write_text(
        json.dumps({"version": 1, "threads": {"t-large": {"session_id": "s-large"}}}),
        encoding="utf-8",
    )

    history = SessionCatalog().read_thread(workspace, "project-1", "t-large")

    assert history is not None
    assert history["session"]["history_truncated"] is True
    assert history["session"]["resumable"] is True
    assert history["session"]["goal"]["status"] == "blocked"
    assert history["session"]["goal"]["verification_status"] == "failed"
    assert history["session"]["goal"]["last_error"] == "verifier timed out"
    assert len(history["messages"][0]["text"]) <= 16 * 1024 + 1
    assert SessionCatalog().find_session_path(workspace, "t-large") == session_dir


def test_session_catalog_recovers_history_hidden_by_empty_restart_session(
    tmp_path, monkeypatch
):
    """A restart-created empty Session cannot hide the previous conversation."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    session_base = tmp_path / "sessions"
    monkeypatch.setattr(
        "server.session_catalog._session_base", lambda _workspace: session_base
    )

    old_dir = session_base / "s-old"
    old_dir.mkdir(parents=True)
    old_records = [
        {"kind": "session_created", "session_id": "s-old", "timestamp_ms": 1},
        {"kind": "thread_started", "thread_id": "default"},
        {
            "kind": "turn_started",
            "thread_id": "default",
            "turn_id": "turn-1",
        },
        {
            "kind": "turn_settled",
            "thread_id": "default",
            "turn_id": "turn-1",
            "status": "completed",
            "timestamp_ms": 2,
        },
        {
            "kind": "checkpoint",
            "thread_id": "default",
            "seq": 5,
            "timestamp_ms": 2,
            "messages": [{"role": "user", "text": "recover this history"}],
        },
    ]
    (old_dir / "session.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in old_records),
        encoding="utf-8",
    )
    (old_dir / "summary.json").write_text(
        json.dumps(
            {
                "created_at_ms": 1,
                "updated_at_ms": 2,
                "turn_count": 1,
                "last_prompt": "recover this history",
            }
        ),
        encoding="utf-8",
    )

    new_dir = session_base / "s-empty"
    new_dir.mkdir(parents=True)
    new_records = [
        {"kind": "session_created", "session_id": "s-empty", "timestamp_ms": 3},
        {"kind": "thread_started", "thread_id": "default"},
        {
            "kind": "checkpoint",
            "thread_id": "default",
            "seq": 2,
            "timestamp_ms": 3,
            "messages": [
                {"role": "system", "text": "initial instructions"},
                {"role": "context", "text": "initial world"},
            ],
        },
    ]
    (new_dir / "session.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in new_records),
        encoding="utf-8",
    )
    (new_dir / "summary.json").write_text(
        json.dumps({"created_at_ms": 3, "updated_at_ms": 3, "turn_count": 0}),
        encoding="utf-8",
    )
    (session_base / "thread_index.json").write_text(
        json.dumps({"version": 1, "threads": {"default": {"session_id": "s-empty"}}}),
        encoding="utf-8",
    )

    catalog = SessionCatalog()
    history = catalog.read_thread(workspace, "project-1", "default")

    assert history is not None
    assert history["session"]["session_id"] == "s-old"
    assert history["messages"][0]["text"] == "recover this history"
    assert catalog.find_session_path(workspace, "default") == old_dir


@pytest.mark.asyncio
async def test_client_pool_replaces_a_client_after_stdio_process_failure(
    mock_session_manager,
):
    """A dead SDK client must not keep routing requests to a closed pipe."""

    class FakeClient:
        def __init__(self, is_running):
            self.is_running = is_running

    stale = FakeClient(False)
    replacement = FakeClient(True)
    mock_session_manager._project_clients[("default", "dead-thread")] = stale
    mock_session_manager._clients["dead-thread"] = stale
    mock_session_manager._client_projects["dead-thread"] = "default"
    mock_session_manager._create_client = AsyncMock(return_value=replacement)

    client = await mock_session_manager.get_client_for_thread("dead-thread", "default")

    assert client is replacement
    mock_session_manager._create_client.assert_awaited_once_with(
        "dead-thread",
        mock_session_manager._projects_registry["default"],
        "new",
        None,
    )
    assert mock_session_manager._clients["dead-thread"] is replacement
    assert stale not in mock_session_manager._clients.values()


def test_checkpoint_projection_keeps_reasoning_and_tool_call_identity():
    from server.session_catalog import _checkpoint_projection

    projected = _checkpoint_projection(
        {
            "kind": "checkpoint",
            "thread_id": "t-checkpoint",
            "messages": [
                {
                    "role": "assistant",
                    "reasoning": "Inspect before changing.",
                    "text": "I will inspect the workflow first.",
                    "tool_calls": [
                        {"id": "call-1", "name": "read_file", "arguments": {}},
                    ],
                }
            ],
        }
    )

    assert projected["messages"] == [
        {
            "role": "assistant",
            "reasoning": "Inspect before changing.",
            "text": "I will inspect the workflow first.",
            "tool_calls": [{"id": "call-1", "name": "read_file"}],
        }
    ]


def test_session_catalog_only_projects_turn_bound_context_as_compaction():
    from server.session_catalog import _item_projection

    assert (
        _item_projection(
            {
                "item_id": "world-1",
                "item_kind": "context",
                "turn_id": None,
                "message": {"role": "context", "text": "world state"},
            }
        )
        is None
    )

    assert _item_projection(
        {
            "item_id": "compaction-1",
            "item_kind": "context_compaction",
            "turn_id": "turn-1",
            "message": {"role": "context", "text": "compacted context"},
        }
    ) == {
        "type": "contextCompaction",
        "id": "compaction-1",
        "status": "completed",
    }


def test_session_catalog_keeps_user_paused_state_after_lock_release(
    tmp_path, monkeypatch
):
    """A paused Goal remains selectable and resumable after its process exits."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    session_base = tmp_path / "sessions"
    monkeypatch.setattr(
        "server.session_catalog._session_base", lambda _workspace: session_base
    )
    session_dir = session_base / "s-paused"
    session_dir.mkdir(parents=True)
    records = [
        {"kind": "session_created", "session_id": "s-paused", "timestamp_ms": 1},
        {"kind": "thread_started", "thread_id": "t-paused"},
        {
            "kind": "checkpoint",
            "thread_id": "t-paused",
            "messages": [{"role": "user", "text": "pause here"}],
            "timestamp_ms": 2,
        },
    ]
    (session_dir / "session.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8"
    )
    (session_dir / "goal").mkdir()
    (session_dir / "goal" / "state.json").write_text(
        json.dumps(
            {
                "objective": "finish the migration",
                "status": "user_paused",
                "token_budget": 1000,
                "tokens_used": 12,
            }
        ),
        encoding="utf-8",
    )

    entry = SessionCatalog().list_sessions(workspace, "project-1")["data"][0]

    assert entry["runtime_status"] == "paused"
    assert entry["session_status"] == "paused"
    assert entry["turn_active"] is False
    assert entry["process_online"] is False
    assert entry["resumable"] is True
    assert entry["goal_status"] == "paused"


@pytest.mark.asyncio
async def test_attach_thread_honors_explicit_project_canonical_session(
    mock_session_manager, tmp_path, monkeypatch
):
    """An explicit Project must select that project's canonical SessionStore record."""
    project_root = tmp_path / "other-project"
    project_root.mkdir()
    project = {
        "id": "other-project",
        "name": "Other Project",
        "primary_path": str(project_root),
    }
    mock_session_manager._projects_registry[project["id"]] = project
    canonical = {
        "session": {
            "project_id": project["id"],
            "session_id": "session-other",
            "session_status": "historical",
            "runtime_status": "historical",
        }
    }
    monkeypatch.setattr(
        mock_session_manager,
        "read_project_thread",
        lambda thread_id, project_id=None: (
            canonical
            if (thread_id, project_id) == ("shared-thread", project["id"])
            else None
        ),
    )
    client = AsyncMock()
    create_client = AsyncMock(return_value=client)
    monkeypatch.setattr(mock_session_manager, "_create_client", create_client)

    result = await mock_session_manager.attach_thread("shared-thread", project["id"])

    assert result["attached"] is True
    assert result["project"] == project["id"]
    create_client.assert_awaited_once_with(
        "shared-thread", project, "resume", "session-other"
    )


@pytest.mark.asyncio
async def test_attach_thread_does_not_report_local_client_as_external_lock(
    mock_session_manager, monkeypatch
):
    """The Gateway's own locked Session remains attachable and writable."""
    client = AsyncMock()
    mock_session_manager._client = client
    mock_session_manager._clients["default"] = client
    mock_session_manager._client_projects["default"] = "default"
    mock_session_manager._project_clients[("default", "default")] = client
    mock_session_manager.set_active_turn(
        "default", "turn-attached", project_id="default"
    )
    canonical = {
        "session": {
            "project_id": "default",
            "session_id": "session-local",
            "session_status": "locked",
            "runtime_status": "running",
            "locked_by": {"pid": 1234},
        }
    }
    monkeypatch.setattr(
        mock_session_manager,
        "read_project_thread",
        lambda thread_id, project_id=None: (
            canonical if (thread_id, project_id) == ("default", "default") else None
        ),
    )
    create_client = AsyncMock(side_effect=AssertionError("would create a duplicate"))
    monkeypatch.setattr(mock_session_manager, "_create_client", create_client)

    result = await mock_session_manager.attach_thread("default", "default")

    assert result["attached"] is True
    assert result["session_id"] == "session-local"
    assert result["active_turn_id"] == "turn-attached"
    assert result["turn_active"] is True
    create_client.assert_not_awaited()


@pytest.mark.asyncio
async def test_start_does_not_create_duplicate_when_default_session_is_locked(
    mock_session_manager, monkeypatch
):
    """A Gateway restart keeps an externally running default Session read-only."""
    canonical = {
        "session": {
            "project_id": "default",
            "session_id": "session-external",
            "session_status": "locked",
            "runtime_status": "running",
        }
    }
    monkeypatch.setattr(
        mock_session_manager,
        "read_project_thread",
        lambda thread_id, project_id=None: (
            canonical if (thread_id, project_id) == ("default", None) else None
        ),
    )
    create_client = AsyncMock(side_effect=AssertionError("would create a duplicate"))
    monkeypatch.setattr(mock_session_manager, "_create_client", create_client)

    await mock_session_manager.start()

    assert mock_session_manager._client is None
    assert mock_session_manager._initialized is True
    assert mock_session_manager._active_thread_projects["default"] == "default"
    create_client.assert_not_awaited()


@pytest.mark.asyncio
async def test_attach_thread_allows_same_thread_id_in_another_project(
    mock_session_manager, tmp_path
):
    """Project-qualified Thread bindings may coexist in the client pool."""
    mock_session_manager._state_dir = tmp_path.parent / f"{tmp_path.name}-gateway-state"
    project_root = tmp_path / "other-project"
    project_root.mkdir()
    mock_session_manager._projects_registry["other-project"] = {
        "id": "other-project",
        "name": "Other Project",
        "primary_path": str(project_root),
    }
    mock_session_manager._clients["shared-thread"] = AsyncMock()
    mock_session_manager._client_projects["shared-thread"] = "default"

    result = await mock_session_manager.attach_thread("shared-thread", "other-project")

    assert result["attached"] is True
    assert mock_session_manager._client_projects["shared-thread"] == "other-project"
    assert (
        mock_session_manager._active_thread_projects["shared-thread"] == "other-project"
    )


@pytest.mark.asyncio
async def test_project_scoped_default_clients_can_switch_without_reuse(
    mock_session_manager, monkeypatch, tmp_path
):
    """Switching between two Projects keeps each same-named Thread client alive."""
    project_root = tmp_path / "other-project"
    project_root.mkdir()
    mock_session_manager._projects_registry["other-project"] = {
        "id": "other-project",
        "name": "Other Project",
        "primary_path": str(project_root),
    }
    clients = {}

    async def create_client(thread_id, project, session_mode, session_id=None):
        client = AsyncMock()
        clients[project["id"]] = client
        return client

    monkeypatch.setattr(mock_session_manager, "_create_client", create_client)
    monkeypatch.setattr(
        mock_session_manager, "read_project_thread", lambda *_args: None
    )

    default_client = await mock_session_manager.get_client_for_thread(
        "default", "default"
    )
    other_client = await mock_session_manager.get_client_for_thread(
        "default", "other-project"
    )
    switched_back = await mock_session_manager.get_client_for_thread(
        "default", "default"
    )

    assert default_client is clients["default"]
    assert other_client is clients["other-project"]
    assert switched_back is default_client
    assert default_client is not other_client
    assert mock_session_manager.live_thread_bindings() == [
        ("default", "default"),
        ("other-project", "default"),
    ]


def test_bind_forked_thread_keeps_explicit_source_project(
    mock_session_manager, tmp_path
):
    """A forked in-memory Thread inherits its source Project binding."""
    project_root = tmp_path / "other-project"
    project_root.mkdir()
    mock_session_manager._projects_registry["other-project"] = {
        "id": "other-project",
        "name": "Other Project",
        "primary_path": str(project_root),
        "source_folders": [{"path": str(project_root), "is_primary": True}],
    }
    client = AsyncMock()

    mock_session_manager.bind_thread_client("forked", client, "other-project")

    assert mock_session_manager._clients["forked"] is client
    assert mock_session_manager._client_projects["forked"] == "other-project"


@pytest.mark.asyncio
async def test_concurrent_thread_attach_creates_one_client(
    mock_session_manager, monkeypatch
):
    """Concurrent attach requests share one serialized App Server client."""
    first_create_started = asyncio.Event()
    release_create = asyncio.Event()
    created_clients = []

    async def create_client(thread_id, project, session_mode, session_id=None):
        created_clients.append(AsyncMock())
        first_create_started.set()
        await release_create.wait()
        return created_clients[-1]

    monkeypatch.setattr(mock_session_manager, "_create_client", create_client)
    first = asyncio.create_task(
        mock_session_manager.get_client_for_thread("concurrent-thread")
    )
    await first_create_started.wait()
    second = asyncio.create_task(
        mock_session_manager.get_client_for_thread("concurrent-thread")
    )
    await asyncio.sleep(0)
    release_create.set()

    first_client, second_client = await asyncio.gather(first, second)

    assert first_client is second_client
    assert len(created_clients) == 1


@pytest.mark.asyncio
async def test_fork_and_concurrent_attach_share_the_forked_binding(
    mock_session_manager, monkeypatch
):
    """Attach waits for fork binding instead of creating a competing child client."""
    fork_started = asyncio.Event()
    release_fork = asyncio.Event()
    source_client = AsyncMock()

    async def fork_session(**kwargs):
        fork_started.set()
        await release_fork.wait()
        return SimpleNamespace(
            session_id="s-forked",
            thread_id=kwargs["new_thread_id"],
            path="/tmp/s-forked/session.jsonl",
            parent_session_id="s-source",
            parent_checkpoint_seq=1,
            session_bytes=128,
            context_before_bytes=128,
            context_after_bytes=128,
            compacted=False,
            method="exact",
        )

    source_client.fork_session = fork_session
    mock_session_manager._clients["source-thread"] = source_client
    mock_session_manager._client_projects["source-thread"] = "default"
    mock_session_manager._thread_metadata["source-thread"] = {
        "title": "Source",
        "project": "default",
    }
    child_client = AsyncMock()
    create_client = AsyncMock(return_value=child_client)
    monkeypatch.setattr(mock_session_manager, "_create_client", create_client)

    fork_task = asyncio.create_task(
        mock_session_manager.fork_thread("source-thread", "forked-thread")
    )
    await fork_started.wait()
    attach_task = asyncio.create_task(
        mock_session_manager.attach_thread("forked-thread")
    )
    await asyncio.sleep(0)
    assert not attach_task.done()

    release_fork.set()
    forked, attached = await asyncio.gather(fork_task, attach_task)

    assert forked["project"] == "default"
    assert attached["attached"] is True
    assert mock_session_manager._clients["forked-thread"] is child_client
    create_client.assert_awaited_once()


@pytest.mark.asyncio
async def test_fork_catalog_survives_child_start_failure_and_retry(
    mock_session_manager, monkeypatch
):
    """A persisted child remains discoverable when process startup fails."""
    source_client = AsyncMock()
    source_client.fork_session = AsyncMock(
        return_value=SimpleNamespace(
            session_id="s-forked-after-failure",
            thread_id="forked-after-failure",
            path="/tmp/s-forked-after-failure/session.jsonl",
            parent_session_id="s-source",
            parent_checkpoint_seq=3,
            session_bytes=256,
            context_before_bytes=512,
            context_after_bytes=512,
            compacted=False,
            method="exact",
        )
    )
    mock_session_manager._clients["source-thread"] = source_client
    mock_session_manager._client_projects["source-thread"] = "default"
    mock_session_manager._thread_metadata["source-thread"] = {
        "title": "Source",
        "project": "default",
    }
    child_client = AsyncMock()
    create_client = AsyncMock(
        side_effect=[RuntimeError("child process failed to start"), child_client]
    )
    monkeypatch.setattr(mock_session_manager, "_create_client", create_client)

    with pytest.raises(RuntimeError, match="child process failed"):
        await mock_session_manager.fork_thread("source-thread", "forked-after-failure")

    failed_meta = mock_session_manager.get_thread_meta(
        "forked-after-failure", "default"
    )
    assert failed_meta["session_id"] == "s-forked-after-failure"
    assert failed_meta["parent_checkpoint_seq"] == 3

    retried = await mock_session_manager.fork_thread(
        "source-thread", "forked-after-failure"
    )

    assert retried["session_id"] == "s-forked-after-failure"
    assert mock_session_manager._clients["forked-after-failure"] is child_client
    assert source_client.fork_session.await_count == 2
    assert create_client.await_count == 2


@pytest.mark.asyncio
async def test_restart_broadcasts_runtime_generation(mock_session_manager, monkeypatch):
    """A successful Gateway restart invalidates Web Studio's old revision cursor."""
    old_client = AsyncMock()
    new_client = AsyncMock()
    mock_session_manager._client = old_client
    mock_session_manager._clients["default"] = old_client
    mock_session_manager._client_projects["default"] = "default"
    create_client = AsyncMock(return_value=new_client)
    broadcast = AsyncMock()
    monkeypatch.setattr(mock_session_manager, "_create_client", create_client)
    monkeypatch.setattr(mock_session_manager, "broadcast_ws", broadcast)

    await mock_session_manager.restart_for_current_project()

    old_client.stop.assert_awaited_once()
    assert mock_session_manager._runtime_generation == 1
    broadcast.assert_awaited_once_with(
        {
            "type": "notification",
            "method": "gateway/runtime/restarted",
            "data": {"projectId": "default", "runtimeGeneration": 1},
        }
    )


@pytest.mark.asyncio
async def test_project_restart_preserves_other_project_clients(
    mock_session_manager, monkeypatch, tmp_path
):
    """Restarting one Project does not stop another Project's runtime."""
    other_root = tmp_path / "other-project"
    other_root.mkdir()
    mock_session_manager._projects_registry["other-project"] = {
        "id": "other-project",
        "name": "Other Project",
        "primary_path": str(other_root),
    }

    default_client = AsyncMock()
    other_client = AsyncMock()
    replacement_client = AsyncMock()
    mock_session_manager._client = default_client
    mock_session_manager._clients["default"] = default_client
    mock_session_manager._clients["other-thread"] = other_client
    mock_session_manager._client_projects.update(
        {"default": "default", "other-thread": "other-project"}
    )
    mock_session_manager._project_clients.update(
        {
            ("default", "default"): default_client,
            ("other-project", "other-thread"): other_client,
        }
    )
    mock_session_manager._active_thread_projects.update(
        {"default": "default", "other-thread": "other-project"}
    )
    monkeypatch.setattr(
        mock_session_manager,
        "_create_client",
        AsyncMock(return_value=replacement_client),
    )
    monkeypatch.setattr(mock_session_manager, "broadcast_ws", AsyncMock())

    await mock_session_manager.restart_for_current_project()

    default_client.stop.assert_awaited_once()
    other_client.stop.assert_not_awaited()
    assert (
        mock_session_manager._project_clients[("other-project", "other-thread")]
        is other_client
    )
    assert mock_session_manager._clients["other-thread"] is other_client
    assert (
        mock_session_manager._project_clients[("default", "default")]
        is replacement_client
    )


@pytest.mark.asyncio
async def test_current_project_client_does_not_reuse_stale_compatibility_pointer(
    mock_session_manager, tmp_path
):
    """Project-scoped lookup wins over the legacy unqualified _client pointer."""
    other_root = tmp_path / "other-project"
    other_root.mkdir()
    mock_session_manager._projects_registry["other-project"] = {
        "id": "other-project",
        "name": "Other Project",
        "primary_path": str(other_root),
    }
    old_client = AsyncMock()
    other_client = AsyncMock()
    mock_session_manager._client = old_client
    mock_session_manager._client_projects["default"] = "default"
    mock_session_manager._project_clients[("default", "default")] = old_client
    mock_session_manager._project_clients[("other-project", "default")] = other_client
    mock_session_manager.switch_project("other-project")

    resolved = await mock_session_manager.get_client_for_project()

    assert resolved is other_client


def test_session_manager_avoids_duplicate_project_for_custom_id_path(tmp_path):
    """Ensure _load_state does not duplicate a project when its name differs from directory basename."""
    custom_ws = tmp_path / "pi"
    custom_ws.mkdir()
    projects_file = tmp_path / "projects.json"
    projects_data = {
        "current_project_id": "pi-fx",
        "projects": {
            "pi-fx": {
                "id": "pi-fx",
                "name": "pi-fx",
                "primary_path": str(custom_ws),
                "source_folders": [
                    {"name": "pi", "path": str(custom_ws), "is_primary": True}
                ],
                "access": "project",
                "policy": "interactive",
            }
        },
    }
    projects_file.write_text(json.dumps(projects_data), encoding="utf-8")
    threads_dir = tmp_path / "projects" / "pi-fx"
    threads_dir.mkdir(parents=True)
    threads_file = threads_dir / "threads.json"
    threads_file.write_text(
        json.dumps({"t-1": {"title": "My Thread", "project": "pi-fx"}}),
        encoding="utf-8",
    )

    mgr = SessionManager()
    mgr._state_dir = tmp_path
    mgr._load_state()

    assert "pi-fx" in mgr._projects_registry
    assert "pi" not in mgr._projects_registry
    assert mgr._current_project_id == "pi-fx"
    assert (tmp_path / "projects.json").is_file()
    assert (tmp_path / "settings.json").is_file()
    assert (tmp_path / "projects" / "pi-fx" / "threads.json").is_file()
    assert not (tmp_path / "state.json").exists()
    assert not (tmp_path / "state.json.migrated").exists()


def test_decoupled_persistence_isolation(tmp_path):
    """Ensure updates to settings, projects, and threads only write their respective files."""
    mgr = SessionManager()
    mgr._state_dir = tmp_path
    mgr._save_state()

    settings_file = tmp_path / "settings.json"
    projects_file = tmp_path / "projects.json"
    threads_file = tmp_path / "projects" / mgr._current_project_id / "threads.json"

    assert settings_file.is_file()
    assert projects_file.is_file()
    assert threads_file.is_file()

    # 1. Update settings -> only settings.json changes
    p_mtime_before = projects_file.stat().st_mtime_ns
    t_mtime_before = threads_file.stat().st_mtime_ns
    mgr.update_settings({"theme": "cyberpunk"})

    assert mgr._settings["theme"] == "cyberpunk"
    assert json.loads(settings_file.read_text(encoding="utf-8"))["theme"] == "cyberpunk"
    assert projects_file.stat().st_mtime_ns == p_mtime_before
    assert threads_file.stat().st_mtime_ns == t_mtime_before

    # 2. Update thread -> only that project's threads.json changes
    s_mtime_before = settings_file.stat().st_mtime_ns
    p_mtime_before = projects_file.stat().st_mtime_ns
    mgr.set_thread_meta("default", {"title": "New Title"})

    assert mgr.get_thread_meta("default")["title"] == "New Title"
    loaded_threads = json.loads(threads_file.read_text(encoding="utf-8"))
    assert loaded_threads["default"]["title"] == "New Title"
    assert settings_file.stat().st_mtime_ns == s_mtime_before
    assert projects_file.stat().st_mtime_ns == p_mtime_before

    # 3. Update project execution -> only projects.json changes
    s_mtime_before = settings_file.stat().st_mtime_ns
    t_mtime_before = threads_file.stat().st_mtime_ns
    mgr.set_project_execution("full_machine", "automatic")

    assert mgr.project_execution() == ("full_machine", "automatic")
    assert settings_file.stat().st_mtime_ns == s_mtime_before
    assert threads_file.stat().st_mtime_ns == t_mtime_before


@pytest.mark.asyncio
async def test_session_manager_does_not_cache_session_approvals(mock_session_manager):
    """Web relays each request; Host/Capabilities owns session grant reuse."""
    req_payload = {
        "requestId": "req-sess-1",
        "access": "project",
        "actionSummary": "cargo test",
        "threadId": "thread-1",
        "sessionId": "sess-1",
        "allowedGrantScopes": ["once", "session", "project"],
    }
    task = asyncio.create_task(
        mock_session_manager._handle_approval_request(req_payload)
    )
    await asyncio.sleep(0.01)
    assert "req-sess-1" in mock_session_manager._pending_approvals

    resolved = mock_session_manager.resolve_approval(
        request_id="req-sess-1",
        decision="approve",
        grant_scope="session",
        reason="Approve for this session",
    )
    assert resolved is True
    result = await task
    assert result["decision"] == "approve"
    assert result["grantScope"] == "session"
    assert not hasattr(mock_session_manager, "_session_approval_grants")

    # Same session still creates a new pending request.
    second_req = {**req_payload, "requestId": "req-sess-2"}
    second_task = asyncio.create_task(
        mock_session_manager._handle_approval_request(second_req)
    )
    await asyncio.sleep(0.01)
    assert "req-sess-2" in mock_session_manager._pending_approvals
    mock_session_manager.resolve_approval("req-sess-2", "deny", None)
    await second_task

    # Different session does NOT reuse session grant
    diff_session_req = {
        **req_payload,
        "requestId": "req-sess-3",
        "threadId": "thread-2",
        "sessionId": "sess-2",
    }
    task_diff = asyncio.create_task(
        mock_session_manager._handle_approval_request(diff_session_req)
    )
    await asyncio.sleep(0.01)
    assert "req-sess-3" in mock_session_manager._pending_approvals
    mock_session_manager.resolve_approval(
        request_id="req-sess-3",
        decision="deny",
        grant_scope=None,
    )
    await task_diff


@pytest.mark.asyncio
async def test_session_manager_automatic_policy_is_not_web_auto_approval(
    mock_session_manager,
):
    """Automatic decisions are made by Host/Capabilities, not Web."""
    mock_session_manager.set_project_execution("full_machine", "automatic")
    req_payload = {
        "requestId": "req-auto-1",
        "access": "full_machine",
        "actionSummary": "git status",
        "allowedGrantScopes": ["once", "session", "project"],
    }
    task = asyncio.create_task(
        mock_session_manager._handle_approval_request(req_payload)
    )
    await asyncio.sleep(0.01)
    assert "req-auto-1" in mock_session_manager.list_pending_approvals()
    mock_session_manager.resolve_approval("req-auto-1", "deny", None)
    res = await task
    assert res["decision"] == "deny"


def test_stale_stream_cleanup_does_not_clear_new_turn(mock_session_manager):
    """A delayed old stream cannot clear a newer Turn for the same Thread."""
    mock_session_manager.set_active_turn("thread-1", "turn-new", project_id="default")

    mock_session_manager.clear_active_turn("thread-1", "default", turn_id="turn-old")

    assert mock_session_manager.get_active_turn("thread-1", "default") == "turn-new"
    mock_session_manager.clear_active_turn("thread-1", "default", turn_id="turn-new")
    assert mock_session_manager.get_active_turn("thread-1", "default") is None


def test_stale_stream_task_cannot_clear_same_turn_replacement(mock_session_manager):
    """A replacement stream with the same external Turn ID remains active."""
    old_task = object()
    new_task = object()
    mock_session_manager.set_active_turn(
        "thread-1", "turn-shared", task=old_task, project_id="default"
    )
    mock_session_manager.set_active_turn(
        "thread-1", "turn-shared", task=new_task, project_id="default"
    )

    mock_session_manager.clear_active_turn(
        "thread-1", "default", "turn-shared", old_task
    )

    assert mock_session_manager.get_active_turn("thread-1", "default") == "turn-shared"
    mock_session_manager.clear_active_turn(
        "thread-1", "default", "turn-shared", new_task
    )
    assert mock_session_manager.get_active_turn("thread-1", "default") is None
