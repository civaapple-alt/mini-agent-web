"""
Rich-based Terminal User Interface (TUI) for Mini Agent.
Provides an interactive, visually rich CLI chat with thinking streams, tool badges,
approval prompts, and full slash command workflows (/plan, /goal, /policy, /threads, /switch, /help).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass, field
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


@dataclass
class TUIState:
    """Runtime mutable state for the active TUI session."""

    profile: str = "interactive"  # interactive | autonomous | strict
    approval_policy: str = "per_action"  # per_action | auto_approve | strict
    remembered_approvals: set[str] = field(default_factory=set)
    current_thread_id: str = "tui-session"


def _ask_approval_sync(
    state: TUIState, action_desc: str, request_id: str, tool_name: str
) -> str:
    """Prompt user synchronously on a dedicated thread with approval policies and session memory."""
    # 1. Policy check: Auto-approve
    if state.approval_policy == "auto_approve":
        console.print(
            f"[dim green]⚡ Auto-approved by policy: {tool_name or request_id}[/dim green]"
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
        default="y",
        show_choices=True,
    ).strip().lower()

    if choice in ("a", "always"):
        if tool_name:
            state.remembered_approvals.add(tool_name)
        return "approved"
    if choice in ("y", "yes"):
        return "approved"
    return "denied"


def print_help_table(state: TUIState) -> None:
    table = Table(title="Mini Agent TUI Commands", border_style="cyan")
    table.add_column("Command", style="bold sky_blue1", width=24)
    table.add_column("Description", style="white")

    table.add_row("/plan", "Toggle read-only Plan Mode (只读架构与规划探索)")
    table.add_row("/goal <objective>", "Start multi-milestone Goal workflow")
    table.add_row("/goal", "View current Goal convergence progress")
    table.add_row(
        "/policy [mode]",
        f"Switch approval policy: per_action, auto_approve, strict (Current: [cyan]{state.approval_policy}[/cyan])",
    )
    table.add_row("/clear-approvals", "Clear remembered session tool approvals")
    table.add_row("/threads", "List all active/historical conversation threads")
    table.add_row("/switch <id>", "Switch active session thread")
    table.add_row("/clear", "Clear terminal screen")
    table.add_row("/help", "Display this help reference table")
    table.add_row("exit / quit / :q", "Exit TUI studio")
    console.print(table)


async def run_tui(state: TUIState) -> None:
    """Main interactive TUI loop."""
    console.print(
        Panel.fit(
            "[bold sky_blue1]Mini Agent Terminal Studio (TUI)[/bold sky_blue1]\n"
            f"[dim]Profile: [cyan]{state.profile}[/cyan] | Approval Policy: [yellow]{state.approval_policy}[/yellow][/dim]\n"
            "[dim]Type '/help' for commands. Type 'exit' to leave.[/dim]",
            border_style="cyan",
        )
    )

    async def _handler(
        req: dict[str, Any] | str, action: str | None = None
    ) -> dict[str, Any]:
        if isinstance(req, dict):
            action_desc = req.get("action") or str(req)
            request_id = req.get("requestId") or req.get("request_id") or ""
            tool_name = str(req.get("tool") or req.get("name") or "")
        else:
            action_desc = action or req
            request_id = req
            tool_name = str(action or "")

        decision = await asyncio.to_thread(
            _ask_approval_sync, state, action_desc, request_id, tool_name
        )
        return {"decision": decision}

    async with MiniAgentClient(
        log_dir="logs", approval_handler=_handler
    ) as client:
        init_res = await client.initialize(profile=state.profile)
        console.print(
            f"[green]✓ Connected to {init_res.get('serverName')} v{init_res.get('serverVersion')} (Profile: {state.profile})[/green]\n"
        )
        await client.start_thread(state.current_thread_id)

        while True:
            try:
                user_input = Prompt.ask(
                    f"\n[bold cyan]You ({state.current_thread_id})[/bold cyan]"
                )
            except (KeyboardInterrupt, EOFError):
                console.print("\n[dim]Session terminated.[/dim]")
                break

            text = user_input.strip()
            if not text:
                continue

            if text.lower() in ("exit", "quit", ":q", "q"):
                console.print("[dim]Goodbye![/dim]")
                break

            if text.lower() == "/clear":
                console.clear()
                continue

            if text.lower() == "/help":
                print_help_table(state)
                continue

            if text.lower() == "/profile":
                console.print(
                    f"[sky_blue1]Current Startup Profile: [bold]{state.profile}[/bold][/sky_blue1]\n"
                    "[dim]To start with a different profile, restart with: mini-agent-tui --profile <interactive|autonomous|strict>[/dim]"
                )
                continue

            if text.lower().startswith("/policy") or text.lower().startswith("/approve"):
                parts = text.split(maxsplit=1)
                if len(parts) > 1:
                    target_policy = parts[1].strip().lower()
                    if target_policy in ("per_action", "auto_approve", "strict"):
                        state.approval_policy = target_policy
                        console.print(
                            f"[green]✓ Approval policy switched to: [bold]{state.approval_policy}[/bold][/green]"
                        )
                    else:
                        console.print(
                            "[yellow]Invalid policy. Choose from: per_action, auto_approve, strict[/yellow]"
                        )
                else:
                    console.print(
                        f"[sky_blue1]Current Approval Policy: [bold]{state.approval_policy}[/bold]\n"
                        f"Remembered Tool Approvals: {len(state.remembered_approvals)}\n"
                        "[dim]Usage: /policy <per_action | auto_approve | strict>[/dim][/sky_blue1]"
                    )
                continue

            if text.lower() == "/clear-approvals":
                state.remembered_approvals.clear()
                console.print("[green]✓ Cleared all remembered tool approvals for this session.[/green]")
                continue

            if text.lower() == "/plan":
                wf = await client.get_workflow_state()
                next_active = not wf.plan_active
                res = await client.set_plan_mode(next_active)
                console.print(
                    f"[yellow]Plan Mode is now: {'ACTIVE (Read-Only 探索模式)' if res.plan_active else 'OFF'}[/yellow]"
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
                        tid, "✓ Current" if tid == state.current_thread_id else ""
                    )
                console.print(table)
                continue

            if text.lower().startswith("/switch"):
                parts = text.split(maxsplit=1)
                if len(parts) > 1:
                    target = parts[1].strip()
                    await client.start_thread(target)
                    state.current_thread_id = target
                    console.print(f"[green]✓ Switched to thread: {target}[/green]")
                else:
                    console.print("[dim]Usage: /switch <thread_id>[/dim]")
                continue

            console.print("\n[bold green]Mini Agent[/bold green]:")

            current_mode = None  # None | "thinking" | "text"

            try:
                async for item in client.stream_turn(
                    user_input, thread_id=state.current_thread_id
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
            except (KeyboardInterrupt, asyncio.CancelledError):
                console.print("\n[yellow]⚠️  Turn interrupted by user (Ctrl+C).[/yellow]\n")
            except Exception as err:  # noqa: BLE001
                console.print(f"\n[bold red]Error during turn: {err}[/bold red]\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Mini Agent Terminal User Interface (TUI) Studio"
    )
    parser.add_argument(
        "-p",
        "--profile",
        choices=["interactive", "autonomous", "strict"],
        default="interactive",
        help="Startup system profile: interactive (default), autonomous, strict",
    )
    parser.add_argument(
        "-a",
        "--policy",
        "--approval-policy",
        dest="approval_policy",
        choices=["per_action", "auto_approve", "strict"],
        default="per_action",
        help="Security approval policy: per_action (default), auto_approve, strict",
    )
    parser.add_argument(
        "-t",
        "--thread",
        dest="thread_id",
        default="tui-session",
        help="Initial conversation thread ID (default: tui-session)",
    )

    args = parser.parse_args()
    state = TUIState(
        profile=args.profile,
        approval_policy=args.approval_policy,
        current_thread_id=args.thread_id,
    )

    try:
        asyncio.run(run_tui(state))
    except (KeyboardInterrupt, EOFError, SystemExit):
        console.print("\n[dim]Mini Agent TUI exited.[/dim]")
    except Exception as err:  # noqa: BLE001
        console.print(f"\n[bold red]Fatal error: {err}[/bold red]")
        sys.exit(1)


if __name__ == "__main__":
    main()
