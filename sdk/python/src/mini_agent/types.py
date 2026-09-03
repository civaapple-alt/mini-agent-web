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

ThreadGoalStatus = Literal[
    "active",
    "paused",
    "blocked",
    "usageLimited",
    "budgetLimited",
    "complete",
]

CollaborationModeKind = Literal["default", "plan"]


@dataclass
class ToolCall:
    """Represents a tool invocation requested by the model."""

    name: str
    arguments: Any = ""
    id: str = ""
    call_id: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ToolCall:
        cid = data.get("id") or data.get("call_id") or data.get("callId", "")
        return cls(
            name=data.get("name", ""),
            arguments=data.get("arguments", ""),
            id=cid,
            call_id=cid,
        )


@dataclass
class ThreadItem:
    """Bounded client-facing projection of a Thread item."""

    type: str
    id: str = ""
    text: str = ""
    name: str = ""
    arguments: Any = None
    status: str | None = None
    output: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ThreadItem:
        return cls(
            type=str(data.get("type", "unknown")),
            id=str(data.get("id", "")),
            text=str(data.get("text", "")),
            name=str(data.get("name", "")),
            arguments=data.get("arguments"),
            status=data.get("status"),
            output=data.get("output"),
        )


@dataclass
class CollaborationMode:
    """Thread collaboration mode returned by the App Server."""

    mode: CollaborationModeKind = "default"

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> CollaborationMode:
        value = data or {}
        return cls(mode=value.get("mode", "default"))


@dataclass
class ModelUsage:
    """Token consumption statistics for a turn or step."""

    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> ModelUsage:
        if not data:
            return cls()
        inp = data.get("input_tokens") or data.get("prompt_tokens", 0)
        cached = data.get("cached_input_tokens") or data.get("cache_read_tokens", 0)
        out = data.get("output_tokens") or data.get("completion_tokens", 0)
        tot = data.get("total_tokens") or (inp + out)
        return cls(
            input_tokens=inp,
            cached_input_tokens=cached,
            output_tokens=out,
            total_tokens=tot,
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
            or (
                val.get("turn_id", {}).get("0")
                if isinstance(val.get("turn_id"), dict)
                else None
            )
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
    items: list[ThreadItem] = field(default_factory=list)
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
            items=[ThreadItem.from_dict(item) for item in val.get("items", [])],
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
    context_revision: int = 0
    last_turn_id: str | None = None
    next_event_sequence: int = 1
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ThreadCheckpoint:
        val = data.get("value", data) if isinstance(data, dict) else data
        return cls(
            thread_id=val.get("thread_id") or val.get("threadId", "default"),
            status=val.get("status", "idle"),
            next_turn_number=val.get("next_turn_number")
            or val.get("nextTurnNumber", 1),
            messages=val.get("session", {}).get("messages", [])
            or val.get("messages", []),
            context_revision=val.get("context_revision")
            or val.get("contextRevision", 0),
            last_turn_id=val.get("last_turn_id") or val.get("lastTurnId"),
            next_event_sequence=val.get("next_event_sequence")
            or val.get("nextEventSequence", 1),
            raw=data,
        )


@dataclass
class ThreadListResult:
    """List of available threads."""

    data: list[str] = field(default_factory=list)
    next_cursor: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ThreadListResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        threads = val.get("data", []) if isinstance(val, dict) else []
        cursor = (
            val.get("nextCursor") or val.get("next_cursor")
            if isinstance(val, dict)
            else None
        )
        return cls(data=threads, next_cursor=cursor, raw=data)


@dataclass
class ThreadForkResult:
    """Result of forking a thread."""

    thread_id: str
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ThreadForkResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        tid = val.get("threadId") or val.get("thread_id", "")
        return cls(thread_id=tid, raw=data)


@dataclass
class ThreadResumeResult:
    """Result of resuming a thread checkpoint."""

    thread_id: str
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ThreadResumeResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        tid = val.get("threadId") or val.get("thread_id", "")
        return cls(thread_id=tid, raw=data)


@dataclass
class ThreadGoal:
    """Bounded public projection of a Thread-owned Goal."""

    thread_id: str
    objective: str
    status: ThreadGoalStatus
    token_budget: int | None = None
    tokens_used: int = 0
    time_used_seconds: int = 0
    created_at: int = 0
    updated_at: int = 0
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ThreadGoal:
        val = data.get("value", data) if isinstance(data, dict) else data
        return cls(
            thread_id=val.get("threadId") or val.get("thread_id", ""),
            objective=val.get("objective", ""),
            status=val.get("status", "active"),
            token_budget=val.get("tokenBudget")
            if "tokenBudget" in val
            else val.get("token_budget"),
            tokens_used=val.get("tokensUsed") or val.get("tokens_used", 0),
            time_used_seconds=val.get("timeUsedSeconds")
            or val.get("time_used_seconds", 0),
            created_at=val.get("createdAt") or val.get("created_at", 0),
            updated_at=val.get("updatedAt") or val.get("updated_at", 0),
            raw=data,
        )


@dataclass
class WorkflowState:
    """Read-only workflow projection using the Codex-shaped settings model."""

    collaboration_mode: CollaborationMode = field(default_factory=CollaborationMode)
    builtin_tools: list[str] = field(default_factory=list)
    goal: ThreadGoal | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WorkflowState:
        val = data.get("value", data) if isinstance(data, dict) else data
        goal_data = val.get("goal") if isinstance(val, dict) else None
        goal = ThreadGoal.from_dict(goal_data) if goal_data else None
        mode_data = val.get("collaborationMode") or val.get("collaboration_mode")
        builtin_tools = (
            val["builtinTools"]
            if "builtinTools" in val
            else val.get("builtin_tools", [])
        )
        return cls(
            collaboration_mode=CollaborationMode.from_dict(mode_data),
            builtin_tools=builtin_tools,
            goal=goal,
            raw=data,
        )


@dataclass
class ThreadSettingsResult:
    """Result returned by ``thread/settings/update``."""

    collaboration_mode: CollaborationMode
    builtin_tools: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ThreadSettingsResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        return cls(
            collaboration_mode=CollaborationMode.from_dict(
                val.get("collaborationMode") or val.get("collaboration_mode")
            ),
            builtin_tools=(
                val["builtinTools"]
                if "builtinTools" in val
                else val.get("builtin_tools", [])
            ),
            raw=data,
        )


@dataclass
class ThreadGoalSetResult:
    """Result returned by ``thread/goal/set``."""

    goal: ThreadGoal
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ThreadGoalSetResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        return cls(goal=ThreadGoal.from_dict(val.get("goal", {})), raw=data)


@dataclass
class ThreadGoalGetResult:
    """Result returned by ``thread/goal/get``."""

    goal: ThreadGoal | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ThreadGoalGetResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        goal_data = val.get("goal") if isinstance(val, dict) else None
        return cls(
            goal=ThreadGoal.from_dict(goal_data) if goal_data else None,
            raw=data,
        )


@dataclass
class ThreadGoalClearResult:
    """Result returned by ``thread/goal/clear``."""

    cleared: bool
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ThreadGoalClearResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        return cls(cleared=bool(val.get("cleared", False)), raw=data)


@dataclass
class SessionInfo:
    """Metadata about active session and workspace storage."""

    session_id: str
    thread_id: str
    path: str
    resumed: bool = False
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SessionInfo:
        val = data.get("value", data) if isinstance(data, dict) else data
        return cls(
            session_id=val.get("sessionId") or val.get("session_id", ""),
            thread_id=val.get("threadId") or val.get("thread_id", ""),
            path=val.get("path", ""),
            resumed=val.get("resumed", False),
            raw=data,
        )


@dataclass
class WorldStateResult:
    """Snapshot of workspace, environment, and security preset."""

    context: str = ""
    lines: list[str] = field(default_factory=list)
    status: dict[str, Any] = field(default_factory=dict)
    workspace: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WorldStateResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        return cls(
            context=val.get("context", "") if isinstance(val, dict) else "",
            lines=val.get("lines", []) if isinstance(val, dict) else [],
            status=val.get("status", {}) if isinstance(val, dict) else {},
            workspace=val.get("workspace", "") if isinstance(val, dict) else "",
            raw=data,
        )


@dataclass
class WorldRefreshResult:
    """Result of refreshing workspace and environment detection."""

    changed: bool
    state: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WorldRefreshResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        return cls(
            changed=val.get("changed", False) if isinstance(val, dict) else False,
            state=val.get("state", {}) if isinstance(val, dict) else {},
            raw=data,
        )


@dataclass
class WorldSetExecutionResult:
    """Result of modifying world execution policies."""

    changed: bool
    state: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WorldSetExecutionResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        return cls(
            changed=val.get("changed", False) if isinstance(val, dict) else False,
            state=val.get("state", {}) if isinstance(val, dict) else {},
            raw=data,
        )


@dataclass
class McpStatusResult:
    """Registered MCP servers and tools status."""

    enabled_servers: list[str] = field(default_factory=list)
    inactive_servers: list[str] = field(default_factory=list)
    tool_count: int = 0
    retry_available: bool = False
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> McpStatusResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        return cls(
            enabled_servers=val.get("enabledServers") or val.get("enabled_servers", [])
            if isinstance(val, dict)
            else [],
            inactive_servers=val.get("inactiveServers")
            or val.get("inactive_servers", [])
            if isinstance(val, dict)
            else [],
            tool_count=val.get("toolCount") or val.get("tool_count", 0)
            if isinstance(val, dict)
            else 0,
            retry_available=val.get("retryAvailable")
            or val.get("retry_available", False)
            if isinstance(val, dict)
            else False,
            raw=data,
        )


@dataclass
class McpRetryResult:
    """Result of retrying MCP server initialization."""

    enabled_servers: list[str] = field(default_factory=list)
    inactive_servers: list[str] = field(default_factory=list)
    diagnostics: list[str] = field(default_factory=list)
    tool_count: int = 0
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> McpRetryResult:
        val = data.get("value", data) if isinstance(data, dict) else data
        return cls(
            enabled_servers=val.get("enabledServers") or val.get("enabled_servers", [])
            if isinstance(val, dict)
            else [],
            inactive_servers=val.get("inactiveServers")
            or val.get("inactive_servers", [])
            if isinstance(val, dict)
            else [],
            diagnostics=val.get("diagnostics", []) if isinstance(val, dict) else [],
            tool_count=val.get("toolCount") or val.get("tool_count", 0)
            if isinstance(val, dict)
            else 0,
            raw=data,
        )
