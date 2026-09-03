# Mini Agent FastAPI Gateway & Application Server

`server` 是 `mini-agent-web` 的高性能异步 Web 网关服务，基于 FastAPI + Uvicorn + WebSockets 构建。

它向下通过 Stdio JSON-RPC 2.0 管道与 Rust 编写的 `mini-agent-app-server` 建立生命周期管理与子进程通信，向上为 React Web 前端与第三方客户端提供统一的 RESTful API 与实时双向 WebSocket 消息通道。

---

## 🌟 核心能力

- **🔄 双向通信桥接**：
  - **REST API**：提供线程管理、Thread 设置与 Goal Runtime 控制、环境探测（WorldState/MCP/Git）、多根项目管理（Projects）、配置变更及审批响应的标准 HTTP 路由。
  - **WebSocket 全双工网关 (`/ws/agent`)**：支持 Turn 提交、实时 Steering 纠偏、Interrupt 中断、审批拦截响应以及 `mini-agent-app-server` 流式 JSON-RPC 2.0 事件分发。
- **⚙️ 智能子进程与连接池生命周期 (`SessionManager`)**：
  - 管理 `mini-agent-app-server` 进程启动、标准输入输出管道、协议版本协商（Protocol Version 1）；
  - 支持进程崩溃探测与无感自愈重连机制；
  - 异步挂起与结算敏感操作安全审批（Approval Futures）。
- **💾 本地状态持久化 (`~/.mini-agent/state.json`)**：
  - 原子写入与管理工作区项目列表、多根目录关联、默认主目录、置顶状态与会话元数据（标题、阶段摘要）。
- **📦 静态前端一体化托管**：
  - 自动检测并挂载 `frontend/dist` 生产构建产物，支持单端口同时提供 Web UI 界面与后端 API 服务。

---

## 📂 模块结构

```text
server/
├── __init__.py          # 模块初始化
├── app.py               # FastAPI App 实例工厂、CORS 中间件与静态前端挂载
├── main.py              # Uvicorn 启动入口 (run_server, run_server_dev)
├── config.py            # 服务端环境变量与路径配置
├── session_manager.py   # 核心会话管理器、子进程生命周期与 WebSocket 分发池
└── routes/
    ├── __init__.py      # 路由聚合
    ├── agent.py         # 轮次提交、实时流式推理、WebSocket 端点 (/ws/agent, /api/agent/*)
    ├── threads.py       # 会话线程创建、分支分叉、读取与删除 (/api/threads/*)
    ├── world.py         # Thread settings、Goal Runtime、WorldState、Git、MCP 与目录选择
    ├── projects.py      # 多根项目 CRUD、置顶与本地目录绑定 (/api/projects/*)
    └── settings.py      # Profile、Effort 与安全审批策略配置 (/api/settings/*)
```

---

## 🚀 启动与运行

### 1. 生产模式启动
```bash
# 通过 pyproject.toml 注册的 CLI 脚本启动
uv run mini-agent-server

# 或直接调用 Python 模块
uv run python -m server.main
```

### 2. 开发热重载模式启动 (Dev Mode)
```bash
uv run mini-agent-server-dev
```
> 默认监听 `http://127.0.0.1:8000`。
> 访问 `http://127.0.0.1:8000/docs` 可查看自动生成的 OpenAPI / Swagger 交互式接口文档。

---

## 🔌 核心 API 路由一览

| 路径 | 方法 | 功能说明 |
| :--- | :---: | :--- |
| `/api/health` | `GET` | 服务健康检查与 App Server 连接状态 |
| `/ws/agent` | `WebSocket` | 实时事件推流与双向协议交互通道（含 mode 清洗与 isOpen 保护） |
| `/api/threads` | `GET` / `POST` | 列出或创建会话线程 |
| `/api/threads/{thread_id}/fork` | `POST` | 将现有线程分叉为新的实验分支 |
| `/api/threads/{thread_id}` | `GET` | 读取线程 Checkpoint 与消息历史 |
| `/api/threads/{thread_id}/items` | `GET` | 读取 Session-backed、游标分页的 ThreadItem 投影 |
| `/api/agent/turn` | `POST` | 提交新一轮 Prompt 指令 |
| `/api/agent/steer` | `POST` | 向运行中的轮次注入实时纠偏指令 |
| `/api/agent/interrupt` | `POST` | 协作中断当前活动轮次 |
| `/api/agent/approval` | `POST` | 响应工具安全执行审批（Approve / Deny） |
| `/api/world/state` | `GET` | 检查工作区操作系统、环境与命令 |
| `/api/world/mcp` | `GET` | 查询已启用的 MCP 服务与可用工具列表 |
| `/api/world/browse-folder` | `POST` | 触发原生系统文件夹选择窗口 |
| `/api/projects` | `GET` / `POST` | 列出与创建工作区项目 |
| `/api/projects/{project_id}` | `PUT` / `DELETE` | 更新或移除工作区本地项目 |
| `/api/workflows/state` | `GET` | 查询 Thread collaboration mode、内置工具列表与 Goal 投影 |
| `/api/threads/{thread_id}/settings` | `POST` | 设置 Thread collaboration mode 与 Builtin tools |
| `/api/threads/{thread_id}/goal` | `GET` / `POST` / `DELETE` | 读取、设置或清除 Thread Goal |

工作流路由不再提供旧的 `workflow/plan/set` 或手工 milestone/verdict API；Goal
的 step、timeout、token budget 和自动续跑由 App Server 的 Goal Runtime 负责。

---

## 🧪 自动化测试

```bash
# 运行网关接口与 WebSocket 自动化测试
uv run pytest tests/test_gateway_api.py -v
```
