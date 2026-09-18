# FastAPI Gateway

本目录实现 Web Studio 的本地 FastAPI Gateway。Gateway 启动并连接 Python SDK
client，将 App Server 操作映射为 HTTP 与 WebSocket API，只保存自身的 Project
和 UI 元数据。Session history、执行、审批与持久化恢复仍由 App Server 决定。

## 启动 Gateway

在仓库根目录运行常规服务：

```bash
uv run mini-agent-server
```

开发代码时使用自动重载：

```bash
uv run mini-agent-server-dev
```

默认监听 `0.0.0.0:8000`。在 `http://127.0.0.1:8000/docs` 查看生成的 API
参考；`GET /health` 返回 Gateway 健康状态。构建 `frontend/dist/` 后，`GET /`
也会提供 Web Studio。

若要把监听端口暴露给本机外的网络，请设置明确的 bind host，并在 Gateway 前配置
身份验证与网络访问控制。CORS 不限制网络访问。

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MINI_AGENT_HOST` | `0.0.0.0` | Gateway bind host |
| `MINI_AGENT_PORT` | `8000` | Gateway bind port |
| `MINI_AGENT_CORS_ORIGINS` | 本地 Vite 与 Gateway origins | 逗号分隔的允许浏览器 origins |
| `MINI_AGENT_LOG_DIR` | `logs` | Gateway client 使用的 SDK 日志目录 |
| `MINI_AGENT_LOG_LEVEL` | `INFO` | Gateway client 使用的 SDK 日志级别 |
| `MINI_AGENT_WEB_STATE_DIR` | `~/.mini-agent/web` | Gateway 的 Project、UI 与附件元数据目录 |
| `MINI_AGENT_APP_SERVER_PATH` | `PATH` 中的 `mini-agent-app-server` | SDK 使用的 App Server 可执行文件 |

不要将 `MINI_AGENT_WEB_STATE_DIR` 放在 Project workspace 内。Gateway 会拒绝
这种布局，避免上传附件意外成为 workspace 文件。

## API 分工

`/docs` 是路由级 API 契约。各模块的职责如下：

| 模块 | 路由前缀 | 职责 |
| --- | --- | --- |
| `routes/agent_turns.py` | `/api/agent`、`/api/approval` | HTTP Turn、stream、steer、interrupt 与审批响应 |
| `routes/agent_ws.py` | `/ws/agent` | 按 Project 过滤的实时 Turn 与控制消息 |
| `routes/threads.py` | `/api/threads` | Thread attach、history、事件重放、Child Session、Notebook 与后台/定时任务视图 |
| `routes/world_*.py` | `/api/world`、`/api/projects`、`/api/workflows`、`/api/skills`、`/api/mcp` | Project 设置、执行设置、本地探测、workflow、Skill 与 MCP 状态 |
| `routes/settings.py` | `/api/settings` | Gateway UI 偏好 |

`session_manager.py` 协调 SDK client、runtime 通知、审批桥接和 Project-qualified
请求路由。`control/` 中的模块提供所需的 registry 与 broker。不要在这些层新增
第二套生命周期、授权或 Session history 存储。

## 目录分工

```text
app.py                  FastAPI factory、lifespan、CORS 与静态 UI 服务
main.py                 常规与自动重载启动入口
config.py               环境变量配置
session_manager.py      SDK client、runtime 通知与审批
routes/                 HTTP 与 WebSocket 路由模块
control/                client、Project、Thread、Turn、审批与 socket 协调
persistence/            Gateway 自身 JSON 持久化辅助函数
```

## 验证 Gateway 改动

在仓库根目录运行聚焦的 Gateway 检查：

```bash
uv run ruff check server
uv run pytest tests/gateway/ -q
```

默认测试使用 fake，不得调用模型 Provider。只有需要匹配 App Server 可执行文件的
测试或手工运行才设置 `MINI_AGENT_APP_SERVER_PATH`。
