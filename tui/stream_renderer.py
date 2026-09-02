"""
Event streaming and terminal output renderer for Mini Agent TUI turns.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import suppress
from typing import TYPE_CHECKING, Any

from tui.state import TurnMetrics, console

if TYPE_CHECKING:
    from mini_agent import MiniAgentClient

    from tui.state import TUIState


def _format_args_preview(args: Any) -> str:
    """Format tool arguments concisely for one-line terminal badge."""
    if not args or args == "{}":
        return ""
    if isinstance(args, dict):
        preview = ", ".join(f"{k}={v!r}" for k, v in args.items())
    elif isinstance(args, str):
        try:
            parsed = json.loads(args)
            if isinstance(parsed, dict):
                preview = ", ".join(f"{k}={v!r}" for k, v in parsed.items())
            else:
                preview = str(args).strip().replace("\n", " ")
        except Exception:  # noqa: BLE001
            preview = args.strip().replace("\n", " ")
    else:
        preview = str(args).strip().replace("\n", " ")

    if len(preview) > 80:
        return preview[:77] + "..."
    return preview


def _format_output_preview(
    content: str, max_lines: int = 3, max_chars: int = 240
) -> str:
    """Format tool execution result preview."""
    if not content:
        return ""
    lines = [ln.rstrip() for ln in content.strip().splitlines() if ln.strip()]
    if not lines:
        return ""
    preview_lines = lines[:max_lines]
    joined = "\n       ".join(ln[:100] for ln in preview_lines)
    if len(lines) > max_lines or len(content) > max_chars:
        joined += f" ... ({len(lines)} lines total)"
    return joined


async def render_turn_stream(
    client: MiniAgentClient,
    user_input: str,
    state: TUIState,
    mode: str = "start",
) -> None:
    """Execute a turn with client.stream_turn() and render formatted output."""
    console.print("\n[bold green]Mini Agent[/bold green]:")

    metrics = TurnMetrics()
    current_mode: str | None = None
    assistant_text_chunks: list[str] = []
    failed_turn_id: str | None = None

    try:
        async for item in client.stream_turn(
            user_input,
            mode=mode,
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
                projected_items = item.get("items", [])
                projected_tool = next(
                    (
                        candidate
                        for candidate in projected_items
                        if candidate.get("type") in ("toolCall", "tool_call")
                    ),
                    None,
                )
                if not state.active_turn_id and item.get("turnId"):
                    state.active_turn_id = item.get("turnId")

                if evt_type == "model_started":
                    metrics.steps = evt.get("step", metrics.steps + 1)

                elif evt_type == "assistant_reasoning_delta":
                    delta = evt.get("delta", "")
                    if current_mode != "thinking":
                        console.print("\n[bold cyan]💭 Thinking:[/bold cyan] ", end="")
                        current_mode = "thinking"
                    console.print(delta, style="dim italic", markup=False, end="")

                elif evt_type == "assistant_text_delta":
                    delta = evt.get("delta", "")
                    if delta:
                        assistant_text_chunks.append(delta)
                    if current_mode != "text":
                        if current_mode == "thinking":
                            console.print("\n")
                        current_mode = "text"
                    console.print(delta, markup=False, end="")

                elif evt_type == "model_responded":
                    usage = evt.get("usage")
                    if isinstance(usage, dict):
                        metrics.input_tokens = usage.get(
                            "input_tokens",
                            usage.get("prompt_tokens", metrics.input_tokens),
                        )
                        metrics.output_tokens = usage.get(
                            "output_tokens",
                            usage.get("completion_tokens", metrics.output_tokens),
                        )
                        metrics.total_tokens = usage.get(
                            "total_tokens", metrics.input_tokens + metrics.output_tokens
                        )

                elif evt_type == "tool_started":
                    if current_mode == "thinking":
                        console.print("\n")
                    current_mode = None
                    call = evt.get("call", {})
                    tool_name = (
                        projected_tool.get("name")
                        if projected_tool
                        else evt.get("name") or call.get("name") or "tool"
                    )
                    args = (
                        projected_tool.get("arguments")
                        if projected_tool
                        else call.get("arguments") or evt.get("arguments") or ""
                    )
                    args_preview = _format_args_preview(args)
                    if args_preview:
                        console.print(
                            f"\n[dim cyan]⚡ Tool started: [bold]{tool_name}[/bold]({args_preview})[/dim cyan]"
                        )
                    else:
                        console.print(
                            f"\n[dim cyan]⚡ Tool started: [bold]{tool_name}[/bold][/dim cyan]"
                        )

                elif evt_type == "tool_finished":
                    if current_mode == "thinking":
                        console.print("\n")
                    current_mode = None
                    tool_name = (
                        projected_tool.get("name")
                        if projected_tool
                        else evt.get("name") or "tool"
                    )
                    is_error = bool(evt.get("is_error")) or bool(
                        projected_tool and projected_tool.get("status") == "failed"
                    )
                    truncated = bool(evt.get("truncated"))
                    content = str(
                        projected_tool.get("output")
                        if projected_tool and projected_tool.get("output") is not None
                        else evt.get("content") or ""
                    )

                    trunc_tag = (
                        " [dim yellow](truncated)[/dim yellow]" if truncated else ""
                    )

                    if is_error:
                        console.print(
                            f"[bold red]✗ Tool failed: [bold]{tool_name}[/bold]{trunc_tag}[/bold red]"
                        )
                    else:
                        console.print(
                            f"[dim green]✓ Tool finished: [bold]{tool_name}[/bold]{trunc_tag}[/dim green]"
                        )

                    preview = _format_output_preview(content)
                    if preview:
                        output_color = "red" if is_error else "dim"
                        console.print(
                            f"[{output_color}]       Output: {preview}[/{output_color}]"
                        )

                elif evt_type == "context_compaction_started":
                    before = evt.get("before_bytes", 0)
                    console.print(
                        f"\n[dim magenta]⚡ Context compaction started ({before} bytes)...[/dim magenta]"
                    )

                elif evt_type == "context_compaction_finished":
                    before = evt.get("before_bytes", 0)
                    after = evt.get("after_bytes", 0)
                    console.print(
                        f"\n[dim magenta]⚡ Context compacted: {before} -> {after} bytes[/dim magenta]"
                    )

                elif evt_type == "run_finished":
                    metrics.stop_reason = (
                        evt.get("stop_reason") or evt.get("stopReason") or "completed"
                    )
                    if evt.get("steps"):
                        metrics.steps = evt.get("steps")

                elif evt_type == "run_failed":
                    failed_turn_id = item.get("turnId") or state.active_turn_id
                    reason = evt.get("reason", "unknown error")
                    if isinstance(reason, dict):
                        r_type = reason.get("type", "unknown")
                        r_detail = reason.get("detail", "")
                        reason_str = f"{r_type}: {r_detail}" if r_detail else r_type
                    else:
                        reason_str = str(reason)
                    metrics.status = "failed"
                    metrics.stop_reason = "error"
                    console.print(f"\n[bold red]⛔ Run failed: {reason_str}[/bold red]")

                elif evt_type == "turn_finished":
                    state.active_turn_id = None
                    metrics.status = evt.get("status", "completed")

            elif item.get("type") == "notification":
                method = item.get("method", "")
                data = item.get("data", {})
                if method == "thread/goal/updated":
                    goal = data.get("goal", data) if isinstance(data, dict) else {}
                    console.print(
                        f"\n[dim blue]◎ Goal updated: {goal.get('status', 'active')}[/dim blue]"
                    )
                elif method == "thread/goal/cleared":
                    console.print("\n[dim blue]◎ Goal cleared[/dim blue]")

        if failed_turn_id:
            settled = None
            with suppress(Exception):
                settled = await client.read_turn(failed_turn_id)
            if settled is not None:
                detail = getattr(settled, "error", None)
                if detail:
                    detail_text = (
                        str(detail).strip().replace("\r", " ").replace("\n", " ")
                    )
                    if len(detail_text) > 480:
                        detail_text = detail_text[:477] + "..."
                    console.print(f"[red]       Detail: {detail_text}[/red]")

        if assistant_text_chunks:
            state.last_assistant_response = "".join(assistant_text_chunks).strip()

        console.print("\n")
        # Print sleek turn settlement telemetry
        state.last_turn_metrics = metrics
        status_style = "green" if metrics.status == "completed" else "red"
        parts = [f"Status: [{status_style}]{metrics.status}[/{status_style}]"]
        if metrics.steps > 0:
            parts.append(f"Steps: {metrics.steps}")
        if metrics.stop_reason:
            parts.append(f"Stop: {metrics.stop_reason}")
        if metrics.total_tokens > 0:
            parts.append(
                f"Tokens: {metrics.input_tokens} in / {metrics.output_tokens} out"
            )
        summary_str = " | ".join(parts)
        console.print(f"[dim]─── Turn Settled ({summary_str}) ───[/dim]\n")

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
