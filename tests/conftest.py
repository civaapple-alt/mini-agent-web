"""
Pytest configuration and global fixtures for mini-agent-web.
Guarantees complete isolation of server state from the user's home directory.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

from server.session_manager import session_manager


def has_app_server() -> bool:
    """Check if a usable mini-agent-app-server binary is present."""
    explicit = os.environ.get("MINI_AGENT_APP_SERVER_PATH")
    if explicit and Path(explicit).is_file():
        return True
    return shutil.which("mini-agent-app-server") is not None


def create_mock_client(project_name: str = "test-project") -> AsyncMock:
    """Construct an in-memory MockMiniAgentClient for 100% offline Gateway testing."""
    mock = AsyncMock()
    mock.initialize = AsyncMock(
        return_value={
            "serverName": "mock-app-server",
            "serverVersion": "0.7.0",
            "protocolVersion": 1,
        }
    )
    mock.set_world_execution = AsyncMock(
        return_value=SimpleNamespace(changed=False, state={})
    )
    mock.start_thread = AsyncMock(side_effect=lambda tid="default": tid)
    mock.stop = AsyncMock(return_value=None)
    mock.get_world_state = AsyncMock(
        return_value=SimpleNamespace(
            context={"project": project_name},
            lines=["Mock workspace active"],
            status="ready",
            workspace={},
        )
    )
    mock.refresh_world = AsyncMock(
        return_value=SimpleNamespace(changed=False, state={})
    )
    mock.get_mcp_status = AsyncMock(
        return_value=SimpleNamespace(
            enabled_servers=["fs-server"],
            inactive_servers=[],
            tool_count=5,
            retry_available=False,
        )
    )
    mock.retry_mcp = AsyncMock(
        return_value=SimpleNamespace(
            enabled_servers=["fs-server"],
            tool_count=5,
        )
    )
    mock.list_threads = AsyncMock(
        return_value=SimpleNamespace(
            data=["default"],
            next_cursor=None,
        )
    )
    mock.fork_thread = AsyncMock(
        side_effect=lambda source_thread_id, new_thread_id: SimpleNamespace(
            thread_id=new_thread_id
        )
    )
    mock.read_thread = AsyncMock(
        side_effect=lambda thread_id="default": SimpleNamespace(
            thread_id=thread_id,
            messages=[],
            status="idle",
            next_turn_number=1,
            raw={},
        )
    )
    mock.close_thread = AsyncMock(return_value=True)
    mock.get_workflow_state = AsyncMock(
        return_value=SimpleNamespace(
            collaboration_mode=SimpleNamespace(mode="default"),
            builtin_tools=[
                "read_file",
                "apply_patch",
                "shell",
                "read_image",
            ],
            available_builtin_tools=[
                "read_file",
                "apply_patch",
                "shell",
                "read_image",
                "web_fetch",
            ],
            goal=None,
            raw={},
        )
    )

    def mock_update_thread_settings(mode, builtin_tools=None, thread_id=None):
        tools = (
            builtin_tools
            if builtin_tools is not None
            else ["read_file", "apply_patch", "shell", "read_image"]
        )
        return SimpleNamespace(
            collaboration_mode=SimpleNamespace(mode=mode),
            builtin_tools=tools,
            available_builtin_tools=[
                "read_file",
                "apply_patch",
                "shell",
                "read_image",
                "web_fetch",
            ],
        )

    mock.update_thread_settings = AsyncMock(side_effect=mock_update_thread_settings)
    mock.__aenter__ = AsyncMock(return_value=mock)
    mock.__aexit__ = AsyncMock(return_value=None)
    return mock


@pytest_asyncio.fixture(autouse=True)
async def isolate_test_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Isolate the derived Web manifest and sessions into ~/.mini-agent-tmp."""
    real_home = Path.home()
    test_home = real_home / ".mini-agent-tmp"
    test_home.mkdir(parents=True, exist_ok=True)

    test_state_dir = test_home / "web_test_state"
    if test_state_dir.exists():
        shutil.rmtree(test_state_dir, ignore_errors=True)
    test_state_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("MINI_AGENT_WEB_STATE_DIR", str(test_state_dir))

    # App Server SessionStore follows the process home directory. Isolate it
    # too, otherwise fixed test thread IDs can collide with a user's local
    # ~/.mini-agent/sessions and make gateway tests read unrelated history.
    # Uniformly isolate test temporary files under ~/.mini-agent-tmp instead of C:/ root.
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

    if not has_app_server():

        async def mock_create_client(
            thread_id: str,
            project: dict[str, Any],
            session_mode: str,
            session_id: str | None = None,
        ) -> AsyncMock:
            proj_name = str(project.get("name") or "test-project")
            return create_mock_client(project_name=proj_name)

        monkeypatch.setattr(session_manager, "_create_client", mock_create_client)

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
