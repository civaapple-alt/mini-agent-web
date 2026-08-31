"""
Type definitions and dataclasses for Mini Agent Protocol objects.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

TurnStatus = Literal[
    "in_progress",
    "completed",
    "step_limit",
    "steered",
    "cancelled",
    "failed",
]

ThreadStatus = Literal[
    "idle",
    "running",
    "awaiting_input",
    "failed",
    "closed",
]

TurnInputMode = Literal[
    "start",
    "start_if_idle",
    "steer",
    "follow_up",
]


@dataclass
class ToolCall:
    """Represents a tool invocation requested by the model."""

    name: str
    arguments: str
    call_id: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ToolCall:
        return cls(
            name=data.get("name", ""),
            arguments=data.get("arguments", ""),
            call_id=data.get("call_id") or data.get("callId", ""),
        )


@dataclass
class ModelUsage:
    """Token consumption statistics for a turn or step."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cache_read_tokens: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> ModelUsage:
        if not data:
            return cls()
        return cls(
            prompt_tokens=data.get("prompt_tokens", 0),
            completion_tokens=data.get("completion_tokens", 0),
            total_tokens=data.get("total_tokens", 0),
            cache_read_tokens=data.get("cache_read_tokens", 0),
        )


@dataclass
class TurnSubmissionResult:
    """Result returned immediately when submitting a turn to the app server."""

    status: str
    turn_id: str | None = None
    reason: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TurnSubmissionResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        if not isinstance(val, dict):
            return cls(status="unknown", raw={"value": val})
        turn_id = (
            val.get("turn_id")
            or val.get("turnId")
            or (val.get("turn_id", {}).get("0") if isinstance(val.get("turn_id"), dict) else None)
        )
        return cls(
            status=val.get("status", "started"),
            turn_id=turn_id,
            reason=val.get("reason"),
            raw=data,
        )


@dataclass
class TurnReadResult:
    """Settled outcome and message history for a turn."""

    turn_id: str
    status: TurnStatus
    stop_reason: str | None = None
    final_text: str | None = None
    steps: int = 0
    messages: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TurnReadResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        return cls(
            turn_id=val.get("turn_id") or val.get("turnId", ""),
            status=val.get("status", "completed"),
            stop_reason=val.get("stop_reason") or val.get("stopReason"),
            final_text=val.get("final_text") or val.get("finalText"),
            steps=val.get("steps", 0),
            messages=val.get("messages", []),
            error=val.get("error"),
            raw=data,
        )


@dataclass
class ThreadCheckpoint:
    """Settled state of a thread."""

    thread_id: str
    status: ThreadStatus
    next_turn_number: int = 1
    messages: list[dict[str, Any]] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ThreadCheckpoint:
        val = data.get("value", data) if isinstance(data, dict) else data
        return cls(
            thread_id=val.get("thread_id") or val.get("threadId", "default"),
            status=val.get("status", "idle"),
            next_turn_number=val.get("next_turn_number") or val.get("nextTurnNumber", 1),
            messages=val.get("session", {}).get("messages", []),
            raw=data,
        )
