"""Contract tests for the version 0.7.0 Python SDK event surface."""

from __future__ import annotations

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
    ThreadItem,
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
        )
    ]
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
