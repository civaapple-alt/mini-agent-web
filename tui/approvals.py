"""
Security approvals and policy evaluation for Mini Agent TUI.
"""

from __future__ import annotations

import sys
from typing import TYPE_CHECKING

from rich.panel import Panel
from rich.prompt import Prompt

from tui.state import console

if TYPE_CHECKING:
    from tui.state import TUIState


def _ask_approval_sync(
    state: TUIState, action_desc: str, request_id: str, tool_name: str
) -> str:
    """Prompt for one typed approval; reuse is selected by the caller's scope."""

    if sys.platform == "win32":
        try:
            import msvcrt

            while msvcrt.kbhit():
                msvcrt.getch()
        except Exception:  # noqa: BLE001, S110
            pass

    title = f"[bold red]Action Intercepted ({request_id or tool_name})[/bold red]"
    console.print("\n[bold yellow]⚠️  SECURITY APPROVAL REQUIRED[/bold yellow]")
    console.print(
        Panel(
            str(action_desc),
            title=title,
            border_style="yellow",
        )
    )
    choice = (
        Prompt.ask(
            "[bold yellow]Allow execution? [y]es / [n]o[/bold yellow]",
            choices=["y", "n", "yes", "no"],
            default="n",
            show_choices=True,
        )
        .strip()
        .lower()
    )

    if choice in ("y", "yes"):
        return "approved"
    return "denied"
