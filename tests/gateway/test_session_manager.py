"""
Unit and integration tests for SessionManager state, approvals, and projects.
"""

import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from server.session_catalog import SessionCatalog, _session_base
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
    mock_session_manager._thread_continuation_modes["goal-thread"] = "continuous"
    canonical = {
        "session": {
            "goal": {"status": "active"},
            "plan_active": False,
        }
    }
    monkeypatch.setattr(
        mock_session_manager,
        "read_project_thread",
        lambda thread_id, project_id=None: canonical,
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
    mock_session_manager._thread_continuation_modes["goal-thread"] = "continuous"
    monkeypatch.setattr(
        mock_session_manager,
        "read_project_thread",
        lambda thread_id, project_id=None: {"session": {"plan_active": False}},
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
    home = tmp_path / "home"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setenv("USERPROFILE", str(home))
    session_dir = _session_base(workspace) / "s-1"
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
    (_session_base(workspace) / "thread_index.json").write_text(
        json.dumps(
            {"version": 1, "threads": {"t-1": {"session_id": "s-1"}}}
        ),
        encoding="utf-8",
    )
    (session_dir / "session.lock").write_text("pid=999999\n", encoding="utf-8")
    monkeypatch.setattr("server.session_catalog._process_alive", lambda pid: False)

    catalog = SessionCatalog()
    listed = catalog.list_sessions(workspace, "project-1")
    assert listed["data"][0]["thread_id"] == "t-1"
    assert listed["data"][0]["session_status"] == "historical"
    assert listed["data"][0]["resumable"] is True
    assert listed["data"][0]["locked_by"] is None
    assert listed["data"][0]["last_turn_status"] == "step_limit"
    assert listed["data"][0]["last_stop_reason"] == "step_limit"
    assert listed["data"][0]["last_turn_error"] == "model request failed: transport error"
    assert listed["data"][0]["last_turn_id"] == "turn-1"
    assert listed["data"][0]["last_turn_steps"] == 8
    assert listed["data"][0]["last_turn_complete"] is False
    history = catalog.read_thread(workspace, "project-1", "t-1")
    assert history["messages"][0]["text"] == "inspect project"
    assert history["items"][0]["item"]["type"] == "userMessage"
    assert history["last_turn_status"] == "step_limit"
    assert history["last_turn_error"] == "model request failed: transport error"
    assert history["last_turn_id"] == "turn-1"


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
    assert entry["resumable"] is True
    assert entry["goal_status"] == "paused"


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
