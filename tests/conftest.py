"""
Pytest configuration and global fixtures for mini-agent-web.
Guarantees complete isolation of server state from the user's home directory.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from server.session_manager import session_manager


@pytest.fixture(autouse=True)
def isolate_test_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Isolate SessionManager state so pytest never reads or mutates ~/.mini-agent/state.json."""
    test_state_dir = tmp_path / "mini_agent_test_state"
    test_state_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("MINI_AGENT_STATE_DIR", str(test_state_dir))

    # Backup singleton fields
    orig_state_dir = session_manager._state_dir
    orig_state_file = session_manager._state_file
    orig_checkpoints_dir = getattr(session_manager, "_checkpoints_dir", None)
    orig_projects = dict(session_manager._projects_registry)
    orig_threads = dict(session_manager._thread_metadata)
    orig_cur_id = session_manager._current_project_id
    orig_cur_path = session_manager._current_project_path
    orig_settings = dict(session_manager._settings)
    orig_builtin_tools = dict(getattr(session_manager, "_thread_builtin_tools", {}))

    # Point to isolated test state
    session_manager._state_dir = test_state_dir
    session_manager._state_file = test_state_dir / "state.json"
    session_manager._checkpoints_dir = test_state_dir / "checkpoints"
    session_manager._projects_registry = {}
    session_manager._thread_metadata = {}
    session_manager._thread_builtin_tools = {}
    session_manager._load_state()

    yield

    # Restore singleton after test finishes
    session_manager._state_dir = orig_state_dir
    session_manager._state_file = orig_state_file
    session_manager._checkpoints_dir = orig_checkpoints_dir
    session_manager._projects_registry = orig_projects
    session_manager._thread_metadata = orig_threads
    session_manager._thread_builtin_tools = orig_builtin_tools
    session_manager._current_project_id = orig_cur_id
    session_manager._current_project_path = orig_cur_path
    session_manager._settings = orig_settings
