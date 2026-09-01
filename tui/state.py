"""
State and console definitions for Mini Agent TUI.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field

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

console = Console(force_terminal=True, legacy_windows=False)


@dataclass
class TUIState:
    """Runtime mutable state for the active TUI session."""

    profile: str = "interactive"  # interactive | autonomous | strict
    approval_policy: str = "per_action"  # per_action | auto_approve | strict
    effort: str = "medium"  # low | medium | high
    remembered_approvals: set[str] = field(default_factory=set)
    current_thread_id: str = "tui-session"
    turn_counts: dict[str, int] = field(default_factory=dict)
    active_turn_id: str | None = None

    def get_turn_mode(self, thread_id: str | None = None) -> str:
        """Return 'start' for the first turn in a thread, 'follow_up' for subsequent turns."""
        tid = thread_id or self.current_thread_id
        count = self.turn_counts.get(tid, 0)
        return "start" if count == 0 else "follow_up"

    def record_turn(self, thread_id: str | None = None) -> None:
        """Increment turn count for the specified thread."""
        tid = thread_id or self.current_thread_id
        self.turn_counts[tid] = self.turn_counts.get(tid, 0) + 1

