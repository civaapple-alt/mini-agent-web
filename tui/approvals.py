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
    """Prompt user synchronously on a dedicated thread with approval policies and session memory."""
    # 1. Policy check: Auto-approve
    if state.approval_policy == "auto_approve":
        console.print(
            f"[dim]⚡ Auto-approved: {tool_name or request_id}[/dim]"
        )
        return "approved"

    # 2. Policy check: Strict deny
    if state.approval_policy == "strict":
        console.print(
            f"[dim red]⛔ Denied by strict policy: {tool_name or request_id}[/dim red]"
        )
        return "denied"

    # 3. Check remembered approvals for this session
    if tool_name and tool_name in state.remembered_approvals:
        console.print(
            f"[dim green]⚡ Remembered approval: {tool_name}[/dim green]"
        )
        return "approved"

    if sys.platform == "win32":
        try:
            import msvcrt

            while msvcrt.kbhit():
                msvcrt.getch()
        except Exception:  # noqa: BLE001, S110
            pass

    title = (
        f"[bold red]Action Intercepted ({request_id or tool_name})[/bold red]"
    )
    console.print("\n[bold yellow]⚠️  SECURITY APPROVAL REQUIRED[/bold yellow]")
    console.print(
        Panel(
            str(action_desc),
            title=title,
            border_style="yellow",
        )
    )
    choice = Prompt.ask(
        "[bold yellow]Allow execution? [y]es / [n]o / [a]lways (本会话始终放行此工具)[/bold yellow]",
        choices=["y", "n", "a", "yes", "no", "always"],
        default="n",
        show_choices=True,
    ).strip().lower()

    if choice in ("a", "always"):
        if tool_name:
            state.remembered_approvals.add(tool_name)
        return "approved"
    if choice in ("y", "yes"):
        return "approved"
    return "denied"
