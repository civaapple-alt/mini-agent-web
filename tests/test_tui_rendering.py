"""
Unit tests for Mini Agent TUI event stream rendering, error handling, telemetry, and approvals.
All tests run with zero token consumption against deterministic mock streams.
"""

from __future__ import annotations

import io
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
async def test_render_turn_stream_successful_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    output_buffer = io.StringIO()
    test_con = Console(file=output_buffer, width=120, force_terminal=False, color_system=None)
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
            "event": {"type": "assistant_reasoning_delta", "delta": "Analyzing the issue..."},
        }
        yield {
            "type": "event",
            "turnId": "turn-123",
            "event": {
                "type": "tool_started",
                "name": "shell",
                "call": {"name": "shell", "arguments": {"command": "pytest"}},
            },
        }
        yield {
            "type": "event",
            "turnId": "turn-123",
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
                "usage": {"input_tokens": 150, "output_tokens": 45, "total_tokens": 195},
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
async def test_render_turn_stream_tool_failure_and_run_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    output_buffer = io.StringIO()
    test_con = Console(file=output_buffer, width=120, force_terminal=False, color_system=None)
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
                "reason": {"type": "ExecutionLimit", "detail": "Recursion depth exceeded"},
            },
        }
        yield {
            "type": "event",
            "turnId": "turn-fail",
            "event": {"type": "turn_finished", "status": "failed"},
        }

    mock_client.stream_turn = mock_stream

    await render_turn_stream(mock_client, "Do failing task", state)
    rendered = output_buffer.getvalue()

    assert "Tool failed: readFile" in rendered
    assert "(truncated)" in rendered
    assert "FileNotFoundError: missing.txt" in rendered
    assert "Run failed: ExecutionLimit: Recursion depth exceeded" in rendered
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
    handled = await handle_slash_command("/status", state, mock_client, {"serverName": "test-srv", "serverVersion": "1.0"})
    assert handled is True
    assert "Mini Agent Runtime Status" in output_buffer.getvalue()
    assert "Completed Turns" in output_buffer.getvalue()

    # 2. /policy switch
    handled = await handle_slash_command("/policy auto_approve", state, mock_client)
    assert handled is True
    assert state.approval_policy == "auto_approve"

    # 3. /profile switch
    handled = await handle_slash_command("/profile auto", state, mock_client)
    assert handled is True
    assert state.profile == "auto"

    # 4. /clear-approvals
    state.remembered_approvals.add("shell")
    handled = await handle_slash_command("/clear-approvals", state, mock_client)
    assert handled is True
    assert len(state.remembered_approvals) == 0


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
