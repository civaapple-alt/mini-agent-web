"""Contract tests for the version 0.7.0 Python SDK event surface."""

from __future__ import annotations

import asyncio

import pytest
from mini_agent import (
    AssistantTextDeltaEvent,
    ContextCompactionFinishedEvent,
    ContextCompactionStartedEvent,
    GenericEvent,
    ItemLifecycleNotification,
    MiniAgentClient,
    ModelUsage,
    RunFailedEvent,
    RunFailure,
    RunFinishedEvent,
    ServerProcessError,
    ThreadItem,
    ToolFinishedEvent,
    TurnFinishedEvent,
    TurnReadResult,
    TurnSubmissionResult,
    parse_event,
)
from mini_agent.client import APP_SERVER_STDIO_LINE_LIMIT


@pytest.mark.parametrize(
    ("payload", "event_class"),
    [
        (
            {"type": "assistant_text_delta", "delta": "hello"},
            AssistantTextDeltaEvent,
        ),
        (
            {"type": "context_compaction_started", "before_bytes": 1200},
            ContextCompactionStartedEvent,
        ),
        (
            {
                "type": "context_compaction_finished",
                "before_bytes": 1200,
                "after_bytes": 600,
                "usage": {"input_tokens": 10, "output_tokens": 4},
            },
            ContextCompactionFinishedEvent,
        ),
        (
            {"type": "run_finished", "stop_reason": "completed", "steps": 2},
            RunFinishedEvent,
        ),
        (
            {
                "type": "run_failed",
                "reason": {"type": "limit_exceeded", "detail": {"actual": 9}},
            },
            RunFailedEvent,
        ),
        (
            {
                "type": "tool_finished",
                "call_id": "call-1",
                "name": "shell",
                "content": "ok",
                "is_error": False,
                "truncated": False,
                "outcome": "completed",
            },
            ToolFinishedEvent,
        ),
        ({"type": "turn_finished", "status": "completed"}, TurnFinishedEvent),
        ({"type": "future_event", "value": 1}, GenericEvent),
    ],
)
def test_parse_event_matches_protocol_event_surface(payload, event_class):
    event = parse_event(payload)

    assert isinstance(event, event_class)
    assert event.event_type == payload["type"]

    if isinstance(event, ContextCompactionFinishedEvent):
        assert event.usage == ModelUsage(
            input_tokens=10, output_tokens=4, total_tokens=14
        )
    if isinstance(event, RunFailedEvent):
        assert event.reason == RunFailure(type="limit_exceeded", detail={"actual": 9})


@pytest.mark.asyncio
async def test_stream_turn_filters_events_by_thread_and_turn():
    client = MiniAgentClient()

    async def fake_start_turn(prompt, mode="start", thread_id=None):
        return TurnSubmissionResult(status="started", turn_id="turn-1")

    client.start_turn = fake_start_turn
    stream = client.stream_turn("hello", thread_id="thread-1")

    submission = await anext(stream)
    assert submission["data"]["turn_id"] == "turn-1"

    queue = client._event_queues[0]
    await queue.put(
        {
            "type": "approval",
            "approval": {
                "phase": "requested",
                "requestId": "approval-1",
                "threadId": "thread-1",
                "action": "shell command pwd",
            },
        }
    )
    await queue.put(
        {
            "type": "notification",
            "method": "item/completed",
            "data": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "completedAtMs": 20,
                "item": {
                    "type": "toolCall",
                    "id": "call-1",
                    "name": "shell",
                    "arguments": {"command": "pwd"},
                    "status": "completed",
                    "outcome": "completed",
                    "output": "C:/workspace",
                },
            },
        }
    )
    await queue.put(
        {
            "threadId": "other-thread",
            "turnId": "other-turn",
            "sequence": 1,
            "event": {"type": "assistant_text_delta", "delta": "wrong"},
        }
    )
    await queue.put(
        {
            "threadId": "thread-1",
            "turnId": "turn-1",
            "sequence": 2,
            "items": [
                {
                    "type": "toolCall",
                    "id": "call-1",
                    "name": "shell",
                    "arguments": {"command": "pwd"},
                    "status": "inProgress",
                }
            ],
            "event": {"type": "assistant_text_delta", "delta": "right"},
        }
    )
    await queue.put(
        {
            "threadId": "thread-1",
            "turnId": "turn-1",
            "sequence": 3,
            "event": {"type": "turn_finished", "status": "completed"},
        }
    )

    approval_event = await anext(stream)
    item_event = await anext(stream)
    text_event = await anext(stream)
    finished_event = await anext(stream)
    with pytest.raises(StopAsyncIteration):
        await anext(stream)

    assert approval_event["approval"]["phase"] == "requested"
    assert item_event["typed_item_notification"].item.id == "call-1"
    assert text_event["event"] == {"type": "assistant_text_delta", "delta": "right"}
    assert text_event["typed_items"] == [
        ThreadItem(
            type="toolCall",
            id="call-1",
            name="shell",
            arguments={"command": "pwd"},
            status="inProgress",
            outcome=None,
        )
    ]
    assert finished_event["event"] == {
        "type": "turn_finished",
        "status": "completed",
    }


@pytest.mark.asyncio
async def test_read_loop_relays_turn_events_to_notification_handler_in_order():
    received = []

    async def handler(notification):
        received.append(notification)

    class FakeStdout:
        def __init__(self):
            self._lines = iter(
                [
                    (
                        b'{"jsonrpc":"2.0","method":"turn/event","params":'
                        b'{"threadId":"thread-1","sequence":7,"event":{"type":"run_started"}}}\n'
                    )
                ]
            )

        async def readline(self):
            return next(self._lines, b"")

    client = MiniAgentClient(notification_handler=handler)
    client._proc = type("FakeProcess", (), {"stdout": FakeStdout()})()

    await client._read_loop()

    assert received == [
        {
            "type": "event",
            "threadId": "thread-1",
            "sequence": 7,
            "event": {"type": "run_started"},
        },
        {
            "type": "runtime_error",
            "threadId": "default",
            "message": "App Server connection closed before stream settlement",
        },
    ]


@pytest.mark.asyncio
async def test_read_loop_settles_event_queues_when_stdout_closes():
    """EOF wakes stream consumers so a dead App Server cannot leave a Turn hung."""

    class FakeStdout:
        async def readline(self):
            return b""

    client = MiniAgentClient()
    client._proc = type("FakeProcess", (), {"stdout": FakeStdout()})()
    event_queue = asyncio.Queue()
    client._event_queues.append(event_queue)

    await client._read_loop()

    assert await event_queue.get() == {
        "type": "_client_error",
        "message": "App Server connection closed before stream settlement",
    }


@pytest.mark.asyncio
async def test_read_loop_settles_event_queues_when_stdout_fails():
    """A transport read error also wakes consumers instead of leaking a task."""

    class BrokenStdout:
        async def readline(self):
            raise ConnectionResetError("pipe reset")

    client = MiniAgentClient()
    client._proc = type("FakeProcess", (), {"stdout": BrokenStdout()})()
    event_queue = asyncio.Queue()
    client._event_queues.append(event_queue)

    await client._read_loop()

    failure = await event_queue.get()
    assert failure["type"] == "_client_error"
    assert "pipe reset" in failure["message"]


@pytest.mark.asyncio
async def test_read_loop_reaps_process_after_stdout_failure():
    """A failed reader must not leave a live-looking client on a dead pipe."""

    class BrokenStdout:
        async def readline(self):
            raise ConnectionResetError("pipe reset")

    class FailedProcess:
        def __init__(self):
            self.stdout = BrokenStdout()
            self.returncode = None
            self.terminated = False

        def terminate(self):
            self.terminated = True
            self.returncode = 1

        async def wait(self):
            return self.returncode

        def kill(self):
            self.returncode = -9

    client = MiniAgentClient()
    process = FailedProcess()
    client._proc = process

    await client._read_loop()

    assert process.terminated is True
    assert client.is_running is False
    assert client._proc is None


@pytest.mark.asyncio
async def test_start_sets_stdio_line_limit_above_session_record_bound(monkeypatch):
    """Valid large checkpoint responses must fit the SDK stdout reader."""

    class FakeStream:
        async def readline(self):
            return b""

    class FakeStdin:
        def is_closing(self):
            return False

        def close(self):
            return None

    class FakeProcess:
        def __init__(self):
            self.pid = 1234
            self.returncode = None
            self.stdin = FakeStdin()
            self.stdout = FakeStream()
            self.stderr = FakeStream()

        def terminate(self):
            self.returncode = 0

        async def wait(self):
            return self.returncode

    process = FakeProcess()
    captured = {}

    async def fake_create_subprocess(*args, **kwargs):
        captured.update(kwargs)
        return process

    monkeypatch.setattr(
        "mini_agent.client.asyncio.create_subprocess_exec",
        fake_create_subprocess,
    )

    client = MiniAgentClient()
    await client.start()
    await client.stop()

    assert captured["limit"] == APP_SERVER_STDIO_LINE_LIMIT
    assert APP_SERVER_STDIO_LINE_LIMIT > 512 * 1024


@pytest.mark.asyncio
async def test_sdk_settings_projection_rejects_stale_revision_notifications():
    class FakeStdout:
        def __init__(self, lines):
            self._lines = iter(lines)

        async def readline(self):
            return next(self._lines, b"")

    class FakeProcess:
        stdout = FakeStdout(
            [
                (
                    b'{"jsonrpc":"2.0","method":"thread/settings/updated",'
                    b'"params":{"threadId":"thread-1","collaborationMode":'
                    b'{"mode":"plan"},"builtinTools":["shell"],'
                    b'"continuationMode":"continuous","stateRevision":5}}\n'
                ),
                (
                    b'{"jsonrpc":"2.0","method":"thread/settings/updated",'
                    b'"params":{"threadId":"thread-1","collaborationMode":'
                    b'{"mode":"default"},"builtinTools":[],'
                    b'"continuationMode":"manual","stateRevision":4}}\n'
                ),
            ]
        )

    client = MiniAgentClient()
    client._proc = FakeProcess()
    await client._read_loop()

    settings = client._thread_settings["thread-1"]
    assert settings.state_revision == 5
    assert settings.continuation_mode == "continuous"


@pytest.mark.asyncio
async def test_stream_turn_returns_when_submission_has_no_turn_id():
    client = MiniAgentClient()

    async def fake_start_turn(prompt, mode="start", thread_id=None):
        return TurnSubmissionResult(status="queued")

    client.start_turn = fake_start_turn

    items = [item async for item in client.stream_turn("hello")]

    assert len(items) == 1
    assert items[0]["data"]["status"] == "queued"


@pytest.mark.asyncio
async def test_stream_turn_fails_when_app_server_connection_closes():
    """A dead App Server must settle the consumer instead of leaving it hung."""
    client = MiniAgentClient()

    async def fake_start_turn(prompt, mode="start", thread_id=None):
        return TurnSubmissionResult(status="started", turn_id="turn-disconnected")

    client.start_turn = fake_start_turn
    stream = client.stream_turn("inspect", thread_id="thread-1")
    await anext(stream)
    await client._event_queues[0].put(
        {
            "type": "_client_error",
            "message": "App Server connection closed before stream settlement",
        }
    )

    with pytest.raises(ServerProcessError, match="connection closed"):
        await anext(stream)


@pytest.mark.asyncio
async def test_stream_turn_preserves_step_limit_as_non_completed():
    client = MiniAgentClient()

    async def fake_start_turn(prompt, mode="start", thread_id=None):
        return TurnSubmissionResult(status="started", turn_id="turn-limited")

    client.start_turn = fake_start_turn
    stream = client.stream_turn("inspect", thread_id="thread-1")
    await anext(stream)

    await client._event_queues[0].put(
        {
            "threadId": "thread-1",
            "turnId": "turn-limited",
            "event": {
                "type": "turn_finished",
                "status": "step_limit",
            },
        }
    )

    finished = await anext(stream)
    assert finished["event"]["status"] == "step_limit"
    with pytest.raises(StopAsyncIteration):
        await anext(stream)


@pytest.mark.asyncio
async def test_stream_turn_waits_for_settlement_after_run_failed():
    client = MiniAgentClient()

    async def fake_start_turn(prompt, mode="start", thread_id=None):
        return TurnSubmissionResult(status="started", turn_id="turn-failed")

    async def fake_read_turn(turn_id):
        return TurnReadResult(
            turn_id=turn_id,
            status="failed",
            stop_reason="failed",
            error="model request failed: transport error",
        )

    client.start_turn = fake_start_turn
    client.read_turn = fake_read_turn
    stream = client.stream_turn("inspect", thread_id="thread-1")
    await anext(stream)

    await client._event_queues[0].put(
        {
            "threadId": "thread-1",
            "turnId": "turn-failed",
            "event": {
                "type": "run_failed",
                "reason": {"type": "model"},
            },
        }
    )
    await client._event_queues[0].put(
        {
            "threadId": "thread-1",
            "turnId": "turn-failed",
            "event": {"type": "turn_finished", "status": "failed"},
        }
    )

    failed = await anext(stream)
    finished = await anext(stream)
    with pytest.raises(StopAsyncIteration):
        await anext(stream)

    assert failed["event"]["status"] == "failed"
    assert failed["event"]["error"] == "model request failed: transport error"
    assert finished["event"] == {"type": "turn_finished", "status": "failed"}


def test_thread_item_lifecycle_and_list_projection_parse_camel_case_wire_shape():
    started = ItemLifecycleNotification.from_dict(
        "item/started",
        {
            "threadId": "thread-1",
            "turnId": "turn-1",
            "startedAtMs": 10,
            "item": {
                "type": "toolCall",
                "id": "call-1",
                "name": "shell",
                "arguments": {"command": "pwd"},
                "status": "inProgress",
            },
        },
    )
    assert started.thread_id == "thread-1"
    assert started.timestamp_ms == 10
    assert started.item.status == "inProgress"


def test_thread_item_preserves_typed_tool_outcome():
    item = ThreadItem.from_dict(
        {
            "type": "toolCall",
            "id": "call-retry",
            "name": "mcp__fixture__slow",
            "arguments": {"query": "status"},
            "status": "failed",
            "outcome": "retryable",
            "output": "MCP tool call timed out",
        }
    )

    assert item.status == "failed"
    assert item.outcome == "retryable"

    unknown = ThreadItem.from_dict(
        {
            "type": "toolCall",
            "id": "call-future",
            "status": "failed",
            "outcome": "server_added_state",
        }
    )
    assert unknown.outcome == "server_added_state"

    malformed = ThreadItem.from_dict(
        {"type": "toolCall", "id": "call-malformed", "outcome": {"name": "bad"}}
    )
    assert malformed.outcome is None

    from mini_agent import ThreadItemsListResult

    page = ThreadItemsListResult.from_dict(
        {
            "value": {
                "data": [
                    {
                        "turnId": "turn-1",
                        "item": {
                            "type": "agentMessage",
                            "id": "message-1",
                            "text": "done",
                        },
                    }
                ],
                "nextCursor": "1",
                "backwardsCursor": "0",
            }
        }
    )
    assert page.data[0].turn_id == "turn-1"
    assert page.data[0].item.text == "done"
    assert page.next_cursor == "1"
    assert page.backwards_cursor == "0"


@pytest.mark.parametrize(
    "outcome",
    [
        "completed",
        "failed",
        "needs_approval",
        "deferred",
        "retryable",
        "server_added_outcome",
    ],
)
def test_tool_finished_preserves_known_and_unknown_outcomes(outcome):
    event = parse_event(
        {
            "type": "tool_finished",
            "call_id": "call-outcome",
            "name": "fixture",
            "content": "fixture",
            "is_error": True,
            "truncated": False,
            "outcome": outcome,
        }
    )

    assert isinstance(event, ToolFinishedEvent)
    assert event.outcome == outcome
