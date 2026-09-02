"""
Unit and integration tests for SessionManager state, approvals, and projects.
"""

import asyncio

import pytest

from server.session_manager import SessionManager


@pytest.fixture
def mock_session_manager(tmp_path):
    """Create an isolated SessionManager instance using tmp_path for storage."""
    mgr = SessionManager()
    mgr._state_dir = tmp_path
    mgr._state_file = tmp_path / "state.json"
    mgr._current_project_id = "default"
    mgr._current_project_path = tmp_path
    mgr._settings["approval_policy"] = "per_action"
    mgr._projects_registry = {
        "default": {
            "id": "default",
            "name": "Default Project",
            "primary_path": str(tmp_path),
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
async def test_session_manager_approval_remember_flow(mock_session_manager):
    """Ensure remember=True registers the action name and auto-approves subsequent calls."""
    mock_session_manager._settings["approval_policy"] = "per_action"
    req_payload = {
        "requestId": "req-123",
        "action": "shell:run_command",
        "tool": "shell",
        "description": "Execute tests",
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

    # 2. Resolve approval with remember=True
    resolved = mock_session_manager.resolve_approval(
        request_id="req-123",
        decision="allow",
        reason="User approved permanently",
        remember=True,
        action_name="shell:run_command",
    )
    assert resolved is True

    result = await task
    assert result.get("decision") == "allow"
    assert "shell:run_command" in mock_session_manager._remembered_approvals

    # 3. Subsequent approval for the same action name auto-resolves immediately
    subsequent_result = await mock_session_manager._handle_approval_request(req_payload)
    assert subsequent_result.get("decision") == "approved"
    assert "Remembered" in subsequent_result.get("reason", "")
    # No pending future created
    assert len(mock_session_manager._pending_approvals) == 0


def test_session_manager_settings_persistence(mock_session_manager, tmp_path):
    """Ensure settings are persisted to state.json and retrieved accurately."""
    mock_session_manager.update_settings(
        {
            "profile": "auto",
            "approval_policy": "auto_approve",
            "reasoning_effort": "high",
            "auto_scroll": False,
        }
    )

    assert mock_session_manager._settings["profile"] == "auto"
    assert mock_session_manager._settings["approval_policy"] == "auto_approve"
    assert mock_session_manager._settings["reasoning_effort"] == "high"
    assert mock_session_manager._settings["auto_scroll"] is False

    # Create new manager loading from same state file
    new_mgr = SessionManager()
    new_mgr._state_dir = tmp_path
    new_mgr._state_file = mock_session_manager._state_file
    new_mgr._load_state()

    assert new_mgr._settings["profile"] == "auto"
    assert new_mgr._settings["reasoning_effort"] == "high"
    assert new_mgr._settings["auto_scroll"] is False


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
