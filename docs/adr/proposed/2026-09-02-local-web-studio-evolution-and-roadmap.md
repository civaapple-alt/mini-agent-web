# ADR: Evolution and Roadmap for Local Web Studio (Monaco Diff Review, Streaming Artifacts, Live Preview, and Goal DAG)

## Status
Proposed

## Date
2026-09-02

## Context

`mini-agent-web` 当前已成功构建起基于 **React 19 + Vite 6 + FastAPI Gateway + App Server** 的本地驻留型 Web Studio（Local Web Studio）。

与纯终端 TUI（专注极低开销与快速命令行结对）以及云原生 Web 平台（如 Bolt.new / Lovable，依赖云端 MicroVM / Docker 沙箱，成本高昂且无法直接访问本地项目）不同，**本地 Web Studio 拥有无可替代的核心优势**：
1. **零云端算力与沙箱成本**：直接利用开发者本地计算资源与物理磁盘；
2. **完整本地开发环境与工具链**：无缝调用本机已配置的 Python、Rust/Cargo、Node.js、Docker、Git 及私有凭据；
3. **极高数据隐私与代码安全**：源码完全保留在本地磁盘，不上传第三方云端沙箱；
4. **高信息密度与富交互体验**：天然支持多窗格、代码 Diff 红绿对比、图表渲染与流式思维链折叠。

为了将当前的 `mini-agent-web` 从“AI 对话与工具调用查看器”全面升级为**工业级本地 AI 结对编程工作台（IDE-grade Local AI Agent Studio）**，特提出本演进提案。

---

## Decision

我们提议围绕当前 `frontend` 与 `server` 架构，实施以下六大维度的核心功能演进与技术重构：

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                            Mini Agent Web Studio (React 19 Frontend)                        │
│                                                                                             │
│  ┌─────────────────────────┐  ┌───────────────────────────────────┐  ┌───────────────────┐  │
│  │   Multi-Project & Tree  │  │   Monaco Code & Diff Review Pane  │  │ Embedded Preview  │  │
│  │  (Streaming Artifacts)  │  │ (Side-by-Side / Inline Diff / CAS)│  │ (Iframe / Logger) │  │
│  └────────────┬────────────┘  └─────────────────▲─────────────────┘  └─────────▲─────────┘  │
│               │                                 │                              │            │
│  ┌────────────▼─────────────────────────────────┴──────────────────────────────┴─────────┐  │
│  │                     Chat & Goal DAG Flow (Thinking / Tools / Steer)                    │  │
│  └──────────────────────────────────────────────┬────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┼───────────────────────────────────────────┘
                                                  │ WebSocket (/ws/agent) + REST APIs
┌─────────────────────────────────────────────────▼───────────────────────────────────────────┐
│                           FastAPI Gateway & Session Control (server/)                       │
│  ├── Live Port Sniffer (端口自动探测)        ├── File Diff Engine & Git Watcher (文件监听)  │
│  ├── Interactive Approval Interceptor       └── Durable State Manager (~/.mini-agent/)      │
└─────────────────────────────────────────────────┬───────────────────────────────────────────┘
                                                  │ Stdio JSON-RPC 2.0 (MiniAgentClient)
┌─────────────────────────────────────────────────▼───────────────────────────────────────────┐
│                     mini-agent-app-server (Rust Actor & Core Execution)                     │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 1. Monaco Editor 深度集成与代码变更审查系统 (Monaco Diff Review)

* **现状痛点**：当前 Agent 修改文件（`edit_file` / `write_file`）后，仅在 `ToolCard` 中以折叠纯文本或 Markdown 渲染，开发者无法像在 Git PR 中那样直观审查改动细节。
* **演进方案**：
  * **按需懒加载 Monaco Editor**：引入 `@monaco-editor/react`，作为异步 Chunk 懒加载（体积控制在 ~2.5MB）；
  * **Side-by-Side 与 Inline Diff 视图**：
    * 当捕获到 `edit_file` 或 `write_file` 工具调用时，中间/右侧自动唤起 Diff 审查窗格；
    * 原始文件内容与修改后内容并排高亮对比，红色标记删除、绿色标记新增；
  * **粒度采纳（Granular Accept / Revert）**：
    * 提供“全部采纳（Accept All）”、“单行/单块采纳”与“一键还原（Revert）”操作，变更直接通过网关 API 刷写磁盘。

---

### 2. 流式 Artifact 有限状态机与实时工作区文件树 (Streaming Artifacts & VFS)

* **现状痛点**：Agent 批量创建或修改多个文件时，必须等待工具调用完全结束（Turn Finished）界面才有反馈，存在“感知黑盒”。
* **演进方案**：
  * **流式正则/有限状态机（Stream FSM Parser）**：
    * 在前端 `messageState.js` 中内置轻量流式 FSM，实时识别模型输出中的文件修改意图；
    * 在文件内容生成的第 1 个 Token 到达时，立即在文件树中高亮对应节点，并显示 `[Generating...]` 动态微动效；
  * **本地文件树状态同步（Chokidar / Watchdog）**：
    * 后端网关监听当前 Project 工作区物理文件变更，防抖推送增量文件树更新至前端，保证文件增删秒级同步。

---

### 3. 本地应用端口自动探测与内嵌实时预览 (Live App Preview)

* **现状痛点**：Agent 执行 `npm run dev`、`vite`、`cargo run` 或 `python app.py` 启动本地服务后，用户必须手动切到另一个浏览器窗口输入 `http://localhost:3000` 查看效果。
* **演进方案**：
  * **后端端口嗅探器（Port Sniffer & Regex Tracker）**：
    * Gateway 在监控 Shell 工具的标准输出流时，利用模式匹配自动提取本地监听 URL（如 `Local: http://localhost:5173/`、`Running on http://127.0.0.1:8000`）；
  * **前端内嵌 `<iframe />` 预览窗格**：
    * 在 SidePanel 中新增 `Preview` 标签页，一旦探测到活跃本地端口自动载入 Iframe；
    * 提供“刷新”、“在新窗口打开”、“切换移动端/平板/桌面视口（Responsive Frame）”与控制台报错捕获（Console Bridge）。

---

### 4. 目标驱动收敛可视化看板与 Checkpoint 回溯 (Visual Goal DAG & Rewind)

* **现状痛点**：Goal 模式目前仅展示简单的单行里程碑文字与进度条，无法直观展现任务依赖拓扑、测试验证条件与历史检查点。
* **演进方案**：
  * **里程碑拓扑图（Milestone DAG Kanban）**：
    * 采用轻量 Mermaid / SVG 渲染有向无环图，直观标记当前执行节点（Running）、前置已通过节点（Passed）与待执行节点（Pending）；
  * **Checkpoint 一键快照回溯（Time-Travel Rewind）**：
    * 基于 App Server 提供的 `ThreadCheckpoint` 协议能力；
    * 当某一里程碑由于编译报错或测试未通过导致偏航时，开发者可点击任意历史节点“回溯到此处（Rewind to Checkpoint）”，放弃后续失败轮次并注入新的引导指令。

---

### 5. 符号级上下文智能补全与 Token 预算感知 (`@` Mention & Token Budget)

* **现状痛点**：当前 InputBar 的 `@` 补全仅支持扁平文件路径搜索，缺乏函数/类等代码符号级索引，且无法感知上下文 Token 消耗。
* **演进方案**：
  * **多维度 `@` 引用体系**：
    * `@file <path>`：快速精准引用工作区文件；
    * `@symbol <name>`：基于 ripgrep / tree-sitter 极速定位工作区内的关键函数、结构体、类定义并内联关键片段；
    * `@git <diff/status>`：一键将当前 Git 暂存区或最新 commit diff 注入 Prompt；
  * **动态 Token 预算条（Token Budget Gauge）**：
    * 在 InputBar 顶部实时计算并展示“系统 Prompt + 历史对话 + 引用文件 + 当前输入”的预估 Token 总量，在接近模型上下文窗口上限（如 128k）时发出黄色/红色预警。

---

### 6. 参数可编辑型人机交互审批流 (Editable Human-in-the-Loop Approval)

* **现状痛点**：当前安全审批（Approval Dock）仅提供“允许/拒绝”，如果 Agent 编写的 Shell 命令仅存在一个路径微小瑕疵，用户只能完全拒绝并重新对话，效率低下。
* **演进方案**：
  * **参数内联二次编辑（Edit & Run）**：
    * 审批弹窗支持将拟执行的命令（如 `rm -rf dir/old` 或 `python migrate.py --drop-all`）展开为可编辑文本框；
    * 用户可直接微调参数（如修改为 `rm -rf dir/old_backup`）后再点击“放行执行（Approve with Modifications）”；
  * **白名单规则可视化编辑器**：
    * 在 SettingsModal 中提供正则白名单配置（如允许一切 `git status`、`cargo check`，阻断一切涉及系统敏感目录的写操作）。

---

## Architecture & Module Allocation

| 模块 | 负责端 | 核心职责与改动点 |
| :--- | :--- | :--- |
| **Monaco Diff Engine** | `frontend/src/components/DiffViewer.jsx` | 封装 Monaco DiffEditor，处理 Side-by-Side 对比与单块合并 |
| **Stream FSM Reducer** | `frontend/src/utils/streamFsm.js` | 扩展 `messageState.js`，实现字符级文件生成状态机 |
| **Port Sniffer & Proxy** | `server/routes/preview.py` | 监听 Shell Stdout 提取 URL，提供健康心跳与 CORS 转发支持 |
| **Visual Goal DAG** | `frontend/src/components/GoalKanban.jsx` | 渲染多里程碑 DAG 节点树与 Checkpoint 回溯交互 |
| **Symbol Indexer** | `server/routes/symbols.py` | 基于本地 ripgrep 提供毫秒级 `@symbol` 符号搜索 API |
| **Editable Approval** | `frontend/src/components/ApprovalDock.jsx` | 增强审批卡片，支持参数修改提交与白名单规则记忆 |

---

## Consequences

### 优势 (Pros)
1. **开发者体验跨越式提升**：具备完整 IDE 级 Diff 审查与应用实时预览，彻底告别盲目运行与窗口来回切换；
2. **零硬件与云端成本**：100% 依托本地环境运行，无多租户容器管理负担与巨额算力开销；
3. **安全把控粒度更细**：参数可微调的审批机制让开发者完全掌控 Agent 的破坏性动作；
4. **与 App Server 生态无缝兼容**：所有能力均基于标准 JSON-RPC 2.0 契约与 FastAPI 扩展路由构建，不侵入底层 Core 核心。

### 权衡与技术考量 (Trade-offs & Mitigations)
1. **前端打包体积增加**：Monaco Editor 库体积偏大。
   * *缓解措施*：采用 Vite 代码分割（Code Splitting）与按需动态 `import()`，非 Diff 场景不加载编辑器资源。
2. **Iframe 预览安全与跨域策略**：本地服务端若设置了 `X-Frame-Options: DENY`，Iframe 可能加载受阻。
   * *缓解措施*：在 FastAPI 后端提供一个极轻量的专用反向代理端点（`/api/preview/proxy?url=...`），剥离阻断性 Header。

---

## Roadmap & Milestones

- [ ] **Milestone 1 (Code Review & Diff)**：集成 Monaco Diff Editor 与流式文件树高亮；
- [ ] **Milestone 2 (Live Preview & Port Detection)**：实现 Shell 端口自动嗅探与内嵌 Iframe 实时预览；
- [ ] **Milestone 3 (Goal DAG & Editable Approvals)**：完成多里程碑有向无环图看板与参数可修改审批。
