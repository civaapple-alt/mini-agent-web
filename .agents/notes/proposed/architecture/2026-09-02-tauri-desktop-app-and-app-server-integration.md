# ADR: Tauri Desktop Shell for Mini Agent

## Status

Proposed

## Date

2026-09-02

## Scope

设计一个可选的 Mini Agent Desktop 外壳，复用 `frontend/` 的 React UI，并由
Tauri Rust 主进程承载本地 App Server 连接、窗口/托盘/通知和桌面权限。当前
`mini-agent-web` 没有 Tauri 工程；本 ADR 不把未来目录、sidecar 二进制或桌面能力
描述为已经存在。

第一阶段只采用 sidecar 模式连接现有 `mini-agent-app-server`。把 Core 直接嵌入
Tauri 进程属于后续独立评审，不是本提案的默认路线。

## Context

### 当前基线

当前交付形态是 `0.7.0` 的 FastAPI Gateway + React 19/Vite 6 Web Studio：

- 浏览器通过 REST、SSE 和 `/ws/agent` 与 Gateway 通信；Gateway 通过
  `MiniAgentClient` 连接 protocol version `1` 的 App Server；
- SessionManager 负责 App Server 生命周期、WebSocket 广播、审批 Future、项目和
  设置/线程元数据持久化；
- 前端已有线程/fork、流式 Thinking/ToolCard、Steer、Interrupt、Plan/Goal、World
  和 Git/工作区文件查看；
- 运行生产 Web Studio 需要 Python/Gateway，前端开发需要 Node；Tauri、托盘、全局
  热键、原生通知和桌面权限尚未实现。

浏览器形态已经满足本地开发的主要流程，但窗口常驻、全局唤醒、后台任务提醒和
系统剪贴板/文件拖入等场景值得一个原生壳。这里的目标是降低启动与切换成本，不是
宣称 WebView 一定比浏览器少用固定数量的内存，也不是把桌面进程当成完整沙箱。

### 目标

1. 复用现有 React 页面和事件模型，让 Web 与 Desktop 的行为可对照测试；
2. 让桌面端在没有单独启动 Python Gateway 的情况下连接一个受控的 App Server
   sidecar；
3. 为全局热键、托盘、窗口状态、剪贴板、文件拖放和通知提供最小权限的原生适配；
4. 将高频事件批处理、进程退出、断线、审批和工作区路径校验设计成可测试的边界。

### 非目标

- 首版不把 `mini-agent-core`/模型推理嵌入 Tauri，不维护第二套执行路径；
- 不保证安装包固定为 15 MB、内存固定为 40 MB 或冷启动固定低于 150 ms；这些
  数字受 WebView runtime、sidecar、Provider 和平台影响，必须实测并说明口径；
- 不默认实现本地 GGUF/`llama.cpp` 插件；模型和 Provider 配置仍由 App Server 负责；
- 不用 Tauri capability、CSP 或目录校验宣称“绝对安全”；工具执行安全边界仍在
  App Server/执行器，桌面端只负责减少暴露面。

## Decision

### 1. 前端 transport 抽象，保持 Web 协议形状

在 React 中引入小型 `AgentTransport` 接口，至少包含：

```text
connect / close
startTurn / steer / interrupt
resolveApproval
list/read/start/fork/close thread
read workflow/world/project state
subscribe(event)
```

保留现有 `WebGatewayTransport`，让浏览器继续使用 REST/WebSocket；新增
`TauriTransport`，把相同语义映射到 Tauri `invoke` 命令和事件。前端 reducer 不应
通过环境变量散落判断平台，也不应同时维护两套事件状态机。

Tauri 事件沿用 Web Gateway 的事件字段：`schemaVersion`、`projectId`、`threadId`、
`turnId`、`sequence`、`type`、`data`。底层 App Server 原始事件仍保留在 `event` 中，
未知事件透传；事件批处理不得改变顺序或身份。

### 2. Sidecar 优先的进程模型

桌面端启动一个带目标平台标识和签名校验的 `mini-agent-app-server` sidecar：

1. Tauri Rust 主进程创建 stdin/stdout/stderr 管道，确保 stdout 只有 JSONL 协议，
   stderr 进入有界日志流；
2. 完成 `initialize`/capability 协商后，主进程暴露窄命令面给 WebView；
3. JSON-RPC request/response、notification、approval 和 child process exit 都由
   Rust host 统一路由；
4. sidecar 退出时，UI 获得结构化的 disconnected/failed 状态；重启须由用户操作
   或明确的有限退避策略触发，不得在后台无限拉起进程；
5. 开发模式可以复用现有 FastAPI Gateway，但生产桌面包不能隐含依赖用户机器上
   的 Python。若要直接打包 Gateway，必须把 Python runtime、依赖、升级和 CVE
   责任单独列为替代方案，而不是声称“零依赖”。

In-Process 模式暂缓。只有在 sidecar 性能基线、崩溃隔离和 API 稳定后，才评估把
   Rust client/core 作为库链接进 Tauri；即使采用，也保留 sidecar fallback，不让
   Tauri 直接复制 App Server 的协议状态机。

### 3. 事件微批处理：以可恢复和有界为先

host 对同一 `project/thread/turn` 的 delta 建立 bounded buffer：按时间窗口或字节
上限 flush，窗口和容量作为可调参数而不是固定的“50ms + 32 token”保证。批次包含
起止 sequence、事件数、payload 字节数和 `truncated`/`resyncRequired` 标记。

- `approval_request`、错误、ack、`turn_finished` 等控制事件不因批处理延迟到超时，
  必要时立即发送；
- 文本/推理 delta 可合并，工具开始/完成和状态事件必须保留；
- WebView 重连后先读 Thread/Workflow snapshot，再从新的 sequence 接收事件；
- queue 溢出触发 resync，不悄悄丢掉一部分文本后继续显示为完整回答；
- 批处理压测报告必须区分 host 内存、WebView、sidecar 和 Provider 的开销。

### 4. 桌面原生能力采用 capability 最小权限

#### 窗口、托盘与全局热键

- 主窗口、设置窗口和审批窗口使用明确的窗口 ID；关闭主窗口默认隐藏到托盘的
  行为可配置，并提供真正退出；
- 全局热键是可选能力，注册失败时回退为托盘/窗口快捷键并显示原因；不硬编码
  `Alt+Space`/`Option+Space` 必定可用，因为系统和其他应用可能占用它；
- HUD 默认只接受输入和显示状态，不在隐藏窗口中绕过审批自动执行工具。

#### 通知与审批

桌面通知展示工具名、脱敏参数、Project/Thread 和超时，并点击后打开审批窗口。
不同平台对通知 action button 的支持并不一致，因此：

- 原生 action 可用时只提供 Allow/Deny；
- 不支持 action 时，通知点击必须回到审批窗口；
- “Always allow” 默认不作为系统通知的快捷按钮，若提供，必须显示作用域、过期
  时间和清理入口，并映射到已有的受限 remember 语义；
- 通知本身不持有可重复使用的执行权限，也不把修改后的 shell 字符串直接传给
  sidecar。

#### 文件拖放与剪贴板

文件拖入先显示将要绑定的绝对路径和规范化 Project root，用户确认后才切换项目。
剪贴板图片保存到受控的 Project `.mini-agent/attachments/` 目录，沿用 Gateway
的大小、格式和日志脱敏约束；不把剪贴板内容常驻写入全局状态。

### 5. Workspace anchoring 不是单独的沙箱

Tauri host 对所有本地文件命令实施 Project-relative API：

1. 接受相对路径和已登记的 Project root，不接受 WebView 任意绝对路径；
2. 规范化 root 和 target，拒绝 `..`、越界、非法 scheme、绝对路径绕过和 symlink
   逃逸；对新建文件检查父目录并在实际操作前再次校验；
3. 文件读写使用 hash/expected revision，防止外部编辑器悄悄覆盖用户内容；
4. 真实工具操作仍由 App Server 的执行器和审批策略完成，Tauri 不直接拼接 shell
   命令，也不绕过 App Server 的 policy；
5. 任何 `resolve` 后到使用前的竞态、平台 symlink/junction 和权限错误都必须转成
   明确的 conflict/permission 错误，而不是尝试“自动修复”。

目录校验、Tauri capability、WebView CSP、sidecar 签名和操作系统权限共同降低风险；
它们不能阻止恶意或已获批的工具在工作区内删除数据，因此 UI 必须继续显示审批与
恢复提示。

### 6. 工具进程资源调度为 best effort

由 Desktop 启动的工具进程应归属于可终止的进程组，并记录 Project、Turn 和 owner。
可按平台设置较低优先级或可选 CPU/内存限制：Windows 使用 Job Object 等机制，
Unix 使用进程组、nice/cgroup（若可用）。这些是缓解措施，不是“UI 永远优先”或
跨平台统一 CPU 百分比的保证。用户可以配置并查看限制失败原因。

App Server 启动的工具必须避免继承 JSON-RPC stdin，并保持非交互环境设置，避免
pager、子进程抢读管道和退出时孤儿进程。终止时先协作取消，再按超时升级，最后
显示可能未保存/未结算的状态。

### 7. Preview 与外部内容隔离

Agent 生成的 HTML/SVG/本地开发服务默认在受限 iframe 或独立窗口中打开：

- 只允许登记的 loopback origin；不允许任意 remote/file/data URL；
- 使用严格 CSP、禁用不需要的 Tauri API 注入，并给预览窗口单独的 WebView label；
- 跨源页面不能被主 WebView 读取 console；只显示加载错误/健康探针，除非应用主动
  提供 bridge；
- 预览窗口不共享主窗口的 secrets、invoke 权限或审批上下文；
- 预览健康探针和重定向校验与 Web Studio ADR 的 loopback/SSRF 规则一致。

### 8. 模型与凭据

Tauri host 不解析或记录 Provider secret。生产包通过 App Server 的现有配置机制
连接云端或用户显式配置的本地服务；凭据存储优先采用操作系统 credential store，
若不得不使用文件，必须说明权限、脱敏和迁移。离线模型下载、插件安装、自动更新
和第三方 provider 目录均超出本 ADR，后续单独评审。

## Proposed Module Allocation

```text
desktop/
  src/commands.rs          # WebView 可调用的窄命令面
  src/sidecar.rs           # sidecar 生命周期、stdio 和退出状态
  src/event_bus.rs         # identity、sequence、bounded batching/resync
  src/workspace.rs         # Project root、路径和 revision 校验
  src/notifications.rs     # 平台通知能力与 fallback
  src/windows.rs           # 主窗、HUD、审批、预览窗口
frontend/src/transport/
  agentTransport.js        # 共享接口
  webGatewayTransport.js   # 现有 REST/WebSocket
  tauriTransport.js        # invoke/listen 适配
```

命令面使用显式 DTO，不把任意 JSON `invoke` 转发给 Rust。每个 command 标明输入
上限、所需 capability、是否幂等和错误类型；窗口层不能直接操作 sidecar stdin。

## Alternatives Considered

| 方案 | 结论 |
| :--- | :--- |
| 继续使用浏览器 + FastAPI | 保留为当前默认和开发模式，权限模型简单、无需桌面打包 |
| Electron | 能力成熟但自带 Chromium/runtime，资源和分发成本与本项目目标不符 |
| Tauri + 打包 Python Gateway | 可较快复用现有 API，但不能提供真正零 Python 运行时，升级/签名面更大 |
| Tauri 直接嵌入 Core | 可能减少 IPC，但破坏崩溃隔离并扩大依赖，待 sidecar 基线后再评估 |
| Tauri + App Server sidecar | 本提案选择；复用协议，隔离崩溃，桌面包不依赖 Python |

## Security and Failure Handling

- 默认不监听 TCP；开发/兼容 Gateway 若启动，绑定 loopback 并限制 Origin/CSRF，
  不以 CORS 充当认证。
- sidecar 可执行文件必须与目标平台和版本匹配，发布包校验完整性；启动失败时不
  回退到 PATH 上同名的未知可执行文件。
- 所有跨 WebView 消息、通知点击、拖放路径和 clipboard payload 都做 schema、大小
  和来源校验；拒绝未知 capability。
- sidecar 崩溃、WebView 重载、睡眠唤醒和网络变化后，UI 显示 stale/disconnected，
  先 snapshot resync，再恢复流；不重复提交上一次不确定的 turn。
- 更新和卸载不得删除用户 Project 或未经确认的 `.mini-agent` 状态；日志默认不含
  prompt、工具参数、环境变量和凭据。
- 对路径越界、junction/symlink、进程树回收、通知 fallback、CSP、预览重定向、
  重复 invoke、审批超时和批处理溢出建立跨平台测试矩阵。

## Acceptance Criteria

MVP 只有同时满足以下条件才算可试用：

1. Web 与 Tauri transport 通过同一组 frontend reducer/contract tests，能完成
   initialize、thread read/start/fork、turn stream、Steer、Interrupt、approval 和
   snapshot resync；
2. sidecar 仅通过受控 stdin/stdout 运行，stderr、退出码、协议错误和重启状态可见；
3. 在 1,000 条/秒的合并后事件压力下，队列有界，控制事件不被饿死，溢出可恢复，
   性能报告列出测试平台和是否包含 WebView/sidecar；
4. Project-relative 文件 API 拒绝 traversal、绝对路径、symlink/junction 逃逸和
   hash 冲突，测试证明 Tauri invoke 不能直接执行任意 shell；
5. 预览只允许登记的 loopback origin，非支持 action 的平台能回退到审批窗口；通知
   点击不会在窗口外自动授权；
6. 主窗口关闭/恢复、Tauri panic、sidecar crash、系统睡眠唤醒和网络断开后，终端
  /桌面资源可回收且用户不会误看到“已完成”；
7. Windows、macOS、Linux 至少各有构建和启动 smoke；签名、自动更新和系统权限
   差异记录在发布文档；
8. 继续运行 `mini-agent-web` 现有 Python、frontend build/test 和 SDK protocol
   fixture，未引入对真实 Provider 的默认依赖。

## Roadmap

### M0 — Transport contract and threat model

- 抽取 `AgentTransport`，补齐 Web 实现的 contract tests；
- 固定事件包络、command DTO、bounded limits、错误码、Project/Thread/Turn identity；
- 记录 sidecar 打包目标、签名和升级策略，决定桌面工程归属。

### M1 — Tauri shell and sidecar

- 创建最小 Tauri 2 工程，开发模式复用 React build；
- 实现 sidecar 启动、JSONL reader/writer、initialize、日志和退出状态；
- 接入 Tauri transport，使基础 thread/turn/approval 流程不依赖 Python Gateway。

### M2 — Native window and event bus

- 加入 bounded event bus、batch/resync、主窗口/HUD/托盘和有限全局热键；
- 接入剪贴板、拖放和审批通知 fallback；
- 完成 sidecar crash、睡眠唤醒、重复命令和权限测试。

### M3 — Workspace, preview, and packaging

- 实现 Project root/revision 校验、进程组回收和 loopback Preview；
- 加入跨平台 capability/CSP 配置、构建、签名和 smoke pipeline；
- 发布实际包体、启动、内存和 CPU 报告，修正未达标目标，而不是修改口径。

### M4 — Re-evaluate in-process mode

- 只有 M1–M3 的 sidecar 方案证明 IPC 成为实际瓶颈时，才对 In-Process 做原型；
- 对比崩溃隔离、升级、内存、调试、协议复用和安全边界；
- 若采用，必须另立 ADR 并保留 sidecar fallback。

## Consequences

### Positive

- 用户可获得窗口常驻、托盘、快捷唤醒和系统级状态提示，同时保留现有 React 资产；
- sidecar 保持 App Server 的进程隔离，桌面包可以摆脱 Python Gateway 的生产依赖；
- 共享 transport/event contract 让 Web、Desktop 和未来 TUI 的行为更容易对照验证。

### Trade-offs

- 需要维护 Tauri 权限、sidecar 多平台构建/签名、WebView 差异和自动更新；
- 原生通知 action、全局热键、CSP、剪贴板和窗口行为具有平台差异，必须提供 fallback；
- sidecar 增加一个进程和 IPC 层，微批处理会带来小幅延迟；
- Tauri host 不是完整 sandbox，用户仍需理解工具审批、Project root 和文件恢复边界。

## Open Questions and Reconsideration Triggers

1. Desktop 工程放在本仓库还是 Rust workspace？未确定前不应生成重复的 protocol
   类型或 sidecar 构建脚本。
2. 生产包是否需要同时支持不带 Python 的用户？若不需要，打包 FastAPI 可能更快；
   若需要，必须比较 Python bundle 与原生 transport 的维护成本。
3. 目标平台最低 WebView/runtime 版本、签名主体、自动更新渠道和凭据存储尚未确定，
   它们是发布前置条件。
4. 如果首轮用户只需要常驻窗口而不需要全局热键/通知，应先交付 M1，避免提前承担
   系统权限和跨平台发布复杂度。
5. 只有当真实 profile 的性能数据证明 sidecar 是瓶颈，或 App Server 提供稳定库
   API 时，才重新考虑 In-Process；不能以“零拷贝”作为未测量的决策依据。
