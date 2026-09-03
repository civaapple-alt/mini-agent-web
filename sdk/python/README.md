# `mini-agent` Python SDK

本目录是 `mini-agent` 的独立 Python 包。它通过 Stdio JSON-RPC 连接
`mini-agent-app-server`，提供异步客户端、协议类型和事件解析，不负责 Web
页面或终端展示。

## 安装

发布包：

```bash
pip install mini-agent
```

在本工作区开发：

```bash
uv sync
```

## 最小示例

```python
import asyncio
from mini_agent import MiniAgentClient


async def main():
    async with MiniAgentClient() as client:
        await client.initialize()
        await client.start_thread()

        async for envelope in client.stream_turn("List the files in the workspace."):
            if envelope["type"] == "event":
                event = envelope["typed_event"]
                if event.event_type == "assistant_text_delta":
                    print(event.delta, end="", flush=True)


asyncio.run(main())
```

如果 App Server 不在 `PATH`，设置 `MINI_AGENT_APP_SERVER_PATH`。SDK 运行时只
使用 Python 3.10+ 标准库。

## 公共表面

- `MiniAgentClient` / `AsyncMiniAgentClient`：初始化、Thread、Turn、Goal、
  执行范围、审批、Steer 和 Interrupt；
- `stream_turn()`：按 Thread/Turn 过滤事件，并保留未知事件为
  `GenericEvent`；
- `ThreadItem`：Turn 事件和 `turn/read` 中的有界 item 投影；
- `ItemLifecycleNotification`：`item/started` 和 `item/completed` 的类型化
  通知；
- `list_thread_items()`：读取 `thread/items/list` 的游标分页结果；
- `types.py`：协议结果、Goal、设置、Session history 和错误相关数据类。

执行控制由 Project 的 `access`（`project` / `full_machine`）和
`approval`（`per_action` / `current_session` / `current_project`）组成。
`full_machine` 只扩大路径范围，不等于 allow-all；Deny、Plan 锁、工具可用性和
仍需确认的高风险动作继续生效。Auto Copilot 是 `Goal + full_machine +
current_project` 的明确组合。

ThreadItem 是 App Server Session history 的读取投影，不是 SDK 的第二个持久化存储。

## 深入阅读

[`python-sdk-guide.md`](python-sdk-guide.md) 介绍 SDK 的完整生命周期、配置、
流式事件、审批、ThreadItem、分支和 Goal API。

## 开发检查

```bash
uv run ruff check sdk/python
uv run ruff format --check sdk/python
```

包的版本与协议字段由工作区发布流程统一维护；本目录只维护 SDK 自己的实现和
公共导出。

## License

MIT，详见 [`LICENSE`](LICENSE)。
