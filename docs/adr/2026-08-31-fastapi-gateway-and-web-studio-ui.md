# ADR: FastAPI Web Gateway, WebSocket/SSE Streaming, and Web Studio UI

## Status
Accepted

## Date
2026-08-31

## Context
随着底层 `mini-agent-app-server`（Rust 后端）与官方 Python SDK（`mini-agent`）的成熟，开发者与终端用户需要更加直观、高交互性的使用方式：
1. 需要一个轻量、现代化、开箱即用的 Web 前端界面（Web Studio UI），具备类似 Cursor / ChatGPT 的交互体验（支持 Thinking 思考折叠、Tool 调用状态卡片、人机交互安全审批）；
2. 需要统一的 Web API 网关（Gateway），将底层的 Stdio JSON-RPC 通信封装为跨平台、跨语言的 RESTful 接口、Server-Sent Events (SSE) 以及双向全双工 WebSocket 通道；
3. 需要为不方便使用浏览器的场景提供沉浸式的终端客户端（TUI）。

## Decision

1. **采用 FastAPI + Uvicorn 作为核心网关框架 (`server/`)**：
   - 利用 Python `asyncio` 原生生态，与 `MiniAgentClient` 完美集成；
   - 提供 `/api/agent/stream` (SSE) 与 `/ws/agent` (WebSocket) 双流式通道；
   - 托管静态单页 Web 前端。

2. **建立中心化 SessionManager 与双向安全审批调度**：
   - 维护后台 `MiniAgentClient` 实例生命周期；
   - 收到 App Server 的高危工具审批请求时，生成异步 `asyncio.Future` 并向所有连接的前端广播；前端用户点击确认后即时唤醒并回传决策。

3. **构建 React 19 + Vite 现代化 SPA 前端工程 (`frontend/`)**：
   - 架构对标 `llm-council/frontend`，采用 React 19、Vite 6、`lucide-react`、`react-markdown` 与 `remark-gfm`；
   - 彻底解耦组件设计：`Header`, `Sidebar`, `ChatArea`, `ThinkingBlock`, `ToolCard`, `ApprovalDialog`, `InputBar`, `WorldDrawer`；
   - 既支持 Vite 独立开发热更（反向代理 `/api` 与 `/ws`），又支持通过 `npm run build` 产物由 FastAPI 网关直接零门槛开箱托管。

4. **提供轻量 Rich 终端客户端 (`tui/`)**：
   - 封装在 `tui/tui_app.py` 中，提供纯命令行环境下的格式化输出与审批交互。

## Consequences

* **Positive**:
  - 用户只需一条命令 `uv run mini-agent-web` 即可立即在浏览器中享受完整的 React 19 单页应用；
  - 架构清晰分层：Rust App Server (底座) -> Python SDK (客户端) -> FastAPI Gateway (服务层) -> React 19 SPA / TUI (展示层)；
  - 前端具备工业级状态管理、组件复用能力与全套流式交互体验。
* **Negative / Trade-offs**:
  - 前端源码开发需依赖 Node/npm 环境（生产打包产物直接由 Python 网关托管，终端用户无需 Node 环境）。
