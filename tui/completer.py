"""
Autocompletion and contextual parameter suggestions for Mini Agent TUI.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from prompt_toolkit.completion import Completer, Completion

if TYPE_CHECKING:
    from tui.state import TUIState


class SlashCommandCompleter(Completer):
    """Dynamic, contextual autocompleter for TUI slash commands, policies, and parameters."""

    def __init__(self, state: TUIState) -> None:
        self.state = state

    def get_completions(self, document: Any, complete_event: Any) -> Any:
        text = document.text_before_cursor
        stripped = text.lstrip()

        # If user hasn't typed anything or not starting with slash or exclamation mark
        if not stripped.startswith("/") and not stripped.startswith("!"):
            return

        words = stripped.split(maxsplit=1)

        # 0. Shell command prefix (!cmd)
        if stripped.startswith("!"):
            prefix = words[0].lower()
            shell_hints = [
                ("!git status", "执行 git status 查看仓库工作区状态"),
                ("!git diff", "执行 git diff 查看未暂存文件差异"),
                ("!git log -n 5", "查看最近 5 次 Git 提交记录"),
                ("!pytest", "运行 Python 自动化单元测试"),
                ("!cargo test", "运行 Rust 单元与集成测试"),
                ("!uv run", "使用 uv 运行指定脚本或命令"),
            ]
            for cmd, desc in shell_hints:
                if cmd.lower().startswith(prefix):
                    yield Completion(
                        cmd,
                        start_position=-len(prefix),
                        display=cmd,
                        display_meta=desc,
                    )
            return

        # 1. Completing the top-level slash command itself
        if len(words) == 1 and not stripped.endswith(" "):
            prefix = words[0].lower()
            commands = [
                ("/plan", "开启/切换只读 Plan Mode (架构与规划探索)"),
                ("/goal", "启动/查看目标驱动多里程碑收敛任务"),
                ("/steer", "向当前轮次注入实时纠偏指令 (Steering Guidance)"),
                ("/approval", "查看/切换批准复用范围"),
                ("/access", "查看/切换访问范围"),
                ("/effort", "查看/切换思考链强度 (low|medium|high)"),
                ("/reasoning", "切换思考链强度别名"),
                ("/threads", "列出所有历史会话与分支列表"),
                ("/new", "新建并切换至新会话线程"),
                ("/fork", "分叉当前会话历史为新的实验分支"),
                ("/switch", "切换当前活跃会话线程分支"),
                ("/history", "查看当前会话已结算 Checkpoint 与轮次"),
                ("/checkpoint", "查看会话 Checkpoint 别名"),
                ("/status", "查看运行时环境、Server 状态与配置总览"),
                ("/mcp", "查看已启用的 MCP 服务与扩展工具状态"),
                ("/git", "查看当前工作区 Git 分支及未提交变更"),
                ("/diff", "查看 Git 变更别名"),
                ("/files", "快速检索当前工作区代码文件路径"),
                ("/workflows", "探测工作区内规范与计划文件"),
                ("/copy", "复制模型最新回复或完整会话 Markdown 到系统剪贴板"),
                ("/cp", "复制回复 Markdown 别名"),
                ("/clear", "清空终端屏幕"),
                ("/help", "显示完整命令参考大全"),
                ("/exit", "退出 TUI 交互终端"),
                ("/quit", "退出 TUI 交互终端"),
            ]
            for cmd, desc in commands:
                if cmd.lower().startswith(prefix):
                    yield Completion(
                        cmd,
                        start_position=-len(prefix),
                        display=cmd,
                        display_meta=desc,
                    )
            return

        # 2. Sub-command arguments / options autocomplete
        cmd = words[0].lower()
        sub_text = words[1] if len(words) > 1 else ""
        if stripped.endswith(" ") and len(words) == 1:
            sub_prefix = ""
        else:
            sub_prefix = sub_text.lower()

        if cmd == "/approval":
            policies = [
                ("per_action", "每次敏感操作单独确认"),
                ("current_session", "当前 Session 内复用批准"),
                ("current_project", "当前 Project 内复用批准"),
            ]
            for p_name, p_desc in policies:
                if p_name.startswith(sub_prefix):
                    yield Completion(
                        p_name,
                        start_position=-len(sub_prefix),
                        display=p_name,
                        display_meta=p_desc,
                    )
        elif cmd in ("/effort", "/reasoning"):
            efforts = [
                ("low", "轻量快速响应"),
                ("medium", "标准中等深度推理思考 (推荐)"),
                ("high", "多步深度强化推理思考"),
            ]
            for e_name, e_desc in efforts:
                if e_name.startswith(sub_prefix):
                    yield Completion(
                        e_name,
                        start_position=-len(sub_prefix),
                        display=e_name,
                        display_meta=e_desc,
                    )
        elif cmd == "/access":
            access_options = [
                ("project", "仅限当前 Project 的工作区范围"),
                ("full_machine", "整机访问范围，仍受安全拒绝和批准控制"),
            ]
            for pr_name, pr_desc in access_options:
                if pr_name.startswith(sub_prefix):
                    yield Completion(
                        pr_name,
                        start_position=-len(sub_prefix),
                        display=pr_name,
                        display_meta=pr_desc,
                    )
        elif cmd == "/plan":
            plan_options = [
                ("on", "开启只读 Plan 架构探索模式"),
                ("off", "关闭 Plan 模式 (恢复正常读写执行)"),
            ]
            for p_name, p_desc in plan_options:
                if p_name.startswith(sub_prefix):
                    yield Completion(
                        p_name,
                        start_position=-len(sub_prefix),
                        display=p_name,
                        display_meta=p_desc,
                    )
