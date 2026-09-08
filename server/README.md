# FastAPI Gateway

本目录实现 Mini Agent 的本地 FastAPI 网关。它管理 App Server 子进程，将
Python SDK 能力映射为 REST/WebSocket，并负责本地连接、审批和项目元数据的
网关级管理。

## 启动

```bash
uv run mini-agent-server
```

开发模式：

```bash
uv run mini-agent-server-dev
```

默认监听 `http://127.0.0.1:8000`，OpenAPI 页面为 `/docs`。静态 Web 资源
存在时，根路径同时提供 Web Studio。

## 路由边界

| 路由 | 作用 |
| --- | --- |
| `/ws/agent` | Turn 流、审批、Steer、Interrupt 和 runtime notifications |
| `/api/threads` | Thread 列表、创建、读取、按 source Project 分叉、摘要和关闭 |
| `/api/threads/{thread_id}/attach` | 按可选 Project ID/name attach 历史/暂停 Session，或报告外部运行锁 |
| `/api/threads/{thread_id}/items` | 有界 ThreadItem 历史投影 |
| `/api/threads/{thread_id}/settings` | Thread collaboration mode、Builtin tools、显式推进方式和 App Server `state_revision` |
| `/api/threads/{thread_id}/goal` | Thread Goal 的读取、设置和清除 |
| `/api/agent/*` | Turn、Steer、Interrupt 和审批 HTTP 操作 |
| `/api/world/*` | World、MCP、Git 和本地工作区探测 |
| `/api/projects/*` | 本地项目元数据管理 |
| `/api/settings` | 网关偏好设置 |
| `/api/workflows/state` | 只读 workflow 聚合投影（含锁定 Session 的 canonical 状态） |

Thread、Turn、Goal 和 ThreadItem 的运行时语义来自 App Server；网关不创建
第二套运行时状态机。

同一 Thread 的 Gateway attach/start 请求在客户端创建与 canonical Session 检查
期间串行化；并发请求会复用同一个已建立的 App Server client，不会制造重复的
workspace 绑定竞争。Thread fork 也在同一 SessionManager 临界区内完成 source
client 复用、分叉、child metadata 写入和 binding；并发 attach 会等待完整绑定后
复用该 client。

Thread settings 的 `state_revision` 只是 canonical App Server revision 的有界
投影。Gateway 通过 WebSocket 原样转发 `thread/settings/updated` 以及带同一
revision 的 `thread/goal/updated|cleared`；Goal/settings REST action result 也
返回它。SDK 和 Web Studio 对每个 Thread 单调消费该 revision，Gateway 不保存
另一份 settings 或 Goal authority。历史 Session 尚未携带 revision 时返回空值；
WebSocket 重连后由 Studio 重新读取 workflow projection，以处理 App Server
重启造成的 in-memory revision 序列重置。Gateway 自己重绑 App Server 后还会
广播有界的 `gateway/runtime/restarted` generation；Studio 收到后清空旧 cursor
并执行同样的 canonical workflow read，即使浏览器 WebSocket 没有断开也不会继续
使用旧运行时的 revision。

访问和批准是当前 Project 的执行设置：`project` / `full_machine` 控制路径范围，
`interactive` / `automatic` 控制审批策略；`once` / `session` / `project`
只在审批响应中表达本次 action grant 的生命周期。
`full_machine` 只表示整机路径范围，不是 allow-all；Deny、Plan 锁、工具可用性和
仍需人工确认的高风险动作继续由 App Server/Host 执行。`trusted` 只放行经过
完整校验的普通工作区补丁更新；Shell、MCP、删除/移动和外部高风险动作仍需确认。
Auto Copilot 是 Web Studio 中显式选择的 `trusted + continuous` 运行预设，不由访问范围
或审批策略隐式推导；活动 Goal 会临时接管自己的里程碑循环。

Project 的主目录和关联目录会在启动 SDK 时分别绑定为主工作区、额外可写根目录或
只读参考根目录。切换或编辑 Project 会重启并重绑 Host；Web 的 UI 状态只保存
Project 清单和界面偏好，Session history、Goal、checkpoint 和批准授权由
App Server 的 canonical Session/Runtime 所有。若同一 Thread ID 已绑定到另一个
live Project，显式 attach 或 start 会返回 `409`，不会静默把请求路由到错误 workspace。
Fork 也沿用 source Thread 的 Project binding；如果目标 Thread ID 已属于另一个
live Project，分叉请求同样 fail closed 为 `409`。

## 文件分工

```text
app.py                 FastAPI 工厂、生命周期和静态资源
main.py                Uvicorn 启动入口
config.py              环境变量和端口配置
session_manager.py     SDK 进程、连接、审批和网关元数据
routes/agent.py        Turn 与 WebSocket
routes/threads.py      Thread 与 ThreadItem
routes/world.py        World、MCP、Git、Settings、Goal
routes/projects.py     项目元数据
routes/settings.py     网关偏好
```

## 网关开发检查

```bash
uv run ruff check server
uv run pytest tests/test_gateway_api.py -q
```
