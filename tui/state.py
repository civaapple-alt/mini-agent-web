"""
State and console definitions for Mini Agent TUI.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Any

from rich.console import Console

# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001, S110
        pass

console = Console(
    force_terminal=True
    if (hasattr(sys.stdout, "isatty") and sys.stdout.isatty())
    else None,
    legacy_windows=False,
)


@dataclass
class TurnMetrics:
    """Telemetry and settlement metrics for the last turn."""

    status: str = "completed"
    steps: int = 0
    stop_reason: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


@dataclass
class TUIState:
    """Runtime mutable state for the active TUI session."""

    profile: str = "interactive"  # interactive | auto | ask
    approval_policy: str = "per_action"  # per_action | auto_approve | strict
    effort: str = "medium"  # low | medium | high
    remembered_approvals: set[str] = field(default_factory=set)
    # The bundled App Server binds settings and Goal Runtime to its default
    # runtime Thread. Conversation threads may still be switched independently.
    runtime_thread_id: str = "default"
    current_thread_id: str = "default"
    turn_counts: dict[str, int] = field(default_factory=dict)
    active_turn_id: str | None = None
    last_turn_metrics: TurnMetrics | None = None
    last_assistant_response: str = ""
    # Latest authoritative ThreadItem projection keyed by stable item id.
    thread_items: dict[str, dict[str, Any]] = field(default_factory=dict)

    def record_turn(self, thread_id: str | None = None) -> None:
        """Increment turn count for the specified thread."""
        tid = thread_id or self.current_thread_id
        self.turn_counts[tid] = self.turn_counts.get(tid, 0) + 1

    def record_item(self, item: dict[str, Any]) -> None:
        """Reconcile a bounded lifecycle projection without creating a second store."""
        item_id = str(item.get("id", ""))
        if item_id:
            self.thread_items[item_id] = dict(item)
