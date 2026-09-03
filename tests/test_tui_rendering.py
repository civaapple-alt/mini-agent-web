"""
Unit tests for Mini Agent TUI event stream rendering, error handling, telemetry, and approvals.
All tests run with zero token consumption against deterministic mock streams.
"""

from __future__ import annotations

import io
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from rich.console import Console

from tui.approvals import _ask_approval_sync
from tui.commands import handle_slash_command
from tui.state import TUIState, TurnMetrics
from tui.stream_renderer import (
    _format_args_preview,
    _format_output_preview,
    render_turn_stream,
)


@pytest.fixture
def test_console() -> tuple[Console, io.StringIO]:
    """Provide a capture console for testing TUI output strings."""
    string_io = io.StringIO()
    con = Console(file=string_io, force_terminal=False, color_system=None)
    return con, string_io


def test_format_args_preview() -> None:
    assert _format_args_preview({}) == ""
    assert _format_args_preview("{}") == ""
    assert "command='pytest'" in _format_args_preview({"command": "pytest"})
    assert "path='main.py'" in _format_args_preview('{"path": "main.py"}')


def test_format_output_preview() -> None:
    assert _format_output_preview("") == ""
    content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
    preview = _format_output_preview(content, max_lines=2)
    assert "Line 1" in preview
    assert "Line 2" in preview
    assert "5 lines total" in preview


@pytest.mark.asyncio
async def test_render_turn_stream_successful_flow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output_buffer = io.StringIO()
    test_con = Console(
        file=output_buffer, width=120, force_terminal=False, color_system=None
    )
    monkeypatch.setattr("tui.stream_renderer.console", test_con)

    state = TUIState(current_thread_id="test-thread")
    mock_client = AsyncMock()

    async def mock_stream(*args: Any, **kwargs: Any):
        yield {
            "type": "_turn_submission",
            "data": {"turn_id": "turn-123"},
        }
        yield {
            "type": "event",
            "turnId": "turn-123",
            "event": {"type": "model_started", "step": 1},
        }
        yield {
            "type": "event",
            "turnId": "turn-123",
            "event": {
                "type": "assistant_reasoning_delta",
                "delta": "Analyzing the issue...",
            },
        }
        yield {
            "type": "event",
            "turnId": "turn-123",
            "items": [
                {
                    "type": "toolCall",
                    "id": "call-123",
                    "name": "shell",
                    "arguments": {"command": "pytest"},
                    "status": "inProgress",
                }
            ],
            "event": {
                "type": "tool_started",
                "name": "shell",
                "call": {"name": "shell", "arguments": {"command": "pytest"}},
            },
        }
        yield {
            "type": "event",
            "turnId": "turn-123",
            "items": [
                {
                    "type": "toolCall",
                    "id": "call-123",
                    "name": "shell",
                    "arguments": {"command": "pytest"},
                    "status": "completed",
                    "output": "21 passed in 0.8s",
                }
            ],
            "event": {
                "type": "tool_finished",
                "name": "shell",
                "content": "21 passed in 0.8s",
                "is_error": False,
                "truncated": False,
            },
        }
        yield {
            "type": "event",
            "turnId": "turn-123",
            "event": {
                "type": "assistant_text_delta",
                "delta": "All tests are passing cleanly.",
            },
        }
        yield {
            "type": "event",
            "turnId": "turn-123",
            "event": {
                "type": "model_responded",
                "usage": {
                    "input_tokens": 150,
                    "output_tokens": 45,
                    "total_tokens": 195,
                },
            },
        }
        yield {
            "type": "event",
            "turnId": "turn-123",
            "event": {"type": "run_finished", "stop_reason": "completed", "steps": 1},
        }
        yield {
            "type": "event",
            "turnId": "turn-123",
            "event": {"type": "turn_finished", "status": "completed"},
        }

    mock_client.stream_turn = mock_stream

    await render_turn_stream(mock_client, "Run tests", state)
    rendered = output_buffer.getvalue()

    assert "Thinking:" in rendered
    assert "Analyzing the issue..." in rendered
    assert "Tool started: shell(command='pytest')" in rendered
    assert "Tool finished: shell" in rendered
    assert "21 passed in 0.8s" in rendered
    assert "All tests are passing cleanly." in rendered
    assert "Turn Settled" in rendered
    assert "Steps: 1" in rendered
    assert "Tokens: 150 in / 45 out" in rendered
    assert state.last_turn_metrics is not None
    assert state.last_turn_metrics.status == "completed"
    assert state.last_turn_metrics.steps == 1
    assert state.last_turn_metrics.total_tokens == 195


@pytest.mark.asyncio
async def test_render_turn_stream_accepts_runtime_notifications(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output_buffer = io.StringIO()
    test_con = Console(
        file=output_buffer, width=120, force_terminal=False, color_system=None
    )
    monkeypatch.setattr("tui.stream_renderer.console", test_con)

    state = TUIState(current_thread_id="goal-thread")
    mock_client = AsyncMock()

    async def mock_stream(*args: Any, **kwargs: Any):
        yield {
            "type": "notification",
            "method": "item/completed",
            "data": {
                "threadId": "goal-thread",
                "turnId": "turn-goal",
                "item": {
                    "type": "toolCall",
                    "id": "call-goal",
                    "name": "shell",
                    "status": "completed",
                    "output": "ok",
                },
            },
        }
        yield {
            "type": "notification",
            "method": "thread/goal/updated",
            "data": {"goal": {"status": "active"}},
        }
        yield {
            "type": "notification",
            "method": "thread/goal/cleared",
            "data": {"threadId": "goal-thread"},
        }

    mock_client.stream_turn = mock_stream

    await render_turn_stream(mock_client, "Observe goal updates", state)
    rendered = output_buffer.getvalue()

    assert "Goal updated: active" in rendered
    assert "Goal cleared" in rendered
    assert state.thread_items["call-goal"]["status"] == "completed"


@pytest.mark.asyncio
async def test_render_turn_stream_tool_failure_and_run_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output_buffer = io.StringIO()
    test_con = Console(
        file=output_buffer, width=120, force_terminal=False, color_system=None
    )
    monkeypatch.setattr("tui.stream_renderer.console", test_con)

    state = TUIState(current_thread_id="test-fail-thread")
    mock_client = AsyncMock()

    async def mock_stream(*args: Any, **kwargs: Any):
        yield {
            "type": "event",
            "turnId": "turn-fail",
            "event": {
                "type": "tool_finished",
                "name": "readFile",
                "content": "FileNotFoundError: missing.txt",
                "is_error": True,
                "truncated": True,
            },
        }
        yield {
            "type": "event",
            "turnId": "turn-fail",
            "event": {
                "type": "run_failed",
                "reason": {
                    "type": "ExecutionLimit",
                    "detail": "Recursion depth exceeded",
                },
            },
        }
        yield {
            "type": "event",
            "turnId": "turn-fail",
            "event": {"type": "turn_finished", "status": "failed"},
        }

    mock_client.stream_turn = mock_stream
    mock_client.read_turn.return_value = SimpleNamespace(
        error="model request failed: provider returned HTTP 503"
    )

    await render_turn_stream(mock_client, "Do failing task", state)
    rendered = output_buffer.getvalue()

    assert "Tool failed: readFile" in rendered
    assert "(truncated)" in rendered
    assert "FileNotFoundError: missing.txt" in rendered
    assert "Run failed: ExecutionLimit: Recursion depth exceeded" in rendered
    assert "Detail: model request failed: provider returned HTTP 503" in rendered
    mock_client.read_turn.assert_awaited_once_with("turn-fail")
    assert "Turn Settled" in rendered
    assert "Status: failed" in rendered
    assert state.last_turn_metrics is not None
    assert state.last_turn_metrics.status == "failed"


@pytest.mark.asyncio
async def test_handle_slash_commands(monkeypatch: pytest.MonkeyPatch) -> None:
    output_buffer = io.StringIO()
    test_con = Console(file=output_buffer, force_terminal=False, color_system=None)
    monkeypatch.setattr("tui.commands.console", test_con)

    state = TUIState(current_thread_id="cmd-test")
    state.last_turn_metrics = TurnMetrics(status="completed", steps=3, total_tokens=500)
    mock_client = AsyncMock()

    # 1. /status
    handled = await handle_slash_command(
        "/status",
        state,
        mock_client,
        {"serverName": "test-srv", "serverVersion": "1.0"},
    )
    assert handled is True
    assert "Mini Agent Runtime Status" in output_buffer.getvalue()
    assert "Completed Turns" in output_buffer.getvalue()

    # 2. /policy switch
    handled = await handle_slash_command("/policy auto_approve", state, mock_client)
    assert handled is True
    assert state.approval_policy == "auto_approve"

    # 3. /profile switch
    state.runtime_thread_id = "runtime-thread"
    handled = await handle_slash_command("/profile auto", state, mock_client)
    assert handled is True
    assert state.profile == "auto"
    mock_client.set_collaboration_mode.assert_awaited_once_with(
        "default", thread_id="runtime-thread"
    )

    # 4. /clear-approvals
    state.remembered_approvals.add("shell")
    handled = await handle_slash_command("/clear-approvals", state, mock_client)
    assert handled is True
    assert len(state.remembered_approvals) == 0

    # 5. Unknown slash command interception
    handled = await handle_slash_command("/hepl", state, mock_client)
    assert handled is True
    assert "Unknown command: /hepl" in output_buffer.getvalue()

    # 6. /steer while idle
    state.active_turn_id = None
    handled = await handle_slash_command("/steer focus on auth", state, mock_client)
    assert handled is True
    assert "No active turn is currently running to steer" in output_buffer.getvalue()

    # 7. /history with message playback
    mock_checkpoint = AsyncMock()
    mock_checkpoint.status = "idle"
    mock_checkpoint.messages = [
        {"role": "user", "text": "Fix bug"},
        {"role": "assistant", "text": "Bug fixed successfully in auth.py"},
    ]
    mock_client.read_thread = AsyncMock(return_value=mock_checkpoint)
    handled = await handle_slash_command("/history 5", state, mock_client)
    assert handled is True
    assert "Thread Checkpoint" in output_buffer.getvalue()
    assert "Bug fixed successfully" in output_buffer.getvalue()

    # 8. ! shell command execution
    handled = await handle_slash_command("!echo test_shell_output", state, mock_client)
    assert handled is True
    assert "Executing shell command: echo test_shell_output" in output_buffer.getvalue()
    assert "Command succeeded" in output_buffer.getvalue()

    # 9. ! empty command
    handled = await handle_slash_command("!", state, mock_client)
    assert handled is True
    assert "Usage: !<shell_command>" in output_buffer.getvalue()

    # 10. /copy command
    state.last_assistant_response = "# Summary\n\nTask completed successfully."
    monkeypatch.setattr("tui.clipboard.copy_to_clipboard", lambda text: True)
    handled = await handle_slash_command("/copy", state, mock_client)
    assert handled is True
    assert "Copied latest assistant response" in output_buffer.getvalue()

    # 11. /cp alias command
    handled = await handle_slash_command("/cp", state, mock_client)
    assert handled is True


def test_ask_approval_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    output_buffer = io.StringIO()
    test_con = Console(file=output_buffer, force_terminal=False, color_system=None)
    monkeypatch.setattr("tui.approvals.console", test_con)

    # 1. auto_approve policy
    state_auto = TUIState(approval_policy="auto_approve")
    decision = _ask_approval_sync(state_auto, "Run cmd", "req-1", "shell")
    assert decision == "approved"

    # 2. strict policy
    state_strict = TUIState(approval_policy="strict")
    decision = _ask_approval_sync(state_strict, "Run cmd", "req-2", "shell")
    assert decision == "denied"

    # 3. remembered approval
    state_mem = TUIState(approval_policy="per_action")
    state_mem.remembered_approvals.add("read_file")
    decision = _ask_approval_sync(state_mem, "Read file", "req-3", "read_file")
    assert decision == "approved"
