"""
Event streaming and terminal output renderer for Mini Agent TUI turns.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from tui.state import console

if TYPE_CHECKING:
    from mini_agent import MiniAgentClient

    from tui.state import TUIState


async def render_turn_stream(
    client: MiniAgentClient,
    user_input: str,
    state: TUIState,
    mode: str | None = None,
) -> None:
    """Execute a turn with client.stream_turn() and render formatted output."""
    console.print("\n[bold green]Mini Agent[/bold green]:")

    current_mode = None  # None | "thinking" | "text"
    eff_mode = mode or state.get_turn_mode()

    try:
        async for item in client.stream_turn(
            user_input,
            mode=eff_mode,
            thread_id=state.current_thread_id,
            effort=state.effort,
        ):
            if item.get("type") == "_turn_submission":
                sub_data = item.get("data", {})
                state.active_turn_id = sub_data.get("turn_id")
                state.record_turn()

            elif item.get("type") == "event":
                evt = item.get("event", {})
                evt_type = evt.get("type")
                if not state.active_turn_id and item.get("turnId"):
                    state.active_turn_id = item.get("turnId")

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

                elif evt_type == "context_compaction_finished":
                    before = evt.get("before_bytes", 0)
                    after = evt.get("after_bytes", 0)
                    console.print(
                        f"\n[dim magenta]⚡ Context compacted: {before} -> {after} bytes[/dim magenta]"
                    )

                elif evt_type == "turn_finished":
                    state.active_turn_id = None

        console.print("\n")
    except (KeyboardInterrupt, asyncio.CancelledError):
        console.print("\n[yellow]⚠️  Turn interrupted by user (Ctrl+C).[/yellow]\n")
        if state.active_turn_id:
            try:
                await client.interrupt_turn(
                    state.active_turn_id, thread_id=state.current_thread_id
                )
            except Exception:  # noqa: BLE001, S110
                pass
    except Exception as err:  # noqa: BLE001
        console.print(f"\n[bold red]Error during turn: {err}[/bold red]\n")
    finally:
        state.active_turn_id = None

