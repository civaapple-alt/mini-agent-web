"""
Slash command definitions and dispatcher for Mini Agent TUI.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from rich.table import Table

from tui.state import console

if TYPE_CHECKING:
    from mini_agent import MiniAgentClient

    from tui.state import TUIState


def print_help_table(state: TUIState) -> None:
    """Render the clean categorized help reference table."""
    table = Table(
        title="Mini Agent TUI（实验性 Python SDK 验证命令）",
        border_style="cyan",
        show_lines=False,
    )
    table.add_column("分类", style="bold yellow", width=14)
    table.add_column("命令 / 格式", style="bold sky_blue1", width=28)
    table.add_column("功能说明与当前配置", style="white")

    # 1. Thread workflow controls owned by the App Server
    table.add_row(
        "Thread 控制", "/plan [on|off]", "调用当前 Thread 的 Plan 探索 Runtime"
    )
    table.add_row("", "/goal <目标描述>", "调用当前 Thread 的 Goal Runtime")
    table.add_row("", "/goal", "查看当前活动 Goal 进度与各里程碑收敛状态")

    # 2. 模型与思考控制
    table.add_row(
        "模型与思考",
        "/effort [low|med|high]",
        f"切换思考链强度 (别名: /reasoning | 当前: [bold cyan]{state.effort}[/bold cyan])",
    )
    table.add_row(
        "",
        "/steer <纠偏指令>",
        "向当前正在执行的轮次注入实时纠偏指令 (别名: /guide)",
    )

    # 3. 安全与审批范围
    table.add_row(
        "安全与审批",
        "/approval [scope]",
        f"切换批准复用范围: per_action, current_session, current_project (当前: [bold cyan]{state.approval_mode}[/bold cyan])",
    )
    table.add_row(
        "",
        "/access [scope]",
        f"切换访问范围: project, full_machine (当前: [bold cyan]{state.access_scope}[/bold cyan])",
    )

    # 4. 会话与多分支管理
    table.add_row("会话管理", "/threads", "列出所有历史会话与分支列表")
    table.add_row("", "/new [thread_id]", "新建并切换至新会话线程")
    table.add_row("", "/fork <new_id>", "分叉当前会话历史为新的实验分支")
    table.add_row("", "/switch <thread_id>", "切换当前活跃会话线程")
    table.add_row(
        "",
        "/history [n|all]",
        "查看当前会话已结算 Checkpoint 与消息回放 (别名: /checkpoint)",
    )

    # 5. Runtime inspection
    table.add_row("运行时验证", "/status", "读取 World、Thread、Goal 和轮次遥测摘要")
    table.add_row("", "/mcp", "查看已启用的 MCP 服务与扩展工具状态")

    # 6. TUI-only presentation controls
    table.add_row("界面控制", "/clear", "清空终端屏幕")
    table.add_row("", "/help", "显示本命令参考大全")
    table.add_row("", "/exit / /quit", "退出 TUI 交互终端")

    console.print(table)


async def handle_slash_command(
    text: str,
    state: TUIState,
    client: MiniAgentClient,
    init_res: dict[str, str] | None = None,
) -> bool:
    """
    Check if the user input is a TUI slash command and handle it.
    Returns True if handled, False if it should proceed as a model turn prompt.
    """
    lower_text = text.lower().strip()

    if lower_text in ("/exit", "/quit"):
        console.print("[dim]Goodbye![/dim]")
        sys.exit(0)

    if lower_text == "/clear":
        console.clear()
        return True

    if lower_text == "/help":
        print_help_table(state)
        return True

    if lower_text.startswith(("/effort", "/reasoning")):
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            target_effort = parts[1].strip().lower()
            if target_effort in ("low", "medium", "med", "high"):
                state.effort = "medium" if target_effort == "med" else target_effort
                console.print(
                    f"[green]✓ Reasoning effort set to: [bold]{state.effort}[/bold][/green]"
                )
            else:
                console.print(
                    "[yellow]Invalid effort. Choose from: low, medium, high[/yellow]"
                )
        else:
            console.print(
                f"[sky_blue1]Current Reasoning Effort: [bold]{state.effort}[/bold] (Options: low, medium, high)[/sky_blue1]"
            )
        return True

    if lower_text.startswith(("/steer", "/guide")):
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            instruction = parts[1].strip()
            if state.active_turn_id:
                try:
                    res = await client.steer_turn(
                        state.active_turn_id,
                        instruction,
                        thread_id=state.current_thread_id,
                    )
                    action_id = (
                        res.get("actionId", "ok") if isinstance(res, dict) else "ok"
                    )
                    console.print(
                        f"[green]✓ Steer instruction injected into active turn {state.active_turn_id} (Action: {action_id}):[/green]\n"
                        f"[dim cyan]{instruction}[/dim cyan]"
                    )
                except Exception as err:  # noqa: BLE001
                    console.print(f"[red]Failed to steer active turn: {err}[/red]")
            else:
                console.print(
                    "[yellow]No active turn is currently running to steer.\n"
                    "[dim]Tip: Enter your instruction as normal text to start a new turn, or type '/help'.[/dim][/yellow]"
                )
        else:
            console.print(
                f"[sky_blue1]Usage: [bold]/steer <corrective guidance>[/bold]\n"
                f"Active Turn: [bold]{state.active_turn_id or 'None (idle)'}[/bold][/sky_blue1]"
            )
        return True

    if lower_text == "/status":
        server_info = (
            f"{init_res.get('serverName', 'mini-agent-app-server')} v{init_res.get('serverVersion', '0.7.0')}"
            if init_res
            else "mini-agent-app-server"
        )
        table = Table(title="Mini Agent Runtime Status", border_style="cyan")
        table.add_column("Property", style="bold sky_blue1", width=22)
        table.add_column("Value", style="white")
        table.add_row("Server", server_info)
        table.add_row("Workspace Root", str(Path.cwd().resolve()))
        table.add_row("Access Scope", state.access_scope)
        table.add_row("Approval Scope", state.approval_mode)
        table.add_row("Reasoning Effort", state.effort)
        table.add_row("Active Thread", state.current_thread_id)
        table.add_row(
            "Completed Turns",
            f"{state.turn_counts.get(state.current_thread_id, 0)} turns",
        )
        if state.last_turn_metrics:
            m = state.last_turn_metrics
            table.add_row(
                "Last Turn Settlement",
                f"{m.status} (steps={m.steps}, stop={m.stop_reason}, tokens={m.input_tokens}in/{m.output_tokens}out)",
            )
        console.print(table)
        return True

    if lower_text.startswith("/access"):
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            target_access = parts[1].strip().lower()
            if target_access in ("project", "full_machine"):
                try:
                    await client.set_world_execution(target_access, state.approval_mode)
                    state.access_scope = target_access
                    console.print(
                        f"[green]✓ App Server access scope: [bold]{state.access_scope}[/bold][/green]"
                    )
                except Exception as err:  # noqa: BLE001
                    console.print(f"[red]Failed to set access scope: {err}[/red]")
            else:
                console.print(
                    "[yellow]Invalid access scope. Choose from: project, full_machine[/yellow]"
                )
        else:
            console.print(
                f"[sky_blue1]Current Access Scope: [bold]{state.access_scope}[/bold]\n"
                "[dim]Usage: /access <project | full_machine>[/dim][/sky_blue1]"
            )
        return True

    if lower_text.startswith("/approval"):
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            target_approval = parts[1].strip().lower()
            if target_approval in (
                "per_action",
                "current_session",
                "current_project",
            ):
                try:
                    await client.set_world_execution(
                        state.access_scope, target_approval
                    )
                    state.approval_mode = target_approval
                    console.print(
                        f"[green]✓ App Server approval scope: [bold]{state.approval_mode}[/bold][/green]"
                    )
                except Exception as err:  # noqa: BLE001
                    console.print(f"[red]Failed to set approval scope: {err}[/red]")
            else:
                console.print(
                    "[yellow]Invalid approval scope. Choose from: per_action, current_session, current_project[/yellow]"
                )
        else:
            console.print(
                f"[sky_blue1]Current Approval Scope: [bold]{state.approval_mode}[/bold]\n"
                "[dim]Usage: /approval <per_action | current_session | current_project>[/dim][/sky_blue1]"
            )
        return True

    if lower_text.startswith("/plan"):
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            arg = parts[1].strip().lower()
            if arg in ("on", "true", "1", "enable"):
                res = await client.set_collaboration_mode(
                    "plan", thread_id=state.current_thread_id
                )
            elif arg in ("off", "false", "0", "disable"):
                res = await client.set_collaboration_mode(
                    "default", thread_id=state.current_thread_id
                )
            else:
                wf = await client.get_workflow_state(thread_id=state.current_thread_id)
                next_mode = (
                    "default" if wf.collaboration_mode.mode == "plan" else "plan"
                )
                res = await client.set_collaboration_mode(
                    next_mode, thread_id=state.current_thread_id
                )
        else:
            wf = await client.get_workflow_state(thread_id=state.current_thread_id)
            next_mode = "default" if wf.collaboration_mode.mode == "plan" else "plan"
            res = await client.set_collaboration_mode(
                next_mode, thread_id=state.current_thread_id
            )
        active = res.collaboration_mode.mode == "plan"
        console.print(
            f"[yellow]Plan Mode is now: {'ACTIVE (Read-Only 探索模式)' if active else 'OFF'}[/yellow]"
        )
        return True

    if lower_text.startswith("/goal"):
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            target_goal = parts[1].strip()
            res = await client.set_goal(
                objective=target_goal, thread_id=state.current_thread_id
            )
            console.print(
                f"[green]✓ Thread Goal set ({res.goal.thread_id}): [bold]{res.goal.objective}[/bold]\n"
                f"Status: {res.goal.status} | Token budget: {res.goal.token_budget or 'unlimited'}[/green]"
            )
        else:
            wf = await client.get_workflow_state(thread_id=state.current_thread_id)
            if wf.goal:
                console.print(
                    f"[sky_blue1]Thread Goal ({wf.goal.thread_id}): status={wf.goal.status}, tokens={wf.goal.tokens_used}/{wf.goal.token_budget or 'unlimited'}[/sky_blue1]"
                )
            else:
                console.print("[dim]No active goal. Usage: /goal <objective>[/dim]")
        return True

    if lower_text == "/threads":
        res = await client.list_threads()
        table = Table(title="Historical Threads", border_style="sky_blue1")
        table.add_column("Thread ID", style="bold sky_blue1")
        table.add_column("Active", style="green")
        for tid in res.data:
            table.add_row(tid, "✓ Current" if tid == state.current_thread_id else "")
        console.print(table)
        return True

    if lower_text.startswith("/new"):
        parts = text.split(maxsplit=1)
        new_thread = (
            parts[1].strip()
            if len(parts) > 1
            else f"session-{datetime.now(timezone.utc).strftime('%m%d-%H%M%S')}"
        )
        await client.start_thread(new_thread)
        state.current_thread_id = new_thread
        console.print(
            f"[green]✓ Created and switched to new thread: [bold]{new_thread}[/bold][/green]"
        )
        return True

    if lower_text.startswith("/fork"):
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            target = parts[1].strip()
            try:
                await client.fork_thread(state.current_thread_id, target)
                state.current_thread_id = target
                console.print(
                    f"[green]✓ Forked thread into new branch: [bold]{target}[/bold][/green]"
                )
            except Exception as err:  # noqa: BLE001
                console.print(f"[red]Failed to fork thread: {err}[/red]")
        else:
            console.print("[dim]Usage: /fork <new_thread_id>[/dim]")
        return True

    if lower_text.startswith("/switch"):
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            target = parts[1].strip()
            await client.start_thread(target)
            state.current_thread_id = target
            console.print(f"[green]✓ Switched to thread: {target}[/green]")
        else:
            console.print("[dim]Usage: /switch <thread_id>[/dim]")
        return True

    if lower_text == "/mcp":
        try:
            mcp_status = await client.get_mcp_status()
            table = Table(
                title="Model Context Protocol (MCP) Status",
                border_style="cyan",
            )
            table.add_column("Property", style="bold sky_blue1", width=22)
            table.add_column("Value", style="white")
            table.add_row("Enabled Servers", str(mcp_status.enabled_servers))
            table.add_row("Available Tools", str(mcp_status.tool_count))
            console.print(table)
        except Exception as err:  # noqa: BLE001
            console.print(f"[red]Failed to query MCP status: {err}[/red]")
        return True

    if lower_text.startswith(("/history", "/checkpoint")):
        parts = text.split(maxsplit=1)
        limit = 5
        if len(parts) > 1:
            arg = parts[1].strip().lower()
            if arg in ("all", "full"):
                limit = 100
            elif arg.isdigit():
                limit = int(arg)

        try:
            cp = await client.read_thread(state.current_thread_id)
            table = Table(
                title=f"Thread Checkpoint: {state.current_thread_id}",
                border_style="sky_blue1",
            )
            table.add_column("Property", style="bold sky_blue1", width=22)
            table.add_column("Value", style="white")
            table.add_row("Status", str(cp.status or "idle"))
            table.add_row(
                "Completed Turns",
                f"{state.turn_counts.get(state.current_thread_id, 0)} turns",
            )
            table.add_row("Total Messages", str(len(cp.messages)))
            console.print(table)

            if cp.messages:
                recent_msgs = cp.messages[-limit:]
                console.print(
                    f"\n[bold sky_blue1]Recent Conversation History (Last {len(recent_msgs)} messages):[/bold sky_blue1]"
                )
                for msg in recent_msgs:
                    role = msg.get("role") or msg.get("type", "unknown")
                    content = msg.get("text") or msg.get("content") or ""
                    if isinstance(content, list):
                        content = " ".join(str(c) for c in content)
                    preview = str(content).strip()
                    if len(preview) > 200:
                        preview = preview[:197] + "..."
                    role_color = "cyan" if role in ("user", "human") else "green"
                    console.print(
                        f"[{role_color}][bold]{role.capitalize()}:[/bold] {preview}[/{role_color}]"
                    )
        except Exception as err:  # noqa: BLE001
            console.print(f"[red]Failed to read thread history: {err}[/red]")
        return True

    # Intercept unknown slash commands to avoid accidental costly model prompts
    if text.startswith("/"):
        cmd_name = text.split()[0]
        console.print(
            f"[yellow]Unknown command: [bold]{cmd_name}[/bold]. Type '[bold]/help[/bold]' to see available commands.[/yellow]"
        )
        return True

    return False
