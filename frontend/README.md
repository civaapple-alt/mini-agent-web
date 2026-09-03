# Mini Agent Web UI (Frontend)

`frontend` 是 `mini-agent-web` 的现代 React 单页面 Web 应用（SPA），基于 **React 19 + Vite 6** 构建，提供美观、直观、沉浸式的 AI Agent 交互工作台界面。

---

## 🌟 核心功能

- **💬 实时对话与流式渲染**：
  - **ThinkingBlock**：可折叠展开的思维链（Thinking Process）实时渐进输出与耗时统计。
  - **ToolCard**：细粒度工具执行卡片，展示工具名称、参数 JSON 结构化高亮、执行结果折叠以及状态机（Running / Completed / Failed）。
  - **MessageItem**：支持 GitHub 风格 Markdown、代码高亮、复制、图片 Lightbox 模态大图预览与 `ContextCompaction` 上下文压缩结算指示。
- **🛡️ 交互式安全审批与记忆闭环**：
  - 当 Agent 尝试执行敏感操作（如 Shell 命令或写入文件）时，InputBar 底部常驻悬浮审批 Dock；
  - 支持单次放行（Allow）、本会话始终放行（Always Allow）或填写理由拒绝（Deny）。
- **🔔 原生微动效 Toast 消息系统**：
  - 连接状态、复制成功、实时纠偏与错误告警均采用平滑浮动 Toast 非阻塞呈现，全面替代浏览器原生弹窗。
- **🌿 会话与多项目管理侧边栏 (Sidebar)**：
  - 支持多工作区项目管理、系统本地目录选择器（Native Folder Picker）、项目固定（Pin）；
  - 会话线程列表支持实时搜索、新建线程、分支派生（Fork Branch）、重命名与阶段摘要设定。
- **📊 侧边栏工作流面板 (SidePanel)**：
  - **World 环境状态**：工作区环境探测、已安装工具与系统信息。
  - **Plan Mode 规划探索**：一键开启/关闭只读探索模式。
  - **Builtin Tools 权限控制**：可视化多选与限制 6 种标准内置工具（`read_file`, `write_file`, `edit_file`, `shell`, `web_fetch`, `read_image`）。
  - **Goal 目标收敛管理**：显示 Thread Goal 的状态、Token/时间预算，支持设置与清除目标。
  - **MCP 扩展诊断**：查看 MCP 服务列表、工具状态与连接重试。
  - **Git 工作区**：查看未暂存/暂存变更、分支状态与 Diff 摘要。
- **⚙️ 全局设置与偏好 (SettingsModal)**：
  - 动态切换推理强度（Effort: `low` / `medium` / `high`）；
  - 动态切换系统 Profile（`interactive` / `auto` / `ask`）；
  - 支持 4 套主题（Light / Dark / Midnight / Cyberpunk）、自动滚动锁定、字体大小调节与换行切换。

---

## 📂 项目结构

```text
frontend/
├── index.html           # HTML 入口
├── package.json         # 前端依赖与测试配置 (Node Test Runner)
├── vite.config.js       # Vite 配置文件 (含 API 反向代理)
└── src/
    ├── main.jsx         # React 应用入口
    ├── App.jsx          # 主应用容器、状态分发与 WebSocket 接入
    ├── api.js           # REST API 与 WebSocket 客户端封装 (含 isOpen 保护)
    ├── index.css        # 全局主题变量与基础样式
    ├── utils/           # 纯逻辑工具模块 (与测试共用，防逻辑漂移)
    │   ├── messageState.js    # 流式事件聚合与跨线程隔离
    │   └── slashCommands.js   # 斜杠命令解析与 Profile 映射
    ├── tests/           # 自动化单元测试 (Node.js 原生测试执行器)
    │   ├── api.test.js
    │   ├── message_state.test.js
    │   └── slash_commands.test.js
    └── components/
        ├── Header.jsx          # 顶部状态栏与会话标题内联编辑
        ├── Sidebar.jsx         # 多项目与会话侧边栏 (含搜索与 Esc 监听)
        ├── ChatArea.jsx        # 消息流滚动视窗 (含骨架屏与滚动锁定)
        ├── MessageItem.jsx     # 单条消息渲染 (Markdown & Lightbox)
        ├── ThinkingBlock.jsx   # 思考链折叠与流式展示
        ├── ToolCard.jsx        # 工具调用状态与结果卡片
        ├── InputBar.jsx        # 底部输入框、IME 输入法守卫与斜杠命令
        ├── Toast.jsx           # 轻量原生 Toast 通知组件
        ├── SidePanel.jsx       # 工作流 / Goal / Plan / Git / MCP 抽屉面板
        └── SettingsModal.jsx   # 系统设置模态框
```

---

## 🚀 本地开发与构建

### 1. 安装依赖
```bash
cd frontend
npm install
```

### 2. 运行自动化测试
```bash
npm test
```

### 3. 启动开发热更新服务器 (Dev Server)
```bash
npm run dev
```
> 默认启动在 `http://localhost:5173`。Vite 已配置将 `/api` 和 `/ws` 请求自动反向代理到本地 FastAPI 网关（`http://127.0.0.1:8000`）。

### 4. 构建生产包
```bash
npm run build
```
> 构建产物将输出至 `frontend/dist/`，可直接由 FastAPI 静态托管或部署至 Nginx / CDN。

---

## 🔌 API 与通信协议

- **REST API**：通过 `src/api.js` 调用后端 `/api/threads`、`/api/workflows/settings`、`/api/workflows/goal`、`/api/world/*`、`/api/projects/*`、`/api/settings`。
- **WebSocket**：连接 `/ws/agent` 双向全双工通道，传输 Turn 提交、实时 Steering 纠偏、Interrupt 停止生成、安全审批、`ThreadItem` 工具投影和 Goal/settings runtime notifications。
