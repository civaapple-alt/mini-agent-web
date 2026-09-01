"""
Rich-based Terminal User Interface (TUI) for Mini Agent.
Provides an interactive, visually rich CLI chat with thinking streams, tool badges,
approval prompts, and full slash command workflows (/plan, /goal, /threads, /switch, /help).
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

from mini_agent import MiniAgentClient
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt
from rich.table import Table

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


def _ask_approval_sync(action_desc: str, request_id: str) -> str:
    """Prompt user synchronously on a dedicated thread, clearing any residual stdin input."""
    if sys.platform == "win32":
        try:
            import msvcrt

            while msvcrt.kbhit():
                msvcrt.getch()
        except Exception:  # noqa: BLE001, S110
            pass

    title = (
        f"[bold red]Action Intercepted ({request_id})[/bold red]"
        if request_id
        else "[bold red]Action Intercepted[/bold red]"
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
        "[bold yellow]Allow this execution?[/bold yellow]",
        choices=["y", "n", "yes", "no"],
        show_choices=True,
    )
    return "approved" if choice.strip().lower() in ("y", "yes") else "denied"


async def terminal_approval_handler(
    req: dict[str, Any] | str, action: str | None = None
) -> dict[str, Any]:
    """Terminal approval prompt when sensitive actions occur."""
    if isinstance(req, dict):
        action_desc = req.get("action") or str(req)
        request_id = req.get("requestId") or req.get("request_id") or ""
    else:
        action_desc = action or req
        request_id = req

    decision = await asyncio.to_thread(_ask_approval_sync, action_desc, request_id)
    return {"decision": decision}


def print_help_table() -> None:
    table = Table(title="Mini Agent TUI Commands", border_style="cyan")
    table.add_column("Command", style="bold sky_blue1", width=20)
    table.add_column("Description", style="white")

    table.add_row("/plan", "Toggle read-only Plan Mode (架构与规划探索)")
    table.add_row("/goal <objective>", "Start multi-milestone Goal workflow")
    table.add_row("/goal", "View current Goal convergence progress")
    table.add_row("/threads", "List all active/historical conversation threads")
    table.add_row("/switch <id>", "Switch active session thread")
    table.add_row("/clear", "Clear terminal screen")
    table.add_row("/help", "Display this help reference table")
    table.add_row("exit / quit", "Exit TUI studio")
    console.print(table)


async def run_tui() -> None:
    """Main interactive TUI loop."""
    console.print(
        Panel.fit(
            "[bold sky_blue1]Mini Agent Terminal Studio (TUI)[/bold sky_blue1]\n"
            "[dim]Powered by Mini Agent Harness & Rust App Server v0.6.0[/dim]\n"
            "[dim]Type '/help' for command reference. Type 'exit' to leave.[/dim]",
            border_style="cyan",
        )
    )

    current_thread_id = "tui-session"

    async with MiniAgentClient(
        log_dir="logs", approval_handler=terminal_approval_handler
    ) as client:
        init_res = await client.initialize(profile="interactive")
        console.print(
            f"[green]✓ Connected to {init_res.get('serverName')} v{init_res.get('serverVersion')}[/green]\n"
        )
        await client.start_thread(current_thread_id)

        while True:
            try:
                user_input = Prompt.ask(
                    f"\n[bold cyan]You ({current_thread_id})[/bold cyan]"
                )
                text = user_input.strip()
                if not text:
                    continue

                if text.lower() in ("exit", "quit"):
                    console.print("[dim]Goodbye![/dim]")
                    break

                if text.lower() == "/clear":
                    console.clear()
                    continue

                if text.lower() == "/help":
                    print_help_table()
                    continue

                if text.lower() == "/plan":
                    wf = await client.get_workflow_state()
                    next_active = not wf.plan_active
                    res = await client.set_plan_mode(next_active)
                    console.print(
                        f"[yellow]Plan Mode is now: {'ACTIVE (Read-Only)' if res.plan_active else 'OFF'}[/yellow]"
                    )
                    continue

                if text.lower().startswith("/goal"):
                    parts = text.split(maxsplit=1)
                    if len(parts) > 1:
                        obj = parts[1].strip()
                        res = await client.start_goal(obj)
                        console.print(
                            f"[green]✓ Goal started (ID: {res.goal_id}): {obj}[/green]"
                        )
                    else:
                        wf = await client.get_workflow_state()
                        if wf.goal:
                            console.print(
                                f"[sky_blue1]Active Goal ({wf.goal.goal_id}): milestone {wf.goal.current_milestone}/{wf.goal.total_milestones}, status={wf.goal.status}[/sky_blue1]"
                            )
                        else:
                            console.print(
                                "[dim]No active goal. Usage: /goal <objective>[/dim]"
                            )
                    continue

                if text.lower() == "/threads":
                    res = await client.list_threads()
                    table = Table(title="Historical Threads", border_style="sky_blue1")
                    table.add_column("Thread ID", style="bold sky_blue1")
                    table.add_column("Active", style="green")
                    for tid in res.data:
                        table.add_row(
                            tid, "✓ Current" if tid == current_thread_id else ""
                        )
                    console.print(table)
                    continue

                if text.lower().startswith("/switch"):
                    parts = text.split(maxsplit=1)
                    if len(parts) > 1:
                        target = parts[1].strip()
                        await client.start_thread(target)
                        current_thread_id = target
                        console.print(f"[green]✓ Switched to thread: {target}[/green]")
                    else:
                        console.print("[dim]Usage: /switch <thread_id>[/dim]")
                    continue

                console.print("\n[bold green]Mini Agent[/bold green]:")

                current_mode = None  # None | "thinking" | "text"

                async for item in client.stream_turn(
                    user_input, thread_id=current_thread_id
                ):
                    if item.get("type") == "event":
                        evt = item.get("event", {})
                        evt_type = evt.get("type")

                        if evt_type == "assistant_reasoning_delta":
                            delta = evt.get("delta", "")
                            if current_mode != "thinking":
                                console.print(
                                    "\n[bold cyan]💭 Thinking:[/bold cyan] ", end=""
                                )
                                current_mode = "thinking"
                            console.print(
                                delta, style="dim italic", markup=False, end=""
                            )

                        elif evt_type == "assistant_text_delta":
                            delta = evt.get("delta", "")
                            if current_mode != "text":
                                if current_mode == "thinking":
                                    console.print("\n")
                                current_mode = "text"
                            console.print(delta, markup=False, end="")

                        elif evt_type == "tool_started":
                            if current_mode == "thinking":
                                console.print("\n")
                            current_mode = None
                            call = evt.get("call", {})
                            tool_name = evt.get("name") or call.get("name") or "tool"
                            console.print(
                                f"\n[dim cyan]⚡ Tool started: {tool_name}[/dim cyan]"
                            )

                        elif evt_type == "tool_finished":
                            current_mode = None
                            tool_name = evt.get("name") or "tool"
                            console.print(
                                f"[dim green]✓ Tool finished: {tool_name}[/dim green]"
                            )

                console.print("\n")

            except (KeyboardInterrupt, EOFError):
                console.print("\n[dim]Session terminated.[/dim]")
                break
            except Exception as err:  # noqa: BLE001
                console.print(f"\n[bold red]Error: {err}[/bold red]")


def main() -> None:
    asyncio.run(run_tui())


if __name__ == "__main__":
    main()
