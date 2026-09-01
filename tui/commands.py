"""
Slash command definitions and dispatcher for Mini Agent TUI.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
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
        title="Mini Agent Terminal Studio (TUI) 命令大全",
        border_style="cyan",
        show_lines=False,
    )
    table.add_column("分类", style="bold yellow", width=14)
    table.add_column("命令 / 格式", style="bold sky_blue1", width=28)
    table.add_column("功能说明与当前配置", style="white")

    # 1. 工作流模式
    table.add_row("工作流模式", "/plan [on|off]", "开启/切换只读 Plan Mode (只读架构探索)")
    table.add_row("", "/goal <目标描述>", "启动目标驱动多里程碑无人值守收敛任务")
    table.add_row("", "/goal", "查看当前活动 Goal 进度与各里程碑收敛状态")
    table.add_row("", "/workflows", "探测工作区内规范与计划文件 (plan.md, AGENTS.md)")

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

    # 3. 安全与审批策略
    table.add_row(
        "安全与审批",
        "/policy [mode]",
        f"切换审批策略: per_action, auto_approve, strict (别名: /approve | 当前: [bold cyan]{state.approval_policy}[/bold cyan])",
    )
    table.add_row(
        "",
        "/clear-approvals",
        f"清空已记住的工具放行缓存 (当前记住: {len(state.remembered_approvals)} 个)",
    )
    table.add_row(
        "",
        "/profile [mode]",
        f"查看或切换系统 Profile: interactive, auto, ask (当前: [bold cyan]{state.profile}[/bold cyan])",
    )

    # 4. 会话与多分支管理
    table.add_row("会话管理", "/threads", "列出所有历史会话与分支列表")
    table.add_row("", "/new [thread_id]", "新建并切换至新会话线程")
    table.add_row("", "/fork <new_id>", "分叉当前会话历史为新的实验分支")
    table.add_row("", "/switch <thread_id>", "切换当前活跃会话线程")
    table.add_row("", "/history [n|all]", "查看当前会话已结算 Checkpoint 与消息回放 (别名: /checkpoint)")

    # 5. 工作区与环境探测
    table.add_row("工作区探测", "/status", "查看运行时环境、Server 状态与轮次遥测总览")
    table.add_row("", "/mcp", "查看已启用的 MCP 服务与扩展工具状态")
    table.add_row("", "/git", "查看当前工作区 Git 分支及未提交变更 (别名: /diff)")
    table.add_row("", "/files [query]", "检索当前工作区代码文件路径 (别名: /ls)")
    table.add_row("", "!<command>", "直接在宿主环境执行本地 Shell 命令 (如 !git status, !cargo test)")

    # 6. 通用控制
    table.add_row("通用控制", "/copy [all]", "复制模型最新回复或完整会话 Markdown 到剪贴板 (别名: /cp)")
    table.add_row("", "/clear", "清空终端屏幕")
    table.add_row("", "/help", "显示本命令参考大全")
    table.add_row("", "/exit / /quit", "退出 TUI 交互终端")

    console.print(table)


async def handle_slash_command(
    text: str, state: TUIState, client: MiniAgentClient, init_res: dict[str, str] | None = None
) -> bool:
    """
    Check if the user input is a slash command or shell escape (!cmd) and handle it.
    Returns True if handled, False if it should proceed as a model turn prompt.
    """
    if text.startswith("!"):
        cmd_to_run = text[1:].strip()
        if not cmd_to_run:
            console.print(
                "[dim yellow]Usage: !<shell_command> (e.g. !git status, !pytest, !cargo test)[/dim yellow]"
            )
            return True

        console.print(f"[dim]⚡ Executing shell command: [bold cyan]{cmd_to_run}[/bold cyan][/dim]")
        try:
            def _run_shell() -> int:
                if sys.platform == "win32":
                    shell_exe = shutil.which("pwsh") or shutil.which("powershell")
                    if shell_exe:
                        res = subprocess.run(
                            [shell_exe, "-NoProfile", "-Command", cmd_to_run],
                            check=False,
                        )
                        return res.returncode
                res = subprocess.run(
                    cmd_to_run,
                    shell=True,
                    check=False,
                )
                return res.returncode

            code = await asyncio.to_thread(_run_shell)
            if code != 0:
                console.print(f"[dim red]Command exited with code {code}[/dim red]\n")
            else:
                console.print("[dim green]✓ Command succeeded (exit 0)[/dim green]\n")
        except Exception as err:  # noqa: BLE001
            console.print(f"[bold red]Failed to execute shell command: {err}[/bold red]\n")
        return True

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

    if lower_text.startswith(("/copy", "/cp")):
        parts = text.split(maxsplit=1)
        sub_arg = parts[1].strip().lower() if len(parts) > 1 else ""

        text_to_copy = ""
        desc = ""

        if sub_arg in ("all", "thread", "full"):
            try:
                cp = await client.read_thread(state.current_thread_id)
                lines = [f"# Thread: {state.current_thread_id}\n"]
                for msg in cp.messages:
                    role = str(msg.get("role") or msg.get("type") or "user").capitalize()
                    content = msg.get("text") or msg.get("content") or ""
                    if isinstance(content, list):
                        content = "\n".join(str(c) for c in content)
                    lines.append(f"### {role}\n\n{content}\n")
                text_to_copy = "\n".join(lines).strip()
                desc = f"full thread conversation ({len(cp.messages)} messages)"
            except Exception as err:  # noqa: BLE001
                console.print(f"[red]Failed to read thread messages: {err}[/red]")
                return True
        else:
            if state.last_assistant_response:
                text_to_copy = state.last_assistant_response
                desc = "latest assistant response"
            else:
                try:
                    cp = await client.read_thread(state.current_thread_id)
                    for msg in reversed(cp.messages):
                        role = str(msg.get("role") or msg.get("type") or "").lower()
                        if role in ("assistant", "model", "bot"):
                            content = msg.get("text") or msg.get("content") or ""
                            if isinstance(content, list):
                                content = "\n".join(str(c) for c in content)
                            if content.strip():
                                text_to_copy = content.strip()
                                desc = "latest assistant response"
                                break
                except Exception:  # noqa: BLE001, S110
                    pass

        if not text_to_copy:
            console.print("[yellow]No assistant response or summary available to copy yet.[/yellow]")
            return True

        from tui.clipboard import copy_to_clipboard

        success = copy_to_clipboard(text_to_copy)
        if success:
            console.print(
                f"[green]✓ Copied {desc} ([bold]{len(text_to_copy)}[/bold] chars, Markdown) to system clipboard.[/green]"
            )
        else:
            console.print(
                f"[yellow]Failed to copy to clipboard on this environment. Markdown content preview ({len(text_to_copy)} chars):[/yellow]\n"
                f"[dim]{text_to_copy[:300]}...[/dim]"
            )
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
                        res.get("actionId", "ok")
                        if isinstance(res, dict)
                        else "ok"
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
            f"{init_res.get('serverName', 'mini-agent-app-server')} v{init_res.get('serverVersion', '0.6.0')}"
            if init_res
            else "mini-agent-app-server"
        )
        table = Table(
            title="Mini Agent Runtime Status", border_style="cyan"
        )
        table.add_column("Property", style="bold sky_blue1", width=22)
        table.add_column("Value", style="white")
        table.add_row("Server", server_info)
        table.add_row("Workspace Root", str(Path.cwd().resolve()))
        table.add_row("Active Profile", state.profile)
        table.add_row("Approval Policy", state.approval_policy)
        table.add_row(
            "Remembered Approvals",
            f"{len(state.remembered_approvals)} tools",
        )
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

    if lower_text in ("/git", "/diff"):
        try:
            def _get_git_info() -> tuple[str, list[str]]:
                b_proc = subprocess.run(
                    ["git", "branch", "--show-current"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                branch_name = b_proc.stdout.strip() or "main"
                s_proc = subprocess.run(
                    ["git", "status", "--porcelain"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                out_lines = [
                    ln.strip()
                    for ln in s_proc.stdout.splitlines()
                    if ln.strip()
                ]
                return branch_name, out_lines

            branch, lines = await asyncio.to_thread(_get_git_info)
            table = Table(
                title=f"Git Status (Branch: {branch})",
                border_style="green" if not lines else "yellow",
            )
            table.add_column("Status", style="bold cyan", width=10)
            table.add_column("File Path", style="white")
            if not lines:
                table.add_row(
                    "Clean",
                    "[dim]Working tree clean, no changes[/dim]",
                )
            else:
                for line in lines:
                    st = line[:2].strip()
                    fp = line[3:].strip()
                    table.add_row(st, fp)
            console.print(table)
        except Exception as err:  # noqa: BLE001
            console.print(f"[red]Git check failed: {err}[/red]")
        return True

    if lower_text.startswith(("/files", "/ls")):
        parts = text.split(maxsplit=1)
        query = parts[1].strip().lower() if len(parts) > 1 else ""
        ignore_dirs = {
            ".git",
            "node_modules",
            "__pycache__",
            ".venv",
            "venv",
            ".pytest_cache",
            ".ruff_cache",
            "dist",
            "build",
            "target",
        }
        matches = []
        for root, dirs, files in os.walk(Path.cwd()):
            dirs[:] = [
                d
                for d in dirs
                if d not in ignore_dirs and not d.startswith(".")
            ]
            rel_root = Path(root).relative_to(Path.cwd())
            for f in files:
                if f.startswith(".") and f != ".env.example":
                    continue
                rel_p = (
                    str(rel_root / f).replace("\\", "/")
                    if str(rel_root) != "."
                    else f
                )
                if not query or query in rel_p.lower():
                    matches.append(rel_p)
                    if len(matches) >= 30:
                        break
            if len(matches) >= 30:
                break
        matches.sort()
        table = Table(
            title=f"Workspace Files ({len(matches)} matches)",
            border_style="sky_blue1",
        )
        table.add_column("File Path", style="white")
        for m in matches:
            table.add_row(m)
        console.print(table)
        return True

    if lower_text == "/workflows":
        candidates = [
            "plan.md",
            "goal/plan.md",
            "goal/milestones.json",
            "AGENTS.md",
            "README.md",
        ]
        table = Table(
            title="Workflow & Architecture Files",
            border_style="cyan",
        )
        table.add_column("File", style="bold sky_blue1", width=24)
        table.add_column("Exists", style="green", width=10)
        table.add_column("Path", style="dim")
        for c in candidates:
            p = Path.cwd() / c
            exists = p.exists()
            table.add_row(
                c,
                "✓ Yes" if exists else "No",
                str(p.resolve()) if exists else "-",
            )
        console.print(table)
        return True

    if lower_text.startswith("/profile"):
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            target_profile = parts[1].strip().lower()
            if target_profile in ("interactive", "auto", "ask"):
                state.profile = target_profile
                if target_profile == "ask":
                    await client.set_plan_mode(True)
                else:
                    await client.set_plan_mode(False)
                console.print(
                    f"[green]✓ System Profile switched to: [bold]{state.profile}[/bold][/green]"
                )
            else:
                console.print(
                    "[yellow]Invalid profile. Choose from: interactive, auto, ask[/yellow]"
                )
        else:
            table = Table(
                title="Mini Agent System Profiles",
                border_style="cyan",
            )
            table.add_column("Profile ID", style="bold sky_blue1", width=16)
            table.add_column("Status", style="green", width=12)
            table.add_column("说明与适用场景", style="white")
            table.add_row(
                "interactive",
                "✓ Active" if state.profile == "interactive" else "",
                "日常人机结对协作与单步工具把控 (默认/推荐)",
            )
            table.add_row(
                "auto",
                "✓ Active" if state.profile == "auto" else "",
                "目标驱动多里程碑无人值守收敛",
            )
            table.add_row(
                "ask",
                "✓ Active" if state.profile == "ask" else "",
                "严格只读问答与架构探索 (支持 /plan)",
            )
            console.print(table)
            console.print(
                "[dim]用法: [cyan]/profile <interactive | auto | ask>[/cyan][/dim]"
            )
        return True

    if lower_text.startswith(("/policy", "/approve")):
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
        return True

    if lower_text == "/clear-approvals":
        state.remembered_approvals.clear()
        console.print("[green]✓ Cleared all remembered tool approvals for this session.[/green]")
        return True

    if lower_text.startswith("/plan"):
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            arg = parts[1].strip().lower()
            if arg in ("on", "true", "1", "enable"):
                res = await client.set_plan_mode(True)
            elif arg in ("off", "false", "0", "disable"):
                res = await client.set_plan_mode(False)
            else:
                wf = await client.get_workflow_state()
                res = await client.set_plan_mode(not wf.plan_active)
        else:
            wf = await client.get_workflow_state()
            res = await client.set_plan_mode(not wf.plan_active)
        console.print(
            f"[yellow]Plan Mode is now: {'ACTIVE (Read-Only 探索模式)' if res.plan_active else 'OFF'}[/yellow]"
        )
        return True

    if lower_text.startswith("/goal"):
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            target_goal = parts[1].strip()
            res = await client.start_goal(target_goal)
            console.print(
                f"[green]✓ Goal started ({res.goal.goal_id}): [bold]{res.goal.objective}[/bold]\n"
                f"Milestones: {res.goal.total_milestones} | Status: {res.goal.status}[/green]"
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
        return True

    if lower_text == "/threads":
        res = await client.list_threads()
        table = Table(title="Historical Threads", border_style="sky_blue1")
        table.add_column("Thread ID", style="bold sky_blue1")
        table.add_column("Active", style="green")
        for tid in res.data:
            table.add_row(
                tid, "✓ Current" if tid == state.current_thread_id else ""
            )
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
