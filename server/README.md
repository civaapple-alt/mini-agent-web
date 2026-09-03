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
| `/api/threads` | Thread 列表、创建、读取、分叉、摘要和关闭 |
| `/api/threads/{thread_id}/items` | 有界 ThreadItem 历史投影 |
| `/api/threads/{thread_id}/settings` | Thread collaboration mode 和 Builtin tools |
| `/api/threads/{thread_id}/goal` | Thread Goal 的读取、设置和清除 |
| `/api/agent/*` | Turn、Steer、Interrupt 和审批 HTTP 操作 |
| `/api/world/*` | World、MCP、Git 和本地工作区探测 |
| `/api/projects/*` | 本地项目元数据管理 |
| `/api/settings` | 网关偏好设置 |
| `/api/workflows/state` | 只读 workflow 聚合投影 |

Thread、Turn、Goal 和 ThreadItem 的运行时语义来自 App Server；网关不创建
第二套运行时状态机。

访问和批准是当前 Project 的执行设置：`project` / `full_machine` 控制路径范围，
`per_action` / `current_session` / `current_project` 控制批准复用生命周期。
`full_machine` 只表示整机路径范围，不是 allow-all；Deny、Plan 锁、工具可用性和
仍需人工确认的高风险动作继续由 App Server/Host 执行。Auto Copilot 是
`Goal + full_machine + current_project` 的明确组合。

Project 的主目录和关联目录会在启动 SDK 时分别绑定为主工作区、额外可写根目录或
只读参考根目录。切换或编辑 Project 会重启并重绑 Host；Web 的 UI 状态只保存
Project 清单和界面偏好，Session history、Goal、checkpoint 和批准授权由
App Server 的 canonical Session/Runtime 所有。

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
