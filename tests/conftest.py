"""
Pytest configuration and global fixtures for mini-agent-web.
Guarantees complete isolation of server state from the user's home directory.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
import pytest_asyncio

from server.session_manager import session_manager


@pytest_asyncio.fixture(autouse=True)
async def isolate_test_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Isolate the derived Web manifest from the user's ~/.mini-agent/web state."""
    test_state_dir = tmp_path / "mini_agent_test_state"
    test_state_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("MINI_AGENT_WEB_STATE_DIR", str(test_state_dir))
    # App Server SessionStore follows the process home directory. Isolate it
    # too, otherwise fixed test thread IDs can collide with a user's local
    # ~/.mini-agent/sessions and make gateway tests read unrelated history.
    # Keep the synthetic home short: Rust's canonical SessionStore encodes the
    # absolute workspace path into a Windows directory name with a 240-byte
    # bound, and pytest's nested temp paths can otherwise exceed MAX_PATH.
    test_home = Path("C:/m")
    test_home.mkdir(parents=True, exist_ok=True)
    sessions_dir = test_home / ".mini-agent" / "sessions"
    if sessions_dir.exists():
        shutil.rmtree(sessions_dir, ignore_errors=True)
    monkeypatch.setenv("USERPROFILE", str(test_home))
    monkeypatch.setenv("HOME", str(test_home))
    # Initialization validates provider settings even when tests never invoke
    # a real model. Use non-secret test values so home isolation cannot hide a
    # developer's environment-backed credentials and no paid call is possible.
    monkeypatch.setenv("OPENAI_API_KEY", "mini-agent-test-key")
    monkeypatch.setenv("OPENAI_MODEL", "mini-agent-test-model")
    local_server = (
        Path(__file__).parents[1].parent
        / "mini-codex"
        / "target"
        / "debug"
        / "mini-agent-app-server.exe"
    )
    if local_server.is_file():
        monkeypatch.setenv("MINI_AGENT_APP_SERVER_PATH", str(local_server))

    # Backup singleton fields
    orig_state_dir = session_manager._state_dir
    orig_state_file = session_manager._state_file
    orig_projects = dict(session_manager._projects_registry)
    orig_threads = dict(session_manager._thread_metadata)
    orig_client = session_manager._client
    orig_clients = dict(session_manager._clients)
    orig_cur_id = session_manager._current_project_id
    orig_cur_path = session_manager._current_project_path
    orig_settings = dict(session_manager._settings)
    orig_builtin_tools = dict(getattr(session_manager, "_thread_builtin_tools", {}))

    # Point to isolated test state
    session_manager._state_dir = test_state_dir
    session_manager._state_file = test_state_dir / "state.json"
    session_manager._projects_registry = {}
    session_manager._thread_metadata = {}
    session_manager._thread_builtin_tools = {}
    session_manager._load_state()

    yield

    # Close clients created by this test before its event loop is torn down.
    # Otherwise Windows' Proactor subprocess transports can outlive the loop
    # and report unclosed pipes even though all assertions passed.
    original_clients = {id(client) for client in orig_clients.values()}
    if orig_client is not None:
        original_clients.add(id(orig_client))
    current_clients = list(session_manager._clients.values())
    if session_manager._client is not None:
        current_clients.append(session_manager._client)
    seen_clients: set[int] = set()
    for client in current_clients:
        if id(client) in original_clients or id(client) in seen_clients:
            continue
        seen_clients.add(id(client))
        try:
            await client.stop()
        except Exception:  # noqa: BLE001, S110
            pass

    # Restore singleton after test finishes
    session_manager._state_dir = orig_state_dir
    session_manager._state_file = orig_state_file
    session_manager._projects_registry = orig_projects
    session_manager._thread_metadata = orig_threads
    session_manager._client = orig_client
    session_manager._clients = orig_clients
    session_manager._thread_builtin_tools = orig_builtin_tools
    session_manager._current_project_id = orig_cur_id
    session_manager._current_project_path = orig_cur_path
    session_manager._settings = orig_settings
