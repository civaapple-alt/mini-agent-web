"""
Event models and parsing utilities for Mini Agent Protocol event streams.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from mini_agent.types import ModelUsage, ToolCall


@dataclass
class TurnStartedEvent:
    """Emitted when a turn starts execution."""

    mode: str
    prompt: str
    type: str = "turn_started"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TurnStartedEvent:
        return cls(mode=data.get("mode", "start"), prompt=data.get("prompt", ""))


@dataclass
class RunStartedEvent:
    """Emitted when an agent harness run loop starts."""

    prompt: str
    type: str = "run_started"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RunStartedEvent:
        return cls(prompt=data.get("prompt", ""))


@dataclass
class ModelStartedEvent:
    """Emitted before a model inference step."""

    step: int
    type: str = "model_started"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ModelStartedEvent:
        return cls(step=data.get("step", 1))


@dataclass
class AssistantReasoningDeltaEvent:
    """Streaming chunk of model's internal thinking/reasoning."""

    delta: str
    type: str = "assistant_reasoning_delta"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AssistantReasoningDeltaEvent:
        return cls(delta=data.get("delta", ""))


@dataclass
class AssistantTextDeltaEvent:
    """Streaming chunk of model's response text."""

    delta: str
    type: str = "assistant_text_delta"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AssistantTextDeltaEvent:
        return cls(delta=data.get("delta", ""))


@dataclass
class ModelRespondedEvent:
    """Emitted when a full model response step is received."""

    reasoning: str
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: ModelUsage | None = None
    type: str = "model_responded"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ModelRespondedEvent:
        tool_calls = [
            ToolCall.from_dict(t) for t in data.get("tool_calls", [])
        ]
        return cls(
            reasoning=data.get("reasoning", ""),
            text=data.get("text", ""),
            tool_calls=tool_calls,
            usage=ModelUsage.from_dict(data.get("usage")),
        )


@dataclass
class ToolStartedEvent:
    """Emitted when a tool invocation begins."""

    call: ToolCall
    type: str = "tool_started"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ToolStartedEvent:
        return cls(call=ToolCall.from_dict(data.get("call", {})))


@dataclass
class ToolFinishedEvent:
    """Emitted when a tool execution settles."""

    call_id: str
    name: str
    content: str
    is_error: bool
    truncated: bool
    outcome: str | None = None
    type: str = "tool_finished"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ToolFinishedEvent:
        return cls(
            call_id=data.get("call_id") or data.get("callId", ""),
            name=data.get("name", ""),
            content=data.get("content", ""),
            is_error=data.get("is_error", False),
            truncated=data.get("truncated", False),
            outcome=data.get("outcome"),
        )


@dataclass
class TurnFinishedEvent:
    """Emitted when the turn settles with a final status."""

    status: str
    type: str = "turn_finished"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TurnFinishedEvent:
        return cls(status=data.get("status", "completed"))


@dataclass
class RunFailedEvent:
    """Emitted when a fatal harness error occurs."""

    reason: str
    type: str = "run_failed"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RunFailedEvent:
        return cls(reason=str(data.get("reason", "unknown error")))


@dataclass
class GenericEvent:
    """Fallback representation for any unmodeled event type."""

    type: str
    data: dict[str, Any]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> GenericEvent:
        return cls(type=data.get("type", "unknown"), data=data)


AgentEvent = (
    TurnStartedEvent
    | RunStartedEvent
    | ModelStartedEvent
    | AssistantReasoningDeltaEvent
    | AssistantTextDeltaEvent
    | ModelRespondedEvent
    | ToolStartedEvent
    | ToolFinishedEvent
    | TurnFinishedEvent
    | RunFailedEvent
    | GenericEvent
)

_EVENT_TYPE_MAP = {
    "turn_started": TurnStartedEvent,
    "run_started": RunStartedEvent,
    "model_started": ModelStartedEvent,
    "assistant_reasoning_delta": AssistantReasoningDeltaEvent,
    "assistant_text_delta": AssistantTextDeltaEvent,
    "model_responded": ModelRespondedEvent,
    "tool_started": ToolStartedEvent,
    "tool_finished": ToolFinishedEvent,
    "turn_finished": TurnFinishedEvent,
    "run_failed": RunFailedEvent,
}


def parse_event(data: dict[str, Any]) -> AgentEvent:
    """Parse raw dictionary into a typed AgentEvent instance."""
    event_type = data.get("type")
    parser = _EVENT_TYPE_MAP.get(event_type)
    if parser:
        return parser.from_dict(data)
    return GenericEvent.from_dict(data)
