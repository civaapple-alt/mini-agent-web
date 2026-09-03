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
    mgr._projects_registry = {
        "default": {
            "id": "default",
            "name": "Default Project",
            "primary_path": str(tmp_path),
            "access": "project",
            "approval": "per_action",
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
        "allowedApprovalModes": ["per_action", "current_project"],
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
        access="project",
        approval="current_project",
        reason="User approved permanently",
    )
    assert resolved is True

    result = await task
    assert result.get("decision") == "approve"
    assert result.get("approval") == "current_project"


def test_session_manager_settings_persistence(mock_session_manager, tmp_path):
    """Ensure UI settings and Project execution settings persist separately."""
    mock_session_manager.set_project_execution("full_machine", "current_project")
    mock_session_manager.update_settings(
        {"reasoning_effort": "high", "auto_scroll": False}
    )

    assert mock_session_manager.project_execution() == (
        "full_machine",
        "current_project",
    )
    assert mock_session_manager.get_settings()["access"] == "full_machine"
    assert mock_session_manager.get_settings()["approval"] == "current_project"
    assert mock_session_manager._settings["reasoning_effort"] == "high"
    assert mock_session_manager._settings["auto_scroll"] is False

    # Create new manager loading from same state file
    new_mgr = SessionManager()
    new_mgr._state_dir = tmp_path
    new_mgr._state_file = mock_session_manager._state_file
    new_mgr._load_state()

    assert new_mgr.get_settings()["access"] == "full_machine"
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
