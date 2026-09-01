"""
Rich-based Terminal User Interface (TUI) for Mini Agent.
Provides an interactive, visually rich CLI chat with thinking panels, tool cards, and approval prompts.
"""

from __future__ import annotations

import asyncio
from typing import Any

from mini_agent import MiniAgentClient
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt

console = Console()


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
        "Allow this execution?", choices=["y", "n", "yes", "no"], default="y"
    )
    decision = "approved" if choice in ("y", "yes") else "denied"
    return {"decision": decision}


async def run_tui() -> None:
    """Main interactive TUI loop."""
    console.print(
        Panel.fit(
            "[bold sky_blue1]Mini Agent Terminal Studio (TUI)[/bold sky_blue1]\n"
            "[dim]Powered by Mini Agent Harness & Rust App Server v0.5.0[/dim]\n"
            "[dim]Type 'exit' or 'quit' to leave. Type '/plan' to toggle Plan Mode.[/dim]",
            border_style="cyan",
        )
    )

    async with MiniAgentClient(
        log_dir="logs", approval_handler=terminal_approval_handler
    ) as client:
        init_res = await client.initialize(profile="interactive")
        console.print(
            f"[green]✓ Connected to {init_res.get('serverName')} v{init_res.get('serverVersion')}[/green]\n"
        )
        await client.start_thread("tui-session")

        while True:
            try:
                user_input = Prompt.ask("\n[bold cyan]You[/bold cyan]")
                if not user_input.strip():
                    continue

                if user_input.strip().lower() in ("exit", "quit"):
                    console.print("[dim]Goodbye![/dim]")
                    break

                if user_input.strip().lower() == "/plan":
                    wf = await client.get_workflow_state()
                    next_active = not wf.plan_active
                    res = await client.set_plan_mode(next_active)
                    console.print(
                        f"[yellow]Plan Mode is now: {'ACTIVE (Read-Only)' if res.plan_active else 'OFF'}[/yellow]"
                    )
                    continue

                console.print("\n[bold green]Mini Agent[/bold green]:")

                thinking_buffer = ""
                output_buffer = ""

                async for item in client.stream_turn(
                    user_input, thread_id="tui-session"
                ):
                    if item.get("type") == "event":
                        evt = item.get("event", {})
                        evt_type = evt.get("type")

                        if evt_type == "assistant_reasoning_delta":
                            thinking_buffer += evt.get("delta", "")
                        elif evt_type == "assistant_text_delta":
                            delta = evt.get("delta", "")
                            output_buffer += delta
                            console.print(delta, end="")
                        elif evt_type == "tool_started":
                            call = evt.get("call", {})
                            tool_name = evt.get("name") or call.get("name") or "tool"
                            console.print(
                                f"\n[dim cyan]⚡ Tool started: {tool_name}[/dim cyan]"
                            )
                        elif evt_type == "tool_finished":
                            tool_name = evt.get("name") or "tool"
                            console.print(
                                f"[dim green]✓ Tool finished: {tool_name}[/dim green]"
                            )

                console.print("\n")
                if thinking_buffer:
                    console.print(
                        Panel(
                            thinking_buffer.strip(),
                            title="[dim]Reasoning Process[/dim]",
                            border_style="dim",
                        )
                    )

            except (KeyboardInterrupt, EOFError):
                console.print("\n[dim]Session terminated.[/dim]")
                break
            except Exception as err:  # noqa: BLE001
                console.print(f"\n[bold red]Error: {err}[/bold red]")


def main() -> None:
    asyncio.run(run_tui())


if __name__ == "__main__":
    main()
