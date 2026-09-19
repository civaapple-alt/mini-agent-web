# `mini-agent` Python SDK

本目录是 `mini-agent` Python 包。SDK 通过 stdio JSON-RPC 连接
`mini-agent-app-server`，提供异步 client、协议类型和有界事件解析。它不拥有
Agent Loop、Session history、授权 grant 或恢复策略。

## 安装

发布包：

```bash
pip install mini-agent
```

在本工作区开发：

```bash
uv sync
```

SDK 需要 Python 3.10 或更高版本，且运行时不依赖第三方 Python 包。确保
`mini-agent-app-server` 在 `PATH` 中，或设置 `MINI_AGENT_APP_SERVER_PATH`。

## 最小示例

```python
import asyncio

from mini_agent import MiniAgentClient


async def main() -> None:
    async with MiniAgentClient() as client:
        await client.initialize()
        await client.start_thread()

        async for envelope in client.stream_turn("List the files in the workspace."):
            if envelope["type"] != "event":
                continue
            event = envelope["typed_event"]
            if event.event_type == "assistant_text_delta":
                print(event.delta, end="", flush=True)


asyncio.run(main())
```

## 支持的 SDK 边界

| 范围 | 主要方法 |
| --- | --- |
| 连接与协议 | `start()`、`stop()`、`initialize()` |
| Thread | `start_thread()`、`list_threads()`、`read_thread()`、`close_thread()`、`fork_thread()`、`resume_thread()` |
| Turn | `start_turn()`、`stream_turn()`、`read_turn()`、`wait_for_turn()`、`steer_turn()`、`interrupt_turn()` |
| 观察 | `get_runtime_status()`、`replay_events()`、`list_thread_items()` |
| Session | `get_session_info()`、`fork_session()`、`read_notebook()`、`write_notebook()`、`forget_notebook()` |
| 控制 | `update_thread_settings()`、Goal 方法、`get_world_state()`、`set_world_execution()`、MCP 方法 |
| 本地任务 | 后台 Shell task 与 scheduled task 的 list/read/control 方法 |

`AsyncMiniAgentClient` 是 `MiniAgentClient` 的兼容别名。`ThreadItem` 是
App Server history 的读取投影，不是 SDK 的第二个持久化存储。

当前协议版本为 1。SDK 保留未知事件为 `GenericEvent`，使较新的 App Server 事件
不会立即破坏较旧的 SDK consumer。调用方应使用 `ThreadItem.status` 呈现生命周期，
使用 `ThreadItem.outcome` 判断结构化工具结果，不能从工具输出文本推断审批或重试。

## 审批与通知

`approval_handler` 接收尚未由运行时结算的审批请求，并必须返回
`{"decision": "approve" | "deny", "grantScope": ...}`。未提供 handler 时 SDK
拒绝请求。`notification_handler` 接收 `turn/event`、item 生命周期、运行时状态和
传输错误通知。回调应尽快把工作交给调用方自己的队列，避免阻塞 SDK 的读取循环。

执行控制由 `access`（`project` 或 `full_machine`）和 `policy`（`interactive`、
`automatic` 或 `trusted`）组成。`full_machine` 只扩大候选路径范围，不等于
allow-all。Deny、Plan 锁、工具可用性和高风险确认仍由 Host/App Server 执行。
审批响应的 `grantScope`（`once`、`session` 或 `project`）是一次授权的生命周期。

每个 JSON-RPC 请求默认在 30 秒后超时。你可以通过
`MiniAgentClient(request_timeout=...)` 为本地环境调整该值。超时会清理 pending
request 并抛出 `ServerProcessError`。`AppServerError` 保留 JSON-RPC 的 `code`、
`message` 和 `data`。`session/fork` 的身份或 context-policy 冲突使用
`SESSION_FORK_CONFLICT_CODE`（`-32001`）。

`search_notebook()` 已存在于当前 SDK 实现中，但 App Server protocol v1 尚未定义
对应的公开 RPC。兼容 protocol v1 的调用方应使用 `read_notebook()`，不要依赖该
helper。

## 深入阅读

[`python-sdk-guide.md`](python-sdk-guide.md) 说明 client 生命周期、事件处理、
审批、恢复和协议验证方式。

## 开发检查

```bash
uv run ruff check sdk/python
uv run ruff format --check sdk/python
uv run pytest tests/sdk/ -q
```

包版本与协议字段由工作区发布流程统一维护。本目录只维护 SDK 实现和公共导出。

## License

MIT License.
