"""
Mini Agent Terminal User Interface (TUI) Studio Entrypoint and Main Runner.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any

from mini_agent import MiniAgentClient
from prompt_toolkit import PromptSession
from prompt_toolkit.auto_suggest import AutoSuggestFromHistory
from prompt_toolkit.styles import Style
from rich.panel import Panel

from tui.approvals import _ask_approval_sync
from tui.commands import handle_slash_command
from tui.completer import SlashCommandCompleter
from tui.state import TUIState, console
from tui.stream_renderer import render_turn_stream


async def run_tui(state: TUIState) -> None:
    """Main interactive TUI loop."""
    console.print(
        Panel.fit(
            "[bold sky_blue1]Mini Agent Terminal Studio (TUI)[/bold sky_blue1]\n"
            f"[dim]Profile: [cyan]{state.profile}[/cyan] | Approval Policy: [yellow]{state.approval_policy}[/yellow] | Effort: [green]{state.effort}[/green][/dim]\n"
            "[dim]Type '/help' for commands. Supports [bold yellow]Tab Autocomplete[/bold yellow]. Type '/exit' to leave.[/dim]",
            border_style="cyan",
        )
    )

    prompt_session: PromptSession[str] | None = None
    if sys.stdin.isatty() and sys.stdout.isatty():
        try:
            from pathlib import Path

            from prompt_toolkit.filters import has_completions
            from prompt_toolkit.history import FileHistory
            from prompt_toolkit.key_binding import KeyBindings

            kb = KeyBindings()

            @kb.add("c-c")
            def _handle_ctrl_c(event: Any) -> None:
                """If buffer has content, clear it; if empty, exit with KeyboardInterrupt."""
                buf = event.current_buffer
                if buf.text.strip():
                    buf.reset()
                else:
                    event.app.exit(exception=KeyboardInterrupt())

            @kb.add("enter", filter=~has_completions)
            def _handle_enter(event: Any) -> None:
                """Ignore Enter if buffer is empty or pure whitespace; stay on the same prompt line."""
                buf = event.current_buffer
                if not buf.text.strip():
                    return
                buf.validate_and_handle()

            hist_file = Path.home() / ".mini-agent" / "tui_history"
            hist_file.parent.mkdir(parents=True, exist_ok=True)

            prompt_session = PromptSession(
                history=FileHistory(str(hist_file)),
                auto_suggest=AutoSuggestFromHistory(),
                completer=SlashCommandCompleter(state),
                key_bindings=kb,
                style=Style.from_dict({
                    "prompt": "bold #88c0d0",
                    "completion-menu.completion": "bg:#2e3440 #d8dee9",
                    "completion-menu.completion.current": "bg:#434c5e #88c0d0 bold",
                    "completion-menu.meta.completion": "bg:#2e3440 #81a1c1 italic",
                    "completion-menu.meta.completion.current": "bg:#434c5e #eceff4",
                    "auto-suggestion": "#4c566a italic",
                }),
                complete_while_typing=True,
            )
        except Exception:  # noqa: BLE001
            prompt_session = None

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

    console.print("[dim]Connecting to App Server...[/dim]")
    async with MiniAgentClient(
        log_dir="logs", approval_handler=_handler
    ) as client:
        init_res = await client.initialize(profile=state.profile)
        console.print(
            f"[green]✓ Connected to {init_res.get('serverName')} v{init_res.get('serverVersion')} (Profile: {state.profile})[/green]\n"
        )
        await client.start_thread(state.current_thread_id)

        async def _ensure_connected() -> None:
            if not client.is_running:
                console.print(
                    "[dim yellow]⚡ App Server disconnected, auto-reconnecting...[/dim yellow]"
                )
                await client.restart(profile=state.profile)
                console.print(
                    f"[dim green]✓ Reconnected to App Server (Profile: {state.profile})[/dim green]"
                )

        consecutive_interrupts = 0

        while True:
            try:
                if prompt_session is not None:
                    try:
                        user_input = await prompt_session.prompt_async(
                            [("class:prompt", f"You ({state.current_thread_id}) > ")]
                        )
                        consecutive_interrupts = 0
                    except KeyboardInterrupt:
                        consecutive_interrupts += 1
                        if consecutive_interrupts >= 2:
                            console.print("\n[dim]Exiting Mini Agent TUI... Goodbye![/dim]")
                            break
                        console.print("\n[dim yellow](Press Ctrl+C again or type '/exit' to quit)[/dim yellow]")
                        continue
                    except EOFError:
                        console.print("\n[dim]Session terminated.[/dim]")
                        break
                    except Exception:  # noqa: BLE001
                        def _read_std_input() -> str:
                            while True:
                                if sys.stdin.isatty():
                                    console.print(
                                        f"[bold cyan]You ({state.current_thread_id}) > [/bold cyan]",
                                        end="",
                                    )
                                line = sys.stdin.readline()
                                if not line:
                                    raise EOFError
                                if line.strip():
                                    if not sys.stdin.isatty():
                                        console.print(
                                            f"[bold cyan]You ({state.current_thread_id}) > [/bold cyan]{line.strip()}"
                                        )
                                    return line

                        user_input = await asyncio.to_thread(_read_std_input)
                else:
                    def _read_std_input() -> str:
                        while True:
                            if sys.stdin.isatty():
                                console.print(
                                    f"[bold cyan]You ({state.current_thread_id}) > [/bold cyan]",
                                    end="",
                                )
                            line = sys.stdin.readline()
                            if not line:
                                raise EOFError
                            if line.strip():
                                if not sys.stdin.isatty():
                                    console.print(
                                        f"[bold cyan]You ({state.current_thread_id}) > [/bold cyan]{line.strip()}"
                                    )
                                return line

                    try:
                        user_input = await asyncio.to_thread(_read_std_input)
                        consecutive_interrupts = 0
                    except KeyboardInterrupt:
                        consecutive_interrupts += 1
                        if consecutive_interrupts >= 2:
                            console.print("\n[dim]Exiting Mini Agent TUI... Goodbye![/dim]")
                            break
                        console.print("\n[dim yellow](Press Ctrl+C again or type '/exit' to quit)[/dim yellow]")
                        continue
                    except EOFError:
                        console.print("\n[dim]Session terminated.[/dim]")
                        break
            except (KeyboardInterrupt, EOFError):
                console.print("\n[dim]Session terminated.[/dim]")
                break

            text = user_input.strip()
            if not text:
                continue

            norm_text = text.lower().strip()
            if norm_text in ("/exit", "/quit"):
                console.print("[dim]Goodbye![/dim]")
                break
            if norm_text in ("exit", "quit", ":q", "q"):
                console.print(
                    "[dim yellow]Tip: Use '[bold]/exit[/bold]' or '[bold]/quit[/bold]' to leave Mini Agent TUI.[/dim yellow]"
                )
                continue

            await _ensure_connected()

            handled = await handle_slash_command(
                text, state, client, init_res
            )
            if handled:
                continue

            try:
                await render_turn_stream(client, user_input, state)
            except (KeyboardInterrupt, asyncio.CancelledError):
                await asyncio.sleep(0.05)
            except Exception as err:  # noqa: BLE001
                console.print(f"\n[bold red]Error during turn: {err}[/bold red]\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Mini Agent Terminal User Interface (TUI) Studio"
    )
    parser.add_argument(
        "-p",
        "--profile",
        choices=["interactive", "auto", "ask"],
        default="interactive",
        help="Startup system profile: interactive (default), auto, ask",
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
        "-e",
        "--effort",
        choices=["low", "medium", "high"],
        default="medium",
        help="Model reasoning effort: low, medium (default), high",
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
        effort=args.effort,
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
