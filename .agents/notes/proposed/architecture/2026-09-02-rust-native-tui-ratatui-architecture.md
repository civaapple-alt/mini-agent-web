# ADR: Rust Native TUI for Mini Agent

## Status

Proposed

## Date

2026-09-02

## Scope and Ownership

本提案描述 Rust TUI 的架构和与 `mini-agent-app-server` 的接入边界。当前
`mini-agent-web` 仓库没有 Rust TUI 源码；实现应归属拥有 Rust App Server 客户端
与发布流水线的 Rust workspace（例如 `mini-agent-harness`），不在本仓库复制一套
JSON-RPC 协议或安全执行器。`mini-agent-web/tui/` 继续作为 Python TUI 基线，直到
Rust 客户端达到明确的功能和可用性门槛。

## Context

### 当前基线

现有 Python TUI 位于 `tui/`，通过零依赖核心的 `mini-agent` SDK 连接 App Server，
已经支持：

- Rich 输出、Thinking/文本/工具状态和截断提示；
- `per_action`、`auto_approve`、`strict` 审批策略，以及会话级工具记忆；
- `/steer`、中断、Plan/Goal、线程新建/切换/fork、历史读取、World/MCP/Git/文件
  检索和非 TTY 降级；
- SDK protocol version `1`、Thread/Turn 事件隔离、未知事件 `GenericEvent` 保留。

Rust TUI 的价值不是再做一个模型客户端，而是给 SSH、无 Python 环境和资源受限
场景提供全屏、多窗格、可持续交互的原生外壳。当前提案中的“Rust CLI 已有全屏
REPL”“冷启动 10ms”“内存 15MB”等说法没有本仓库的测量证据，均不作为现状或
保证；它们只能作为待验证的目标。

### 设计目标

1. 对 App Server 的协议和事件语义保持兼容，直接复用已有 Rust transport/client
   抽象（若上游没有，则先补一个最小、可复用的 transport crate）。
2. 在模型推理、工具执行、审批等待和网络断开期间，终端仍可重绘、滚动和退出。
3. 将状态更新、渲染和副作用分开，使事件乱序、重复、截断和恢复都有明确行为。
4. 通过 PTY/fixture 测试覆盖键盘、窗口大小、中文宽字符、非 TTY 和终端恢复。

### 非目标

- 不在 TUI 内嵌模型推理、重做 Core、重做 MCP 执行器或实现另一套沙箱；
- 不追求与 Web Studio 像素级一致；
- 不把 `Arc<Mutex<AppState>>` 扩散到整个应用，也不把审批 responder 存入可持久化
  的 UI 状态；
- 不因 Rust TUI 的需要修改 protocol version `1` 的公共字段。新能力先走已有方法
  或单独的协议提案。

## Decision

### 1. 技术栈与依赖策略

以 Rust workspace 已锁定的兼容版本为准，不在本 ADR 固定一个脱离上游的版本号：

| 层 | 选型 | 约束 |
| :--- | :--- | :--- |
| 终端绘制 | `ratatui` | 双缓冲绘制、组件布局和可测试的纯渲染函数 |
| 终端事件 | `crossterm` | Raw mode、alternate screen、resize、鼠标和跨平台输入 |
| 异步运行时 | workspace 现有 Tokio | 只承载 I/O、定时器、子进程和 channel；不在 render 函数阻塞 |
| 输入编辑 | 现有兼容的 textarea/input crate | 中文输入、历史、粘贴和多行行为先以目标平台验证 |
| 协议 | 共享 App Server client/transport | JSONL Stdio、protocol version `1`、request/notification 分流 |

新增依赖必须说明体积、平台支持和维护状态；不为单一 Markdown 语法或视觉效果
引入重量级运行时。

### 2. 单一 Tokio 驱动的 UI/Agent 双环

应用只有一个负责终端所有权的 UI task；Agent transport、stderr、审批和重连在
后台 task 中运行，通过 bounded channel 发送到 UI。UI task 每个 tick 处理有限数量
输入/通知，然后执行 `update` 和 `render`：

```text
crossterm input ─┐
                 ├─> UiMessage ─> update(AppState) ─> ratatui render
App Server event ┘          ▲
                            │
             bounded channel│
                            │
     JSON-RPC reader ─> ProtocolAdapter ─> approval broker / reconnect
```

建议默认 30 FPS，并在有输入或事件时即时重绘；60 FPS 只有在基准证明有必要时才
启用。Token delta 和大型工具输出按窗口合并，队列溢出时丢弃中间 delta、保留最终
结算和 `resync_required`，不能静默伪造完整文本。

### 3. 数据型事件、确定性 reducer 和副作用命令

UI 事件必须是可记录、可测试的数据，不携带 Tokio channel sender。示意模型：

```rust
enum UiMessage {
    Key(KeyEvent),
    Resize { width: u16, height: u16 },
    Agent(AgentEnvelope),
    ApprovalRequested(ApprovalView),
    Transport(TransportStatus),
    Tick,
}

enum UiCommand {
    StartTurn { thread_id: String, prompt: String },
    Steer { thread_id: String, turn_id: String, text: String },
    Interrupt { thread_id: String, turn_id: String },
    ResolveApproval { request_id: String, decision: ApprovalDecision },
}
```

`update` 根据 `UiMessage` 修改内存状态并返回 `UiCommand`；命令由 effect runner
执行，结果再次作为消息回到 UI。所谓 TEA 在此处指单向、可复演的数据流，不要求
把每个状态字段包装成真正的函数式不可变对象。

状态至少包含：当前 Project/Thread、活动 Turn、有限消息 ring buffer、当前输入、
待审批请求表、滚动/折叠状态、布局模式、连接状态、最近错误和资源上限。禁止只用
一个 `Option<PendingApproval>`，因为多连接或多个工具可能同时产生请求；每个请求
必须保留 request ID、工具名、脱敏参数、创建时间和 settled 状态。

所有 `AgentEnvelope` 先按 `project/thread/turn` 校验，再按 sequence 去重；切换
Thread 时清理活动流的 UI 投影，但不取消其他 Thread 的后台任务，除非用户明确
中断。

### 4. App Server 接入和协议映射

Rust TUI 作为 Stdio JSON-RPC 客户端，使用以下生命周期：

1. 启动单一 App Server 子进程，显式隔离 stdin/stdout/stderr；stdout 只由一个
   reader 解析 JSONL，stderr 进入有界日志缓冲；
2. 发送 `initialize`，协商 protocol version `1` 和能力，失败时给出可行动错误；
3. 通过 `thread/start`、`thread/list`、`thread/read`、`thread/fork`、`thread/close`
   和 `thread/resume`（仅当语义可用）管理会话；
4. 通过 `turn/start`、`turn/steer`、`turn/interrupt` 和通知 `turn/event` 运行轮次；
5. 通过 SDK/transport 的 approval broker 转发 `approval/request` 和
   `approval/respond`，不在 TUI 自己执行工具；
6. 读到 `turn_finished` 或 `run_failed` 后保留结算状态，再允许新的 turn。

事件适配器必须覆盖当前 SDK fixture 中的生命周期：turn/run/model、reasoning/text
delta、model response、tool started/finished、context compaction、run finished、
turn finished 和 structured run failure。未知 `type` 保存原始有界 JSON 并显示
“未知事件”，不能让 reader 崩溃。

### 5. 渲染策略：可读优先、增量有界

主布局包含消息区、输入区和可收起的状态侧栏；侧栏只展示 World、Plan、Goal、Git
和 MCP 的快照，不在每帧主动发起同步 RPC。终端宽度不足时采用明确的布局降级：

- 宽度不足以容纳侧栏时收起侧栏；
- 高度不足时只保留最近状态、审批和输入；
- 极小终端仍能显示错误和退出提示，不让布局 panic。

Markdown 采用两阶段渲染：已闭合的行进入不可变缓存，当前行以纯文本/轻量标记
渲染；代码块只在 fence 状态确定后做语法着色。大段历史按行数和字节数截断，用户
可以通过 `/history` 或 `thread/read` 查看有界回放。不要在每个 token 到达时重解析
全部历史，也不要把未闭合 Markdown 当成安全或结构化数据。

### 6. 审批、Steer、中断与终端恢复

- `per_action`、`auto_approve`、`strict` 的策略含义与 Python TUI 一致；Remember
  只保存在当前 UI 会话，除非底层明确提供持久化策略。
- 审批弹层显示 request ID、工具、脱敏参数、Project/Thread/Turn 和超时状态；
  `y`/`n`/`a` 是快捷键，同时提供可发现的完整按键说明。UI 只发结构化决策。
- `/steer` 必须绑定当前活动 Turn；空闲时作为 follow-up 或显示“没有活动 Turn”，
  不能把 steer 伪装成已执行。
- `Ctrl-C` 分三种情况：输入非空先清空；运行中发送协作中断并等待结算；空闲时
  退出。第二次中断才考虑强制终止，并明确显示可能未结算。
- Raw mode、alternate screen、鼠标和 panic hook 都必须有 guard；正常退出、错误、
  `SIGINT`/窗口关闭和子进程崩溃都恢复终端。恢复失败时将诊断写入 stderr/日志。

### 7. 失败恢复和可观测性

App Server 退出、JSON 解析失败、请求超时、审批超时和协议版本不匹配是不同状态，
分别展示原因和下一步。重连采用退避并限制次数；重连后先重新读取 Thread checkpoint
和 active state，再接受新事件。已显示的文本标记为 stale，不能在无快照时继续追加
到不确定的消息。

日志默认不打印完整 prompt、工具参数、环境变量或 secret；支持用户开启有界 debug
日志。每轮显示 status、steps、stop reason 和 usage（若有），与 Python TUI 的
telemetry 语义对齐。

## Module Allocation

实现时建议按职责拆分，而不是把所有逻辑放进 `main.rs`：

| 模块 | 责任 |
| :--- | :--- |
| `app_state` | 有界 UI 状态、消息/工具/审批视图模型 |
| `update` | `UiMessage -> (AppState, UiCommand)` 的确定性转移 |
| `effects` | 启动/停止 transport、执行 command、重连和超时 |
| `protocol` | 共享 client 或最小 JSON-RPC 适配、事件身份/sequence 校验 |
| `render` | ratatui 布局、窄屏降级、文本和工具卡片渲染 |
| `input` | crossterm/prompt 输入、快捷键、粘贴和终端能力探测 |
| `commands` | `/help`、`/steer`、`/plan`、`/goal`、`/fork` 等命令解析 |
| `terminal_guard` | raw/alternate screen/panic/signal 的资源恢复 |

共享的 App Server client、事件类型或审批抽象优先放到已有 Rust crate；不要将
`mini-agent-web` 的 Python SDK 代码机械翻译成第二套不共享实现。

## Performance and Compatibility Targets

以下是 reference machine 上的验收目标，不是跨平台保证：

- 处理 1,000 条/秒的合并后 delta 时，UI 仍能以至少 20 FPS 重绘，且队列有界；
- 10,000 行历史和大工具输出不会无限增长内存，截断状态可见；
- TTY 与非 TTY 都能安全退出，Windows Terminal、常见 Unix terminal 和 SSH 至少
  有 smoke coverage；
- 启动耗时、二进制体积和常驻内存各自测量，并报告是否包含 App Server 子进程。
  不在未测量前宣称“单一 8MB 二进制”或“<10ms 冷启动”；
- 中英文混排、emoji、窄宽终端和 resize 不产生 panic 或不可恢复的光标错位。

## Security Considerations

- TUI 不是工具执行安全边界；审批和沙箱仍由 App Server/执行器负责。
- 所有路径和工具参数仅展示为脱敏、有限长度的文本；TUI 不自行拼接 shell 命令。
- 子进程必须显式设置 stdin 策略并继承与 Python 客户端一致的非交互环境，避免 pager
  或子进程抢读 JSON-RPC 管道。
- 日志、history 和回放文件不能默认保存 secret；用户选择复制时也要明确复制的
  内容范围。
- 多 Thread 事件隔离和 sequence 去重是安全/正确性约束，不只是 UI 优化。

## Testing and Acceptance Evidence

交付每个阶段至少提供：

1. reducer 单元测试：事件顺序、重复/乱序、未知事件、delta 合并、队列溢出、审批
   多请求、Thread 切换和窄屏布局；
2. 协议 fixture 测试：复用 `06_protocol_compatibility.py` 的 0.7.0 事件样本，并
   验证 protocol version、Turn/Thread 过滤和错误映射；
3. mock App Server 集成测试：启动、流式 turn、steer、interrupt、approval、崩溃
   重连、checkpoint 回放和 fork；禁止默认连接真实 Provider；
4. PTY 测试或人工脚本：raw/alternate screen 恢复、Ctrl-C 三态、resize、中文输入、
   管道重定向和 Unicode 宽度；
5. 在 Rust workspace 中运行 formatter、clippy、项目测试和目标平台构建；同时继续
   运行本仓库 Python TUI/SDK 测试，证明共享协议没有回归。

## Roadmap

### M0 — Ownership and protocol adapter

- 确认 Rust crate 归属、发布目标和现有 App Server client 是否可复用；
- 先实现单独的 JSONL mock transport、事件 identity/sequence 校验和 fixture；
- 固定依赖、资源上限、错误分类和终端恢复策略。

### M1 — Terminal shell and read-only stream

- 完成 terminal guard、ratatui 布局、消息/Thinking/Tool 渲染和窄屏降级；
- 接入 initialize、thread/read 和只读流式事件；
- 达到无 Provider 的 mock/PTY 验收后再启用真实 App Server。

### M2 — Interactive controls

- 接入 turn start、Steer、协作中断、审批队列表和 `/help`/`/threads`/`/fork`；
- 与 Python TUI 对齐策略、状态和 telemetry；
- 增加断线重连、checkpoint 回放和非 TTY 行式降级。

### M3 — Workflow and distribution

- 接入 Plan/Goal/World/MCP/Git 快照和明确的 capability fallback；
- 完成 Windows/macOS/Linux 目标构建、签名/分发方案和性能报告；
- Rust TUI 达到 Python TUI 核心能力等价后，才讨论将其设为默认入口。

## Consequences

### Positive

- 以 App Server 为唯一执行与协议来源，减少 Web、Python、Rust 客户端之间的语义漂移；
- bounded channels、可复演 reducer 和 terminal guard 能把流式故障变成可诊断状态；
- Rust 二进制可覆盖无 Python 的 SSH/容器场景，同时保留现有 Python TUI 作为兼容基线。

### Trade-offs

- 需要维护 Rust workspace 的跨平台终端和打包测试；
- full-screen UI 的输入法、宽字符和 terminal emulator 差异明显，测试成本高于 Rich
  行式输出；
- 为了不阻塞 UI，事件合并会增加一点显示延迟，且队列超限时必须依赖 checkpoint
  resync；
- 在 App Server 不支持历史选择 resume 或文件快照时，TUI 只能准确展示会话状态，
  不能承诺磁盘回滚。

## Reconsideration Triggers

以下情况出现时，暂停扩大 Rust TUI 范围并重新评审：

1. Rust client 无法共享协议/审批实现，导致与 Python SDK 的字段或事件语义持续分叉；
2. 目标平台无法稳定恢复 terminal state，或 resource budget 只能靠无界队列维持；
3. 实际用户主要在已有 Web/Tauri 环境使用，Rust TUI 的维护成本超过 SSH/无 Python
   场景带来的收益；
4. 需要新增公共 App Server 方法、历史 checkpoint 语义或文件快照时，先建立对应的
   独立协议 ADR。
