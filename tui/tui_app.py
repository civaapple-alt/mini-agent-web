"""
Rich-based Terminal User Interface (TUI) for Mini Agent.
Provides an interactive, visually rich CLI chat with thinking streams, tool badges,
approval prompts, and full slash command workflows (/plan, /goal, /policy, /threads, /switch, /help).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
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
    effort: str = "medium"  # low | medium | high
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
    table = Table(
        title="Mini Agent Terminal Studio (TUI) 命令大全",
        border_style="cyan",
        show_lines=False,
    )
    table.add_column("分类", style="bold yellow", width=14)
    table.add_column("命令 / 格式", style="bold sky_blue1", width=26)
    table.add_column("功能说明与当前配置", style="white")

    # 1. 工作流模式
    table.add_row("🎯 工作流模式", "/plan", "开启/切换只读 Plan Mode (只读架构与方案探索)")
    table.add_row("", "/goal <目标描述>", "启动目标驱动多里程碑无人值守收敛任务")
    table.add_row("", "/goal", "查看当前活动 Goal 进度与各里程碑收敛状态")
    table.add_row("", "/workflows", "探测工作区内规范与计划文件 (plan.md, AGENTS.md)")

    # 2. 模型与思考控制
    table.add_row(
        "💭 模型与思考",
        "/effort [low|med|high]",
        f"查看或切换思考链强度 (当前: [bold cyan]{state.effort}[/bold cyan])",
    )

    # 3. 安全与审批策略
    table.add_row(
        "🛡️ 安全与审批",
        "/policy [mode]",
        f"切换审批策略: per_action, auto_approve, strict (当前: [bold cyan]{state.approval_policy}[/bold cyan])",
    )
    table.add_row(
        "",
        "/clear-approvals",
        f"清空已记住的工具放行缓存 (当前记住: {len(state.remembered_approvals)} 个)",
    )
    table.add_row(
        "",
        "/profile",
        f"查看当前客户端启动 Profile (当前: [bold cyan]{state.profile}[/bold cyan])",
    )

    # 4. 会话与多分支管理
    table.add_row("🧵 会话管理", "/threads", "列出所有历史会话与分支列表")
    table.add_row("", "/new [thread_id]", "新建并切换至新会话线程")
    table.add_row("", "/switch <thread_id>", "切换当前活跃会话线程")
    table.add_row("", "/history", "查看当前会话已结算 Checkpoint 与轮次")

    # 5. 工作区与环境探测
    table.add_row("📂 工作区探测", "/status", "查看运行时环境、Server 状态与配置总览")
    table.add_row("", "/git", "查看当前工作区 Git 分支及未提交变更")
    table.add_row("", "/files [query]", "快速检索当前工作区代码文件路径")

    # 6. 通用控制
    table.add_row("⚡ 通用控制", "/clear", "清空终端屏幕")
    table.add_row("", "/help", "显示本命令参考大全")
    table.add_row("", "exit / quit / :q / q", "退出 TUI 交互终端")

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

            if text.lower().startswith("/effort") or text.lower().startswith("/reasoning"):
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
                continue

            if text.lower() == "/status":
                table = Table(
                    title="Mini Agent Runtime Status", border_style="cyan"
                )
                table.add_column("Property", style="bold sky_blue1", width=22)
                table.add_column("Value", style="white")
                table.add_row(
                    "Server",
                    f"{init_res.get('serverName')} v{init_res.get('serverVersion')}",
                )
                table.add_row(
                    "Workspace Root", str(Path.cwd().resolve())
                )
                table.add_row("Active Profile", state.profile)
                table.add_row("Approval Policy", state.approval_policy)
                table.add_row(
                    "Remembered Approvals",
                    f"{len(state.remembered_approvals)} tools",
                )
                table.add_row("Reasoning Effort", state.effort)
                table.add_row("Active Thread", state.current_thread_id)
                console.print(table)
                continue

            if text.lower() in ("/git", "/diff"):
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
                continue

            if text.lower().startswith("/files") or text.lower().startswith("/ls"):
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
                table = Table(
                    title=f"Workspace Files ({len(matches)} matches)",
                    border_style="sky_blue1",
                )
                table.add_column("File Path", style="white")
                for m in matches:
                    table.add_row(m)
                console.print(table)
                continue

            if text.lower() == "/workflows":
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
                table.add_column("File", style="bold sky_blue1", width=25)
                table.add_column("Status", style="green", width=12)
                table.add_column("Size / Note", style="white")
                for c in candidates:
                    p = Path.cwd() / c
                    if p.is_file():
                        table.add_row(
                            c, "✓ Present", f"{p.stat().st_size} bytes"
                        )
                    else:
                        table.add_row(
                            c, "[dim]Absent[/dim]", "[dim]Not found[/dim]"
                        )
                console.print(table)
                continue

            if text.lower() == "/profile":
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
                    "autonomous",
                    "✓ Active" if state.profile == "autonomous" else "",
                    "目标驱动多里程碑无人值守收敛",
                )
                table.add_row(
                    "strict",
                    "✓ Active" if state.profile == "strict" else "",
                    "严格只读审计与架构探索 (亦可通过 /plan 快捷切换)",
                )
                console.print(table)
                console.print(
                    "[dim]提示: 切换 Profile 可重启 TUI: [cyan]mini-agent-tui --profile <interactive|autonomous|strict>[/cyan]\n"
                    "或在会话中输入 [yellow]/plan[/yellow] 实时进入只读严格规划模式。[/dim]"
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

            if text.lower().startswith("/new"):
                parts = text.split(maxsplit=1)
                new_thread = (
                    parts[1].strip()
                    if len(parts) > 1
                    else f"session-{int(asyncio.get_running_loop().time())}"
                )
                await client.start_thread(new_thread)
                state.current_thread_id = new_thread
                console.print(
                    f"[green]✓ Created and switched to new thread: [bold]{new_thread}[/bold][/green]"
                )
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

            if text.lower() in ("/history", "/checkpoint"):
                try:
                    cp = await client.read_thread(state.current_thread_id)
                    table = Table(
                        title=f"Thread Checkpoint: {state.current_thread_id}",
                        border_style="sky_blue1",
                    )
                    table.add_column(
                        "Property", style="bold sky_blue1", width=22
                    )
                    table.add_column("Value", style="white")
                    table.add_row("Turn ID", str(cp.turn_id or "N/A"))
                    table.add_row("Sequence", str(cp.sequence))
                    table.add_row("Status", str(cp.status or "active"))
                    table.add_row("Model Visible Turns", str(len(cp.turns)))
                    console.print(table)
                except Exception as err:  # noqa: BLE001
                    console.print(
                        f"[red]Failed to read thread history: {err}[/red]"
                    )
                continue

            console.print("\n[bold green]Mini Agent[/bold green]:")

            current_mode = None  # None | "thinking" | "text"

            try:
                async for item in client.stream_turn(
                    user_input,
                    thread_id=state.current_thread_id,
                    effort=state.effort,
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
