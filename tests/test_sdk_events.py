"""Contract tests for the version 0.6.0 Python SDK event surface."""

from __future__ import annotations

import pytest
from mini_agent import (
    AssistantTextDeltaEvent,
    ContextCompactionFinishedEvent,
    ContextCompactionStartedEvent,
    GenericEvent,
    MiniAgentClient,
    ModelUsage,
    RunFailedEvent,
    RunFailure,
    RunFinishedEvent,
    ToolFinishedEvent,
    TurnFinishedEvent,
    TurnSubmissionResult,
    parse_event,
)


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
    text_event = await anext(stream)
    finished_event = await anext(stream)
    with pytest.raises(StopAsyncIteration):
        await anext(stream)

    assert approval_event["approval"]["phase"] == "requested"
    assert text_event["event"] == {"type": "assistant_text_delta", "delta": "right"}
    assert finished_event["event"] == {
        "type": "turn_finished",
        "status": "completed",
    }


@pytest.mark.asyncio
async def test_stream_turn_returns_when_submission_has_no_turn_id():
    client = MiniAgentClient()

    async def fake_start_turn(prompt, mode="start", thread_id=None):
        return TurnSubmissionResult(status="queued")

    client.start_turn = fake_start_turn

    items = [item async for item in client.stream_turn("hello")]

    assert len(items) == 1
    assert items[0]["data"]["status"] == "queued"
