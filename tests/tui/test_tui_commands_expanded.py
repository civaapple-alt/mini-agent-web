"""
Comprehensive unit tests for TUI slash commands and autocompletion.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from prompt_toolkit.document import Document

from tui.commands import handle_slash_command
from tui.completer import SlashCommandCompleter
from tui.state import TUIState
from tui.tui_app import _configure_session_recovery, _restart_tui_client


def test_tui_session_recovery_defaults_preserve_explicit_configuration():
    client = SimpleNamespace(env={})

    _configure_session_recovery(client, "thread-1")

    assert client.env == {
        "MINI_AGENT_SESSION_MODE": "new",
        "MINI_AGENT_THREAD_ID": "thread-1",
    }

    configured = SimpleNamespace(
        env={
            "MINI_AGENT_SESSION_MODE": "disabled",
            "MINI_AGENT_THREAD_ID": "configured-thread",
        }
    )
    _configure_session_recovery(configured, "thread-1")

    assert configured.env["MINI_AGENT_SESSION_MODE"] == "disabled"
    assert configured.env["MINI_AGENT_THREAD_ID"] == "configured-thread"


@pytest.mark.asyncio
async def test_tui_reconnect_selects_the_restored_session_thread():
    client = SimpleNamespace(
        restart=AsyncMock(), start_thread=AsyncMock(return_value="session-thread")
    )
    state = TUIState(current_thread_id="memory-only-branch")

    await _restart_tui_client(client, state)

    client.restart.assert_awaited_once_with()
    client.start_thread.assert_awaited_once_with()
    assert state.current_thread_id == "session-thread"


@pytest.mark.asyncio
async def test_handle_help_and_exit_slash_commands():
    """Test /help, /exit, and /quit."""
    state = TUIState(current_thread_id="test-thread")
    mock_client = AsyncMock()

    handled_help = await handle_slash_command("/help", state, mock_client)
    assert handled_help is True

    # /exit should raise SystemExit
    with pytest.raises(SystemExit):
        await handle_slash_command("/exit", state, mock_client)

    # /quit should raise SystemExit
    with pytest.raises(SystemExit):
        await handle_slash_command("/quit", state, mock_client)


@pytest.mark.asyncio
async def test_handle_effort_and_approval_commands():
    """Test /effort and /approval commands."""
    state = TUIState(current_thread_id="test-thread")
    mock_client = AsyncMock()

    # View effort
    handled_effort = await handle_slash_command("/effort", state, mock_client)
    assert handled_effort is True

    # Set effort
    handled_set_effort = await handle_slash_command("/effort high", state, mock_client)
    assert handled_set_effort is True
    assert state.effort == "high"

    # Set approval policy
    handled_set_approval = await handle_slash_command(
        "/approval automatic", state, mock_client
    )
    assert handled_set_approval is True
    assert state.policy == "automatic"
    mock_client.set_world_execution.assert_awaited_once_with("project", "automatic")

    # Plan is addressed to the selected Thread, not a hidden runtime alias.
    mock_client.set_collaboration_mode.return_value = SimpleNamespace(
        collaboration_mode=SimpleNamespace(mode="plan")
    )
    handled_plan = await handle_slash_command("/plan on", state, mock_client)
    assert handled_plan is True
    mock_client.set_collaboration_mode.assert_awaited_once_with(
        "plan", thread_id="test-thread"
    )


def test_slash_command_completer():
    """Test SlashCommandCompleter prefix matching and suggestions."""
    state = TUIState(current_thread_id="test-thread")
    completer = SlashCommandCompleter(state=state)

    # 1. Typing '/' gives list of commands
    doc_root = Document(text="/", cursor_position=1)
    completions = list(completer.get_completions(doc_root, None))
    cmds = [c.text for c in completions]
    assert "/help" in cmds
    assert "/steer" in cmds

    # 2. Removed local convenience commands are not TUI controls.
    doc_co = Document(text="/co", cursor_position=3)
    co_completions = list(completer.get_completions(doc_co, None))
    co_cmds = [c.text for c in co_completions]
    assert co_cmds == []
    assert "/clear" not in co_cmds

    # 3. Typing '/cl' gives /clear
    doc_cl = Document(text="/cl", cursor_position=3)
    cl_completions = list(completer.get_completions(doc_cl, None))
    cl_cmds = [c.text for c in cl_completions]
    assert "/clear" in cl_cmds

    # 4. Shell escape is not a TUI bypass path.
    doc_sh = Document(text="!git", cursor_position=4)
    sh_completions = list(completer.get_completions(doc_sh, None))
    sh_cmds = [c.text for c in sh_completions]
    assert sh_cmds == []
