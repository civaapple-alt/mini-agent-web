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
