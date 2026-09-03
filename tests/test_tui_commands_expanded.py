"""
Comprehensive unit tests for TUI slash commands and autocompletion.
"""

from unittest.mock import AsyncMock

import pytest
from prompt_toolkit.document import Document

from tui.commands import handle_slash_command
from tui.completer import SlashCommandCompleter
from tui.state import TUIState


@pytest.mark.asyncio
async def test_handle_copy_slash_command(monkeypatch):
    """Test /copy and /cp with valid assistant response and empty response."""
    state = TUIState(current_thread_id="test-thread")
    state.last_assistant_response = "# Assistant Analysis\nEverything is operational."
    mock_client = AsyncMock()

    clipboard_records = []

    def mock_copy_to_clipboard(text: str) -> bool:
        clipboard_records.append(text)
        return True

    monkeypatch.setattr("tui.clipboard.copy_to_clipboard", mock_copy_to_clipboard)

    # 1. /copy copies last_assistant_response
    handled = await handle_slash_command("/copy", state, mock_client)
    assert handled is True
    assert len(clipboard_records) == 1
    assert "Assistant Analysis" in clipboard_records[0]

    # 2. /cp copies last_assistant_response
    handled_cp = await handle_slash_command("/cp", state, mock_client)
    assert handled_cp is True
    assert len(clipboard_records) == 2

    # 3. Empty assistant response
    state.last_assistant_response = None
    handled_empty = await handle_slash_command("/copy", state, mock_client)
    assert handled_empty is True
    # Clipboard not updated on empty response
    assert len(clipboard_records) == 2


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

    # Set approval scope
    handled_set_approval = await handle_slash_command(
        "/approval current_session", state, mock_client
    )
    assert handled_set_approval is True
    assert state.approval_mode == "current_session"


def test_slash_command_completer():
    """Test SlashCommandCompleter prefix matching and suggestions."""
    state = TUIState(current_thread_id="test-thread")
    completer = SlashCommandCompleter(state=state)

    # 1. Typing '/' gives list of commands
    doc_root = Document(text="/", cursor_position=1)
    completions = list(completer.get_completions(doc_root, None))
    cmds = [c.text for c in completions]
    assert "/copy" in cmds
    assert "/cp" in cmds
    assert "/help" in cmds
    assert "/steer" in cmds

    # 2. Typing '/co' gives /copy
    doc_co = Document(text="/co", cursor_position=3)
    co_completions = list(completer.get_completions(doc_co, None))
    co_cmds = [c.text for c in co_completions]
    assert "/copy" in co_cmds
    assert "/clear" not in co_cmds

    # 3. Typing '/cl' gives /clear
    doc_cl = Document(text="/cl", cursor_position=3)
    cl_completions = list(completer.get_completions(doc_cl, None))
    cl_cmds = [c.text for c in cl_completions]
    assert "/clear" in cl_cmds

    # 4. Typing '!' gives shell hints
    doc_sh = Document(text="!git", cursor_position=4)
    sh_completions = list(completer.get_completions(doc_sh, None))
    sh_cmds = [c.text for c in sh_completions]
    assert "!git status" in sh_cmds
