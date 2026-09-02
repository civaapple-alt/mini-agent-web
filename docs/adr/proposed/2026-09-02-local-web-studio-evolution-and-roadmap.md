# ADR: Local Web Studio Evolution — Diff Review, Artifacts, Preview, and Goals

## Status

Proposed

## Date

2026-09-02

## Scope

`frontend/`、`server/` 以及必要的 `mini-agent` SDK 适配。第一阶段不修改
`mini-agent-app-server` 的 JSON-RPC wire protocol；如果某项能力依赖底层新增
能力，先以可选扩展或适配层验证，待契约稳定后再进入协议变更评审。

## Context

### 当前基线

截至 `0.6.0`，本仓库已经具备一个可工作的本地 Web Studio：

- React 19 + Vite 6 前端，现有组件包括会话侧栏、聊天区、Thinking、ToolCard、
  输入栏、设置和多 Tab SidePanel；
- FastAPI Gateway 通过 `MiniAgentClient` 连接 App Server，提供 REST、SSE 和
  `/ws/agent` 全双工 WebSocket；
- 流式事件携带 Thread/Turn 身份与序号，前端会拒绝其他 Thread 的事件；未知
  事件在 SDK 中保留为 `GenericEvent`；
- 已有线程列表、读取、fork、关闭、Workflow/Plan/Goal 状态、Git 状态和受限的
  工作区文件列表 API；SessionManager 持久化项目、设置和线程元数据；
- 现有审批协议是一次性的 `approved`/`denied` 决策，支持会话级按工具记忆，
  不支持修改待执行命令。

当前尚未实现的能力包括 Monaco Diff、工作区文件监听、端口发现与预览代理、
符号索引、Goal DAG、历史 Checkpoint 选择性回溯以及可编辑审批。因此本 ADR
记录的是演进设计，不把这些目标描述为现有功能。

### 要解决的问题

Agent 直接修改工作区后，用户难以回答“改了什么、是否仍是我看到的版本、能否安全
回退”。长时间运行的开发服务器和多文件生成也缺少可观测的中间状态；Goal 当前只
投影简单的里程碑计数，不能表达依赖和验证结果。

### 设计约束

1. Gateway 仍是浏览器的唯一服务边界，底层 App Server 的 Thread/Turn 语义和
   protocol version `1` 不被前端重新解释。
2. 所有事件必须有界：文件内容、工具输出、Diff、符号结果和 DAG 节点都要有
   最大数量或字节数，并在 UI 中明确显示截断。
3. 工作区路径、预览 URL、Git 内容和工具参数均属于不可信输入；本地运行不等于
   无需防护。
4. “回退会话历史”和“回退磁盘文件”是两个不同操作，不能用一个按钮模糊代替。
5. 首个可交付版本优先保证可审查、可恢复和可诊断，不以“IDE 级”作为未验证的
   性能或安全承诺。

## Decision

采用分阶段、契约优先的 Web Studio 演进方案。前端保留现有 REST/WebSocket
transport，新增能力通过 Gateway 的明确路由和版本化事件投影提供。

### 1. 统一事件和资源模型

现有 App Server 事件继续使用原始 `event` 字段，不修改其类型名。Gateway 新增
的 UI 事件采用如下包络，旧客户端可以忽略未知 `type`：

```json
{
  "schemaVersion": 1,
  "type": "workspace_changed",
  "projectId": "project-1",
  "threadId": "thread-1",
  "turnId": "turn-1",
  "sequence": 42,
  "data": {}
}
```

`projectId`、`threadId`、`turnId` 是隔离和恢复所需的身份；`sequence` 只在同一
资源流内单调递增。客户端重连后以 REST 快照恢复，再接收增量事件；事件丢失不能
靠猜测补齐。

### 2. Diff Review：先做可审查的 post-apply Diff

第一阶段采用“工具完成后比较基线与当前文件”的 post-apply 模式：

1. 在已知文件操作开始前，Gateway 记录相对路径、存在性、大小、mtime 和内容
   hash；超出大小上限的文件只记录元数据并标记不可预览。
2. 工具完成后读取当前版本，生成统一 Diff 资源，包含 `baseHash`、`resultHash`、
   `path`、语言提示和有界的 hunks。
3. Monaco 只按需动态加载；用户可在 Side-by-Side 与 Inline 视图间切换。
4. 如果磁盘 hash 已经被其他进程改变，Diff 标记为 conflict，禁止静默覆盖。

这里的“Accept”表示确认保留当前结果，“Revert”表示在 hash 仍匹配时恢复到
基线；两者都必须经过 Gateway 的路径校验。按行接受/拒绝不作为第一阶段承诺，
因为当前工具已经可能直接写盘，前端无法安全地把一个 hunk 当成独立补丁提交。
待引入带 `baseHash` 的 staged patch API 后，再讨论 granular apply。

拟提供的内部资源形态：

```text
GET  /api/workspace/files/{path}/snapshot
GET  /api/workspace/diffs/{diff_id}
POST /api/workspace/diffs/{diff_id}/revert   { expectedResultHash }
```

具体路由名称可以在实现时调整，但必须保留 hash precondition、相对路径和明确
的冲突错误；不能提供任意绝对路径读写接口。

### 3. Artifact 与工作区树：结构化事件优先，监听作为补充

不把模型文本正则作为文件事实来源。文件 Artifact 的来源优先级为：

1. App Server 已有的结构化 `tool_started`/`tool_finished` 参数与结果；
2. Gateway 对已知工具执行记录的适配；
3. 仅用于 UI 提示的文本识别，必须标记为 `hint`，不能触发写盘或安全决策。

Gateway 为每个 Project 维护有界的工作区树快照。首个实现可以使用异步轮询；只有
在实际基准证明轮询不足后，才引入 `watchfiles`/平台 Watchdog。事件采用防抖和
合并发送，包含 `revision`、增删改路径和 `rescanRequired`；高频变化只保留最新
快照。沿用现有忽略目录（`.git`、`node_modules`、虚拟环境、构建产物和
`.mini-agent`），并限制扫描深度、文件数、单文件元数据和事件队列长度。

前端文件树显示 `generating` 时，必须能关联到具体 `threadId`/`turnId`/`callId`；
无法建立关联时显示“外部变更”，不能把它归因给当前 Agent。

### 4. Live Preview：显式登记的 loopback 代理

端口探测只负责发现候选地址，不能自动获得任意本地网络访问权。设计如下：

- 从受控子进程的 stdout/stderr 中提取候选 URL，同时记录进程、Project、发现时间
  和来源；解析器是可测试的多格式 parser，不依赖单个正则；
- 仅接受 loopback 地址和用户明确允许的端口/来源，拒绝外网地址、文件 URL、
  重定向到非允许地址及可疑的 IPv4/IPv6 表示；每次请求仍做重新解析，防止 DNS
  rebinding 和 SSRF；
- 优先让 WebView 直接访问已允许的 loopback URL。只有在需要同源或健康探针时，
  才提供受限的 `/api/preview/*` 代理；代理不默认剥离 `X-Frame-Options`、CSP
  等安全 Header；
- Preview 记录健康状态、最后探测错误和生命周期，不负责猜测或杀死用户手动
  启动的进程。由 Studio 启动的进程必须有可回收的进程组和显式停止操作；
- 跨源 iframe 的 Console Bridge 不是通用能力。首版只显示 iframe 加载错误和
  代理日志；应用自行注入 bridge 或同源时，才启用结构化 console/error 事件。

前端提供刷新、在外部窗口打开和有限的视口预设；预览失败时保留 URL、健康探针
和安全拒绝原因，便于诊断。

### 5. Goal DAG 与 Checkpoint：先做只读投影，回溯默认 fork

当前 Workflow API 只暴露 `plan_active` 和 Goal 的状态、当前里程碑、总数、循环
计数与预算。第一阶段把这些字段投影为线性节点，并增加验证结果和 criteria 的
只读展示；不要先引入 Mermaid 作为运行时依赖。

当底层能够提供稳定的里程碑依赖后，Gateway 使用有界快照：

```text
GoalGraphSnapshot
  goalId, revision, status
  nodes: [{ id, title, status, criteria, checkpointSeq, verification }]
  edges: [{ from, to }]
  currentNodeId
```

服务端校验节点 ID 唯一、边不形成环、节点和文本均有上限；前端使用简单 SVG/DOM
布局，DAG 不直接执行模型生成的 Mermaid 字符串。

“Rewind”默认创建从已结算 Checkpoint 派生的新 Thread，原 Thread 保持只读可追溯；
只有在 App Server 明确保证 `thread/resume` 的历史选择语义后，才允许原 Thread
resume。会话回溯不自动恢复磁盘文件。文件恢复必须另行依赖 Git、工作区快照或
前述 Diff revert，并在 UI 上明确显示两者状态。

### 6. Mention、Token 预算与审批：以安全契约代替猜测

#### Mention

现有 `@` 能力是受限的工作区相对路径检索。扩展按以下顺序交付：

- `@file` 继续复用 `/api/world/workspace-files`，结果只返回相对路径和有限元数据；
- `@symbol` 首版使用本地、限时、限结果的语言无关候选扫描，返回位置和短片段；
  只有明确选择后才把内容注入 Prompt，单个引用和总引用都要截断；
- `@git` 只在用户确认后读取当前 Project 的有界 diff/status，并过滤明显的凭据
  文件与超限内容；不直接把整个仓库或任意 commit 注入上下文。

tree-sitter 和专门索引器属于后续优化，不作为第一阶段的硬依赖。

#### Token budget

UI 同时显示两类数字：客户端基于字符/编码估算的“预估值”，以及 App Server
事件提供的 `ModelUsage`“已用值”。模型上下文上限由 capability/配置提供，不能
硬编码为 128k；未知时显示“不可用”。预算条是提醒，不是安全边界，最终仍由
Gateway/App Server 的有界上下文策略拒绝或压缩超限输入。

#### Approval

第一阶段保留现有 Allow/Deny/Remember 流程。命令可编辑审批只有在底层提供结构化
`tool`、参数 schema、工作区约束和一次性执行 token 后才实现：用户提交的修改必须
重新解析、重新做策略判断、重新做路径校验，然后由执行器使用新的结构化参数执行。
禁止让前端直接替换一条 shell 字符串，也不使用“正则白名单即安全”的模型。默认
策略仍是 per-action；remember 必须绑定工具、Project、策略版本和会话范围。

## Architecture & Module Allocation

| 模块 | 首选位置 | 责任边界 |
| :--- | :--- | :--- |
| Diff resource / hash precondition | `server/routes/workspace.py`、`server/workspace_state.py` | 路径校验、快照、Diff、冲突和恢复；不让 React 直接写盘 |
| Workspace tree | `server/workspace_state.py` | 有界扫描/监听、去抖、revision 和变更事件 |
| Preview registry | `server/routes/preview.py`、`server/preview.py` | URL 解析、loopback allowlist、健康探针、进程归属和代理 |
| Goal projection | `server/routes/world.py` 与 `frontend/src/components/GoalKanban.jsx` | 将现有 Workflow 状态投影成只读图；不伪造底层 checkpoint |
| Diff UI | `frontend/src/components/DiffViewer.jsx` | Monaco lazy load、只读默认视图、hash 冲突和确认操作 |
| Stream/artifact reducer | `frontend/src/utils/` | 按 identity/sequence 合并事件；文本 hint 不能改变安全状态 |
| Mention and budget | `frontend/src/components/InputBar.jsx`、Gateway API | 有界引用、估算标识、capability 感知；不引入隐式全仓库读取 |
| Approval UI | 现有 `ChatArea`/`InputBar` 审批路径 | 第一阶段只扩展展示和状态；结构化可编辑审批另行评审 |

## Security and Failure Handling

- 默认只绑定 loopback；若允许局域网访问，必须增加认证、CSRF/Origin 校验和明确
  的启动选项。CORS 不能被当作认证机制。
- 所有新文件 API 只接受 Project 相对路径；检查规范化路径、父目录 symlink、
  文件大小和读取编码。写入前后都检查 hash，避免 TOCTOU 覆盖。
- 预览代理拒绝非 loopback、跳转越界、任意 scheme 和无界响应；响应体和并发请求
  都有限流。不能通过“剥离 Header”解决 iframe 兼容问题。
- 断线时 UI 显示 unknown/stale，不把最后一条状态当成完成；重连按快照 revision
  对账。事件队列溢出必须触发 rescan，而不是静默丢数据。
- Diff、日志、工具参数和 Mention 片段默认脱敏；不把 `.env`、私钥和完整环境变量
  回显到前端。
- 所有新路由在单元测试中覆盖路径越界、symlink、超限、hash 冲突、非 loopback
  URL、重定向和重复/乱序事件。

## Consequences

### Positive

- 用户可以在 Agent 修改后看到有身份和版本约束的 Diff，并安全处理冲突；
- 文件树、预览和 Goal 展示从“猜测 UI”变成可恢复的有界状态投影；
- 保留现有 JSON-RPC、SDK 和 WebSocket 使用方式，Web Studio 的升级不会迫使底层
  Core 为 UI 细节背负协议耦合；
- 结构化审批和 hash precondition 为将来 Tauri、TUI 或 IDE 客户端提供相同边界。

### Trade-offs

- post-apply Diff 不能在写盘前阻止每一种变化，粒度接受需要 staged patch 能力；
- 工作区监听、预览代理和脱敏会增加状态管理与安全测试成本；
- Token gauge 只能在模型 capability 和 tokenizer 不完整时提供估算，不能承诺精确
  计费或上下文剩余量；
- 本地服务、iframe、软链接和外部编辑器带来的状态竞争无法完全由 Web Studio 消除。

## Acceptance Criteria

一个阶段只有在以下证据具备后才算完成：

1. Diff 在外部进程改写文件、Agent 写入、文件删除、超限文件和 hash 冲突场景下
   都能给出可区分的状态；冲突不会覆盖磁盘。
2. 文件树在增删改和快速连续变化下最终与扫描快照一致，忽略目录、事件去重、
   队列溢出 rescan 均有测试。
3. Preview 只允许符合策略的 loopback 目标，拒绝跳转和超限响应；iframe 失败
   显示可诊断原因，不能绕过目标应用的安全 Header。
4. Goal 图对非法环、缺失节点和断线可恢复；选择回溯后原 Thread 不被破坏，且
   UI 明确说明会话状态与磁盘状态不同步。
5. Mention 和 Diff/工具输出均受大小上限约束；未知 App Server 事件仍能保留，
   Thread/Turn 隔离测试继续通过。
6. 审批修改（若进入该阶段）必须在服务端重新解析和授权；没有结构化执行契约时，
   功能保持禁用而不是退化为字符串替换。
7. 运行现有 Python 测试、前端测试、Ruff 和 frontend build；新增行为有对应的
   Gateway/API 测试与前端 reducer/UI 测试，并更新 CHANGELOG/相关指南。

## Roadmap

### M0 — Contract and observability

- 固化事件包络、Project/Thread/Turn identity、资源上限和错误码；
- 为当前 `world/workspace-files`、Workflow 和 Tool 事件补充契约测试；
- 明确 feature flag，未实现能力不在 UI 中显示为可用。

### M1 — Read-only Diff and workspace tree

- 实现基线/result hash、只读 Monaco Diff 和 post-apply revert；
- 增加轮询版树快照、revision、防抖事件和前端 artifact 状态；
- 只有 M1 的 hash/越界/断线测试通过后，才考虑 staged patch。

### M2 — Preview

- 完成候选 URL parser、loopback allowlist、健康探针和手动刷新；
- 先支持直接 iframe/外部窗口，再评估受限同源代理；
- 完成进程归属、停止语义和 SSRF/重定向测试。

### M3 — Goal projection and safe rewind

- 先渲染线性 Goal/criteria/verifier 信息，再接入有依赖的 DAG snapshot；
- 以 fork-first 实现历史回溯，并提供 Git/快照状态提示；
- 只有底层 checkpoint 选择语义稳定后才开放 resume。

### M4 — Bounded mentions and approval extensions

- 交付 `@file`/`@symbol`/`@git` 的有界结果与估算 Token gauge；
- 评审结构化 tool schema 后再实现可编辑审批；
- 任何安全策略扩展都必须有拒绝路径和迁移/清理 remembered approval 的方案。

## Open Questions and Reconsideration Triggers

1. App Server 是否能提供可寻址的历史 checkpoint，以及它是否包含文件状态？在答案
   明确前，不能承诺原 Thread 的 destructive rewind。
2. 运行开发服务器的进程归属应由 Gateway、Tauri 还是用户 shell 负责？若无法可靠
   回收进程，Preview 只做手动登记。
3. 是否需要把文件快照持久化到 `~/.mini-agent/`，以及如何限制磁盘占用？在保留策略
   未确定前只保存内存中的有界基线。
4. 若未来需要真正的 staged patch、精确 tokenizer 或跨语言 symbol index，应把它们
   升级为独立 ADR，而不是继续扩展本提案。
