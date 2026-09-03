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
