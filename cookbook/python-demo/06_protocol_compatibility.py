"""Demo 06: Protocol Compatibility Smoke Test.

This deterministic example uses no App Server process and no model provider.
It validates that the 0.7.0 SDK parses public lifecycle events and bounded
ThreadItem projections, including context compaction and structured run failures.
"""

from mini_agent import (
    ContextCompactionFinishedEvent,
    ContextCompactionStartedEvent,
    GenericEvent,
    RunFailedEvent,
    RunFinishedEvent,
    ThreadItem,
    parse_event,
)

EVENT_FIXTURES = [
    {"type": "turn_started", "mode": "start", "prompt": "compatibility"},
    {"type": "run_started", "prompt": "compatibility"},
    {"type": "model_started", "step": 1},
    {"type": "assistant_reasoning_delta", "delta": "thinking"},
    {"type": "assistant_text_delta", "delta": "answer"},
    {
        "type": "model_responded",
        "reasoning": "",
        "text": "answer",
        "tool_calls": [],
        "usage": None,
    },
    {
        "type": "tool_started",
        "call": {"id": "call-1", "name": "shell", "arguments": "{}"},
    },
    {
        "type": "tool_finished",
        "call_id": "call-1",
        "name": "shell",
        "content": "ok",
        "is_error": False,
        "truncated": False,
        "outcome": "completed",
    },
    {"type": "context_compaction_started", "before_bytes": 1000},
    {
        "type": "context_compaction_finished",
        "before_bytes": 1000,
        "after_bytes": 500,
        "usage": None,
    },
    {"type": "run_finished", "stop_reason": "completed", "steps": 1},
    {"type": "turn_finished", "status": "completed"},
    {
        "type": "run_failed",
        "reason": {"type": "limit_exceeded", "detail": {"actual": 2}},
    },
    {"type": "future_extension", "value": "preserved"},
]

THREAD_ITEM_FIXTURE = {
    "type": "toolCall",
    "id": "call-compat-1",
    "name": "shell",
    "arguments": {"command": "pwd"},
    "status": "completed",
    "output": "workspace",
}


def main() -> None:
    for payload in EVENT_FIXTURES:
        event = parse_event(payload)
        assert event.event_type == payload["type"]
        print(f"PASS {event.event_type}")

    assert isinstance(parse_event(EVENT_FIXTURES[8]), ContextCompactionStartedEvent)
    assert isinstance(parse_event(EVENT_FIXTURES[9]), ContextCompactionFinishedEvent)
    assert isinstance(parse_event(EVENT_FIXTURES[10]), RunFinishedEvent)
    assert isinstance(parse_event(EVENT_FIXTURES[12]), RunFailedEvent)
    assert isinstance(parse_event(EVENT_FIXTURES[13]), GenericEvent)
    item = ThreadItem.from_dict(THREAD_ITEM_FIXTURE)
    assert item.id == "call-compat-1"
    assert item.arguments == {"command": "pwd"}
    assert item.output == "workspace"
    print(f"Validated {len(EVENT_FIXTURES)} protocol event fixtures.")


if __name__ == "__main__":
    main()
