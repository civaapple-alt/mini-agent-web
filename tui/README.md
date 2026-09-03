# Terminal TUI

本目录是 Mini Agent 的终端交互界面。它通过 Python SDK 接收流式事件，使用
Rich 输出思考、文本、工具、审批和轮次结算信息，并提供斜杠命令。

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

参数包括 `--access`、`--approval`、`--effort` 和 `--thread`。运行时按 `/help`
查看完整命令表。

## 命令分组

- 工作流：`/plan`、`/goal`、`/workflows`；
- 运行控制：`/steer`、`/clear`、`/exit`；
- 执行控制：`/access`、`/approval`、`/effort`；
- Thread：`/threads`、`/new`、`/fork`、`/switch`、`/history`；
- 工作区：`/status`、`/mcp`、`/git`、`/files`、`!<command>`；
- 输出：`/copy`、`/cp`。

## 文件分工

```text
tui_app.py          CLI 入口和主循环
state.py            TUIState、轮次指标和 ThreadItem 投影
stream_renderer.py  事件流到终端输出的规约
commands.py         斜杠命令
approvals.py        审批交互
completer.py        命令补全
clipboard.py        剪贴板操作
```

TUI 只保存当前界面的有界投影；ThreadItem 使用稳定 item ID 更新，不另建持久化
Item store。
