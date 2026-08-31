# Web API Gateway 与 Web Studio 架构设计文档

本文档详细记录了 `mini-agent-web` 中 **FastAPI Web API Gateway**、**Cursor / ChatGPT 风格 Web Studio 前端** 以及 **Rich Terminal TUI** 的设计架构、通信机制与核心技术实现。

---

## 1. 整体架构与分层设计

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   React 19 + Vite 前端 (frontend/)                      │
│  ├── 聊天主视窗 (ChatArea: ReactMarkdown 渲染、ThinkingBlock、ToolCard) │
│  ├── 交互式安全审批弹窗 (ApprovalDialog: 允许 / 拒绝)                   │
│  ├── 动态交互控制条 (InputBar: Prompt 发送 / 实时纠偏 Steer / 协作中断) │
│  └── 侧边栏与抽屉 (Sidebar: 会话树与 Fork 分支; WorldDrawer: 环境探测)  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP REST + SSE / WebSocket (/ws/agent)
┌───────────────────────────────────▼────────────────────────────────────┐
│                  FastAPI Web API Gateway (server/)                     │
│  ├── App 入口与 CORS 中间件 (server/app.py)                            │
│  ├── Session & 连接池管理器 (server/session_manager.py)               │
│  │   ├── MiniAgentClient 单例生命周期管理                              │
│  │   ├── WebSocket 连接池与消息广播                                    │
│  │   └── 异步安全审批握手调度器 (Approval Handshake Dispatcher)        │
│  └── API 路由分发 (server/routes/)                                     │
│      ├── agent.py: /api/agent/turn, /api/agent/stream, /ws/agent       │
│      ├── threads.py: /api/threads (列表、新建、Fork 分支、检查点、关闭)│
│      └── world.py: /api/world, /api/mcp, /api/workflows               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Python 异步 SDK
┌───────────────────────────────────▼────────────────────────────────────┐
│                 Official Python SDK (mini-agent)                       │
│              MiniAgentClient (Stdio JSON-RPC 2.0)                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Stdio 管道 (JSONL)
┌───────────────────────────────────▼────────────────────────────────────┐
│                    mini-agent-app-server.exe                           │
│     (Actor 控制面、CAS 版本校验、工具执行沙箱与模型推理引擎)           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心交互机制与协议流转

### 2.1 全双工 WebSocket 与 SSE 流式推流

网关同时支持两种推流消费模式：
1. **Server-Sent Events (SSE)** (`GET/POST /api/agent/stream`)：单向实时推流，适用于轻量级网页或仅需接收 Token / Tool 事件的外部客户端；
2. **全双工 WebSocket** (`WebSocket /ws/agent`)：支持双向通信，客户端既能接收实时的 Thinking、Token 打字机和工具事件，又能在同一长连接上实时触发 **Steer（动态纠偏）**、**Interrupt（中断取消）** 与 **安全审批决策**。

### 2.2 双向安全审批握手 (Human-in-the-loop Approval Handshake)

当底层 Agent 执行高危敏感操作（如 Shell 命令执行、文件直接写覆盖、外部 MCP 服务调用）时，系统触发人机协同审批闭环：

```text
App Server (Rust)             MiniAgentClient              SessionManager               Web Studio UI
       │                            │                            │                            │
       │─── approval/request ──────>│                            │                            │
       │                            │─── _handle_approval ──────>│                            │
       │                            │    (异步挂起 Future)       │─── ws: approval_request ──>│
       │                            │                            │                            │ 弹出醒目模态框
       │                            │                            │                            │ (显示工具名与参数)
       │                            │                            │                            │
       │                            │                            │<── POST /api/approval ─────│ (用户点击【允许】)
       │                            │                            │    或 ws: approval_response│
       │                            │<── resolve Future ─────────│                            │
       │<── approval/respond ───────│                            │                            │
       │    {"decision": "approved"}│                            │                            │
       │                            │                            │                            │
       │─── 恢复工具执行并推流 ────>│                            │                            │
```

---

## 3. Web Studio React 前端工程特性 (`frontend/`)

* **React 19 + Vite 现代化技术栈**：对标 `llm-council/frontend` 架构，使用 `react-markdown`、`remark-gfm`、`lucide-react` 构建响应式 SPA；
* **Thinking 思考折叠卡片 (`ThinkingBlock.jsx`)**：
  * 流式渐进展现思维链（支持 DeepSeek Reasoner、OpenAI o1/o3 思考过程）；
  * 思考中带有脉冲呼吸灯动画与实时打字机效果，思考结束后自动标识完成并支持一键展开/收起；
* **Tool 执行卡片 (`ToolCard.jsx`)**：
  * 动态展示工具名称、入参代码框、运行中/成功/失败状态徽章；
  * 终端输出结果支持独立折叠查看，避免大输出污染主聊窗；
* **动态控制条 (`InputBar.jsx`)**：
  * 自适应高度多行输入框（Enter 发送，Shift+Enter 换行）；
  * Agent 执行过程中自动切换为【停止生成】(Interrupt) 按钮；
  * 浮动纠偏条允许用户在模型运行期间随时注入 Steer 提示词；
* **多会话侧边栏与 Fork 分支 (`Sidebar.jsx`)**：
  * 支持查看与切换历史 Thread；
  * 支持一键从指定历史节点派生（Fork）出全新的子会话分支；
* **WorldState 环境抽屉 (`WorldDrawer.jsx`)**：
  * 右侧抽屉实时展示服务端探测到的操作系统、Shell 环境、已安装可用工具链（`git`, `cargo`, `uv`, `python` 等）及 MCP 服务器状态，支持一键重试连接。

---

## 4. 终端交互客户端 (Terminal TUI)

位于 `tui/tui_app.py`，基于 Python `rich` 库构建：
* 支持在纯命令行环境下享受格式化 Markdown 排版、Thinking 思考面板与工具状态打印；
* 遇到敏感工具拦截时，直接在终端中交互式提示 `[y/n]` 授权确认；
* 启动命令：`uv run mini-agent-tui`。

---

## 5. 验证与测试规范

网关核心接口由 `tests/test_gateway_api.py` 进行全面测试保障：
1. **健康检查与静态托管**：`GET /health`、`GET /`；
2. **会话全生命周期**：`GET /api/threads`、`POST /api/threads`、`POST /api/threads/fork`、`GET /api/threads/{id}`；
3. **环境与工作流**：`GET /api/world/state`、`GET /api/workflows/state`、`POST /api/workflows/plan`；
4. **安全审批列表与响应**：`GET /api/approval/pending`、`POST /api/approval/respond`。
