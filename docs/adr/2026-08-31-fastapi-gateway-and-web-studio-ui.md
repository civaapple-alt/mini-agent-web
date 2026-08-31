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

3. **构建零繁重构建依赖的现代化 Web 前端 (`web/`)**：
   - 采用原生 HTML5 + Tailwind CSS + Marked.js + Highlight.js + Lucide Icons；
   - 避免冗长沉重的 Node 构建流程，用户无需额外安装 npm 依赖即可即开即用；
   - 完整实现思考折叠卡片（Thinking Accordion）、工具执行卡片（Tool Cards）、会话历史分支与审批模态框。

4. **提供轻量 Rich 终端客户端 (`tui/`)**：
   - 封装在 `tui/tui_app.py` 中，提供纯命令行环境下的格式化输出与审批交互。

## Consequences

* **Positive**:
  - 用户只需一条命令 `uv run mini-agent-web` 即可立即在浏览器中开始多轮 Agent 对话与可视化开发；
  - 架构清晰分层：Rust App Server (底座) -> Python SDK (客户端) -> FastAPI Gateway (服务层) -> Web UI / TUI (展示层)；
  - 100% 保持零编译阻碍，极速启动。
* **Negative / Trade-offs**:
  - Web UI 使用 CDN 加载基础 UI 库，离线极端环境下需依赖本地静态缓存（未来可扩展离线打包模式）。
