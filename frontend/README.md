# Mini Agent Web UI (Frontend)

`frontend` 是 `mini-agent-web` 的现代 React 单页面 Web 应用（SPA），基于 Vite + React 18 构建，提供美观、直观、沉浸式的 AI Agent 交互工作台界面。

---

## 🌟 核心功能

- **💬 实时对话与流式渲染**：
  - **ThinkingBlock**：可折叠展开的思考链（Thinking Process）实时渐进输出。
  - **ToolCard**：细粒度工具执行卡片，展示工具名称、参数 JSON 结构化高亮、执行结果及状态（Running / Finished / Failed / Truncated）。
  - **MessageItem**：支持 Markdown、数学公式、代码高亮与打字机效果。
- **🛡️ 交互式安全审批弹窗 (ApprovalDialog)**：
  - 当 Agent 尝试执行敏感操作（如 Shell 命令或写入文件）时弹出模态框；
  - 支持单次放行（Approve）、拒绝（Deny）或按策略放行。
- **🌿 会话与线程分支侧边栏 (Sidebar)**：
  - 列出历史会话线程（Threads），支持一键新建线程、线程分叉（Fork Branch）与重命名。
- **📊 侧边栏工作流面板 (SidePanel / WorldDrawer)**：
  - **Plan Mode 切换**：一键开启/关闭只读探索模式。
  - **Goal 工作流管理**：多里程碑进度条、验收标准与暂停/恢复控制。
  - **WorldState 与 MCP 诊断**：工作区环境检测、可用命令列表与 MCP 服务状态。
- **⚙️ 全局配置与模型控制 (SettingsModal / Header)**：
  - 动态切换推理强度（Effort: `low` / `medium` / `high`）；
  - 动态切换系统 Profile（`interactive` / `autonomous` / `strict`）；
  - 自定义后端网关连接地址与 WebSocket 重连状态。

---

## 📂 项目结构

```text
frontend/
├── index.html           # HTML 入口
├── package.json         # 前端依赖配置 (React, Vite, Lucide Icons)
├── vite.config.js       # Vite 配置文件 (含 API 反向代理)
└── src/
    ├── main.jsx         # React 应用入口
    ├── App.jsx          # 主应用容器与状态分发
    ├── api.js           # REST API 与 WebSocket 客户端封装
    ├── index.css        # 全局主题变量与样式
    └── components/
        ├── Header.jsx          # 顶部状态栏与 Profile/Effort 切换
        ├── Sidebar.jsx         # 线程列表与多分支侧边栏
        ├── ChatArea.jsx        # 消息流滚动视窗
        ├── MessageItem.jsx     # 单条消息渲染 (Markdown 支持)
        ├── ThinkingBlock.jsx   # 思考链折叠与流式展示
        ├── ToolCard.jsx        # 工具调用状态与结果卡片
        ├── InputBar.jsx        # 底部输入框与工作流快捷操作
        ├── ApprovalDialog.jsx  # 安全审批弹窗
        ├── SidePanel.jsx       # 工作流 / Goal / Plan 抽屉面板
        ├── WorldDrawer.jsx     # 环境与 MCP 诊断抽屉
        └── SettingsModal.jsx   # 设置弹窗
```

---

## 🚀 本地开发与构建

### 1. 安装依赖
```bash
cd frontend
npm install
```

### 2. 启动开发热更新服务器 (Dev Server)
```bash
npm run dev
```
> 默认启动在 `http://localhost:5173`。Vite 已配置将 `/api` 和 `/ws` 请求自动反向代理到本地 FastAPI 网关（`http://127.0.0.1:8000`）。

### 3. 构建生产包
```bash
npm run build
```
> 构建产物将输出至 `frontend/dist/`，可直接由 FastAPI 静态托管或部署至 Nginx / CDN。

---

## 🔌 API 与通信协议

- **REST API**：通过 `src/api.js` 调用后端 `/api/threads`、`/api/workflows/*`、`/api/world/*`、`/api/approvals/*`。
- **WebSocket**：连接 `/ws/events` 接收实时 JSON-RPC 2.0 推流事件，包括 `assistant_reasoning_delta`、`assistant_text_delta`、`tool_started`、`tool_finished` 与 `turn_finished`。
