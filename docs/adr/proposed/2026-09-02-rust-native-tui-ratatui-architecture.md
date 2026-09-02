# ADR: Native High-Performance Rust TUI for Mini Agent based on Ratatui, Tokio and Elm Architecture

## Status
Proposed

## Date
2026-09-02

## Context

随着 Mini Agent Harness（Rust Core / App Server）与 Web Studio（React 19 + FastAPI Gateway）的演进，开发者交互形态逐步成熟。目前终端场景存在两种实现：
1. **Rust 原生 CLI REPL (`mini-agent-cli`)**：基于标准行式输入输出（Line-based REPL），体积轻量但缺乏全屏多窗格（Multi-pane）、流式思维折叠、工具树展开与实时交互看板能力；
2. **Python TUI (`mini-agent-tui`)**：基于 `Rich` + `prompt_toolkit` + Python SDK 构建，通过 Stdio 管道直连 App Server（无需 Web Server / FastAPI 网关），开发迭代迅速；但需要完整的 Python 3.10+ 解释器环境与三方依赖库，且在纯 SSH、无 Python 运行时或极低资源环境（如嵌入式设备、轻量容器）中分发受限（冷启动 ~200ms，内存 ~45MB）。

在 2026 年现代 AI 终端工程实践中（如 DeepSeek-TUI、Zerostack、K9s、Lazygit 等顶级终端工具），**“Tokio 异步双环 + Elm (TEA) 单向状态机 + Ratatui 帧渲染 + 细粒度沙箱与审批”** 已经成为行业标准。

为了提供极致性能、零环境依赖、冷启动 < 10ms、常驻内存 < 15MB 且支持全屏多窗格的终端 Agent 体验，我们提议构建 **Rust 原生高性能 TUI 客户端**。

---

## Decision

### 1. 核心技术栈选型

| 逻辑分层 | 选型技术 / Crate | 选型理由与核心优势 |
| :--- | :--- | :--- |
| **TUI 渲染引擎** | `ratatui` (0.28+) | 行业绝对标准。提供丰富组件（Block、Paragraph、List、Tree、Tabs、Gauge 等），支持跨平台与双缓冲防闪烁。 |
| **终端事件与底座** | `crossterm` (0.28+) | 跨平台捕获按键、鼠标、窗口 Resize 事件，支持 Raw Mode 与 Alternate Screen。 |
| **异步运行时** | `tokio` (1.x, multi-thread) | 驱动网络 I/O、SSE 流式 Token 接收、子进程与 MCP 插件调度。 |
| **状态机模式** | **Elm / TEA (The Elm Architecture)** | 单向数据流、纯函数状态转移（`update(state, msg)`），彻底避免 `Arc<Mutex<State>>` 死锁与状态漂移。 |
| **通信通道** | `tokio::sync::mpsc` + `oneshot` | 双环解耦通信：MPSC 传递流式事件与按键指令，Oneshot 实现非阻塞交互审批通道。 |
| **多行编辑与输入** | `tui-textarea` / `tui-input` | 专门处理多行换行（Shift+Enter）、光标移动、历史翻页与中文 IME 候选词输入。 |
| **流式 Markdown 解析** | `pulldown-cmark` + 行级增量缓存 | 逐 Token 增量语法高亮与折叠，避免全屏全量重解析造成的终端跳动与闪烁。 |

---

### 2. 双环解耦架构（Dual-Loop Architecture）

UI 渲染主线程与后台 Agent Worker 完全隔离，保证大模型慢 I/O 与长耗时工具执行时，终端界面依然保持 **60 FPS / 实时无阻断响应**：

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       UI 渲染主线程 (Main Event Loop)                        │
│                                                                             │
│  crossterm (键盘/窗口事件)                                                   │
│         │                                                                   │
│         ▼                                                                   │
│  ┌──────────────┐    纯函数状态转移     ┌──────────────┐   帧缓冲绘制 (60fps) │
│  │   AppEvent   ├────────────────────>│   AppState   ├─────────────────┐    │
│  └──────────────┘ update(state, msg)  └──────▲───────┘ ratatui::render │    │
│         │ (用户输入/Steer/审批决策)          │                          │    │
└─────────┼────────────────────────────────────┼──────────────────────────┼────┘
          │ tokio::sync::mpsc (UserCmd)        │ tokio::sync::mpsc (StateDelta)
┌─────────┼────────────────────────────────────┼──────────────────────────┼────┘
│         ▼                                    │                          │    │
│  ┌───────────────────────────────────────────┴───────────────────────┐  │    │
│  │                   后台 Agent 异步运行时 (Tokio Tasks)              │  │    │
│  │                                                                   │  │    │
│  │   ┌─────────────────────────┐       ┌─────────────────────────┐   │  │    │
│  │   │   Stream Event Worker   │       │   Tool Executor Worker  │   │  │    │
│  │   │ (Stdio JSON-RPC Client) │       │   (MCP / 本地安全沙箱)   │   │  │    │
│  │   └────────────┬────────────┘       └────────────┬────────────┘   │  │    │
│  └────────────────┼─────────────────────────────────┼────────────────┘  │    │
│                   ▼                                 ▼                   │    │
│     ┌───────────────────────────┐     ┌───────────────────────────┐     │    │
│     │   mini-agent-app-server   │     │  Linux Landlock / Win Job │     │    │
│     │ (Stdio JSON-RPC 2.0 管道) │     │      (子进程沙箱隔离)     │     │    │
│     └───────────────────────────┘     └───────────────────────────┘     │    │
└─────────────────────────────────────────────────────────────────────────┴────┘
```

---

### 3. Elm 状态机模式（TEA）在 Rust 中的设计

```rust
// 1. 统一应用事件
pub enum AppEvent {
    // 终端用户交互
    Key(crossterm::event::KeyEvent),
    Resize(u16, u16),
    
    // 来自 App Server 的推流协议事件
    TurnStarted { turn_id: String },
    ReasoningDelta(String),
    TextDelta(String),
    ToolStarted { call_id: String, tool: String, args: serde_json::Value },
    ToolFinished { call_id: String, output: String, is_error: bool },
    TurnFinished { stop_reason: String },
    
    // 安全审批请求与挂起通道
    ApprovalRequest {
        request_id: String,
        action: String,
        responder: tokio::sync::oneshot::Sender<bool>,
    },
    
    // 系统错误与通知
    Toast(String, ToastLevel),
}

// 2. 集中化应用状态
pub struct AppState {
    pub current_thread: String,
    pub messages: Vec<UiMessage>,
    pub input: TextArea<'static>,
    pub is_generating: bool,
    pub active_turn_id: Option<String>,
    pub pending_approval: Option<PendingApprovalState>,
    pub side_panel_tab: SidePanelTab, // World / Plan / Goal / Git / MCP
    pub scroll_offset: usize,
    pub auto_scroll: bool,
    pub theme: TuiTheme,
}

// 3. 无锁纯函数状态转移
pub fn update(state: &mut AppState, event: AppEvent) -> Option<AppCommand> {
    match event {
        AppEvent::ReasoningDelta(delta) => {
            state.append_reasoning(&delta);
            None
        }
        AppEvent::TextDelta(delta) => {
            state.append_text(&delta);
            None
        }
        AppEvent::ApprovalRequest { request_id, action, responder } => {
            state.pending_approval = Some(PendingApprovalState { request_id, action, responder });
            None
        }
        AppEvent::Key(key) if state.pending_approval.is_some() => {
            // 审批模态框按键拦截 (y: 放行 / n: 拒绝)
            handle_approval_key(state, key)
        }
        AppEvent::Key(key) => {
            handle_normal_key(state, key)
        }
        _ => None,
    }
}
```

---

### 4. 关键深水区痛点与解决方案

#### A. 流式 Markdown 增量渲染与防闪烁
* **问题**：Agent 逐 Token 吐出 Markdown 内容。每次收到 Token 时若直接全量重新解析整个消息历史，会导致 CPU 暴涨、滚动位置跳动和终端界面剧烈闪烁。
* **方案**：
  1. **行缓冲机制（Line-buffering）**：已闭合换行的历史行转换为不可变的 `ratatui::text::Line<'static>` 缓存池；
  2. **活动行增量修补**：仅对当前正在生成的最后一行进行流式高亮修补；
  3. **代码块状态机**：维护一个轻量扫描器记录当前是否处于 ```` ``` ```` 代码块内部，代码块内应用语法高亮样式，代码块闭合后固化。

#### B. 异步安全审批与实时纠偏（Human-in-the-Loop & Steer）
* **审批挂起**：当工具涉及写文件或执行 Shell 时，后台 Worker 创建 `oneshot::channel` 并发送 `AppEvent::ApprovalRequest`；后台任务进入 `rx.await` 优雅挂起，不占用 CPU 且不阻塞 UI。
* **即时决议**：用户在 TUI 模态框中按下 `y`（允许）或 `n`（拒绝）后，主线程通过 `responder.send(decision)` 瞬间恢复后台执行。
* **实时纠偏（`/steer`）**：在 Agent 运行中，用户直接输入 `/steer <指令>` 并回车，主线程向后台发送抢占信号，App Server 即可在下一个 Tool Step 注入引导上下文。

#### C. 多窗格布局（Multi-Pane Layout）与响应式适配
* 采用 `ratatui::layout::Layout` 弹性划分：
  * **主视窗（左/中）**：流式思维链（可折叠）、文本打字机与工具调用树卡片；
  * **辅助侧栏（右）**：Tab 切换查看 WorldState 环境探测、Plan 计划树、Goal 进度条与 Git 状态；
  * **底部区域**：多行输入框、模式切换器（Interactive / Auto / Ask）与审批悬浮 Dock；
  * **极小终端适配**：当终端列宽 `< 100` 或行高 `< 25` 时，自动收起右侧栏并转为底部单行状态提示。

---

### 5. 客户端接入方案：对齐 App Server 协议

Rust TUI **作为 `mini-agent-app-server` 的原生 Stdio JSON-RPC 客户端**接入，而非直接内嵌重型内核：
1. **协议完全统一**：复用同一套 Stdio JSON-RPC 2.0 规范（`turn/start`、`turn/steer`、`turn/interrupt`、`thread/checkpoint`）；
2. **会话无缝共享**：在 Rust TUI 中开启的会话，其 Checkpoint 与项目状态持久化在 `~/.mini-agent/state.json` 中，随时可以无缝切到 Web Studio 或 IDE 插件中继续工作；
3. **极简代码行数控制**：符合 `mini-agent-harness` 严苛的代码行数预算（TUI 客户端作为独立可插拔外壳，不挤占 Core 运行时代金券）。

---

## Consequences

### 优势 (Pros)
1. **极限轻量与无依赖**：编译为单一静态二进制文件（~8 MB），零 Python / Node.js 运行时依赖，`cargo install` 或 1-click curl 即可在任何 Linux / macOS / Windows 环境运行；
2. **超快响应与低内存**：冷启动 `< 10 ms`，运行时内存占用仅 **8 MB ~ 15 MB**，60 FPS 流畅无卡顿；
3. **无缝多端协同**：基于 App Server 标准协议，与 Web Studio 共享相同的 Thread CAS 状态机与 MCP 插件体系。

### 权衡与挑战 (Cons & Mitigations)
1. **Markdown 渲染能力受限**：终端无法像浏览器那样原生渲染复杂 HTML/SVG 图表。
   * *缓解措施*：针对图表降级为 ASCII/Unicode 树形渲染，数学公式降级为规范文本展示。
2. **终端兼容性差异**：不同终端模拟器（Windows Terminal、iTerm2、Alacritty、Kitty、PuTTY）对颜色、鼠标及按键支持度不一。
   * *缓解措施*：基于 `crossterm` 标准能力层，默认启用通用 16/256 色回退策略。

---

## Implementation Roadmap

- [ ] **Phase 1: TEA 状态机与 Ratatui 骨架**：完成 `AppEvent`、`AppState` 与多窗格主布局渲染。
- [ ] **Phase 2: App Server JSON-RPC 管道接入**：实现流式 Token、Thinking 过程与 Tool Call 事件的高性能增量解析与更新。
- [ ] **Phase 3: 审批模态框与快捷指令**：实现内联审批（`y/n`）、`/steer` 纠偏、`/plan` 切换与 `/fork` 分支。
- [ ] **Phase 4: 打包与分发**：支持直接通过 `mini-agent-cli repl --tui` 启动或作为独立 `mini-agent-tui` 二进制运行。
