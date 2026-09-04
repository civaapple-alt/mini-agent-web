# Experimental Python SDK Verification TUI

本目录是 Mini Agent 的实验性 Python SDK/App Server 验证边界。它通过 Python
SDK 接收流式事件，使用 Rich 输出思考、文本、工具、审批和本轮结果，并提供
少量与 App Server 对齐的斜杠命令。Web Studio 是用户主流程，TUI 不另建执行
循环、历史存储或控制平面。

## 启动

```bash
uv run mini-agent-tui
```

也可以直接运行模块：

```bash
uv run python -m tui.tui_app
```

常用参数：

```bash
uv run mini-agent-tui --access project --approval per_action --effort high --thread default
```

参数包括 `--access`、`--approval`、`--effort` 和 `--thread`。它们只选择这次
验证客户端的初始设置，不构成 Profile。运行时按 `/help` 查看当前命令表。

## 命令分组

- Runtime：`/plan`、`/goal`；
- 运行控制：`/steer`、`/clear`、`/exit`；
- 执行控制：`/access`、`/approval`、`/effort`；
- Thread：`/threads`、`/new`、`/fork`、`/switch`、`/history`；
- 验证观察：`/status`、`/mcp`。

普通文本始终作为当前 Thread 的模型 Turn 提交；TUI 不提供 shell escape、Git/
文件旁路或复制命令。访问范围和批准生命周期通过 SDK 写入 App Server，Plan/
Goal 也始终绑定当前 Thread。

## 文件分工

```text
tui_app.py          CLI 入口和主循环
state.py            TUIState、轮次指标和 ThreadItem 投影
stream_renderer.py  事件流到终端输出的规约
commands.py         斜杠命令
approvals.py        审批交互
completer.py        命令补全
```

TUI 只保存当前界面的有界投影；ThreadItem 使用稳定 item ID 更新，不另建持久化
Item store。
