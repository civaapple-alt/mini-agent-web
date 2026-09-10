# 提案：Web Studio 与 Gateway 的职责化模块重构

## Status

Proposed

## Date

2026-09-10

## Scope

`frontend/src/`、`server/`、相关单元测试与稳定文档索引。第一阶段只做职责拆分
和依赖整理，不修改 REST/ WebSocket 路由、JSON 字段、App Server JSON-RPC
协议或用户可见行为。

## Context

截至 2026-09-10，按物理行统计，当前较大的文件包括：

| 区域 | 文件 | 约行数 | 当前混合职责 |
| --- | --- | ---: | --- |
| Frontend | `frontend/src/App.jsx` | 2,025 | 应用装配、WebSocket 事件、会话切换、历史恢复、Turn 控制、Plan/Goal、审批和设置同步 |
| Frontend | `frontend/src/components/Sidebar.jsx` | 1,127 | 项目树、项目 CRUD、会话列表、会话菜单、创建/编辑弹窗和最近会话 |
| Frontend | `frontend/src/components/InputBar.jsx` | 936 | 编辑器输入、Mention、Slash、附件、队列、Steer、审批和提交 |
| Frontend | `frontend/src/components/SidePanel.jsx` | 875 | World、Workflow、文件、MCP、Git、Goal 数据加载与面板渲染 |
| Frontend | `frontend/src/utils/messageState.js` | 684 | 历史消息、流式事件、工具生命周期、压缩和 Turn 投影 |
| Backend | `server/session_manager.py` | 2,136 | 持久化、项目注册、Thread 路由、客户端池、生命周期、Turn、审批、WebSocket 广播 |
| Backend | `server/routes/world.py` | 853 | 项目、World、执行策略、审批、Workflow、文件和 Git 路由 |
| Backend | `server/routes/agent.py` | 711 | 同步 Turn、SSE、Steer、Interrupt、审批响应和 WebSocket 流协调 |
| Backend | `server/session_catalog.py` | 625 | SessionStore 解析、状态投影和历史目录查询 |

行数不是本提案的唯一目标。真正的问题是同一个文件同时修改多个状态域，导致：

1. 会话、项目和 Thread/Turn 身份约束容易在新增入口时被绕过；
2. 审批、停止、重连、历史恢复等异步路径难以单独测试，状态竞争只能靠阅读整
   个单体文件发现；
3. 前端 React 闭包、请求 epoch、WebSocket 事件游标和后端项目路由彼此耦合，
   小修改容易影响其他项目或会话；
4. 路由函数包含业务编排，异常映射、权限边界和数据投影重复出现；
5. 代码审查无法快速判断改动属于 UI、Gateway 控制面还是 App Server 执行面。

这与 Agent Harness 的长期边界一致：Agent Loop 可以替换，但 State、Permission /
Sandbox、Recovery 和 Audit 的控制面边界应保持稳定。重构应降低单文件复杂度，
而不是引入一个新的通用框架。

## Change-admission answers

1. **归属**：主要属于 Web Studio Frontend 和 Gateway 控制面；不进入 Core、
   App Server 执行内核，也不增加新的策略、插件或依赖注入框架。
2. **现有归属**：复用 `SessionManager` 的项目/Thread/审批权威、
   `SessionCatalog` 的 canonical Session 读取、现有 `api` facade、事件 reducer
   和既有路由；拆分只移动责任，不复制权威状态。
3. **可移除概念**：优先删除重复的请求取消、项目解析、错误转换和事件归一化分支；
   不以增加一层 service/interface 作为默认答案。
4. **行数**：目标是降低高复杂度文件和重复分支，整体代码净增长接近零。每个阶段
   必须报告物理行和测试行变化；若新增适配代码，必须删除等量旧分支或说明永久
   复杂度为何值得保留。
5. **可见面**：不扩展模型输入、事件类型、持久化格式或公开协议；内部模块边界
   不应改变 Project/Thread/Turn identity、审批 scope、停止分类和恢复语义。
6. **证据**：已有前端、Gateway、SessionCatalog 和 API 测试作为基线；每次拆分还
   必须增加针对身份隔离、乱序/重复事件、审批竞争和失败恢复的边界测试。

## Decision proposal

采用“薄装配层 + 按状态域拆分”的渐进式重构：

- React `App.jsx` 和 Python `SessionManager` 在过渡期继续保留公开入口，作为兼容
  facade 和装配点；
- 新模块只拥有一个明确状态域，不能通过另一个模块的私有缓存取得执行权；
- 路由只负责解析请求、调用控制面、转换 HTTP/WebSocket 响应，不能直接操作
  App Server client、approval Future 或文件持久化；
- 前端 hook 负责异步生命周期，纯 reducer/selector 负责投影，组件负责渲染；
- 每一步都可以单独合并、验证和回滚，不进行一次性“重写”。

### 1. Frontend 目标拓扑

候选目录如下，名称可在实现前按现有导入关系微调：

```text
frontend/src/
├── App.jsx                         # 页面装配与跨 hook 协调
├── app/
│   ├── useSessionCatalog.js        # 项目/会话列表、刷新、选择持久化
│   ├── useSessionRuntime.js        # WS、重连、事件游标、运行时快照
│   ├── useThreadLifecycle.js       # attach、历史、replay、切换 epoch
│   ├── useTurnController.js        # send、queue、steer、interrupt、approval
│   └── useWorkflowController.js    # Plan、Goal、continuation、execution
├── api/
│   ├── request.js                  # 请求、AbortSignal、错误归一化
│   ├── threads.js                  # Thread/Session 资源
│   ├── projects.js                 # Project 资源
│   ├── agent.js                    # Turn/approval/stream 资源
│   └── world.js                    # World/Workflow/files/Git 资源
├── components/
│   ├── Sidebar.jsx                 # 项目树装配
│   ├── sidebar/ProjectTree.jsx     # 项目与 Thread 行渲染
│   ├── sidebar/ProjectModal.jsx    # 创建/编辑/删除项目
│   ├── sidebar/ThreadRow.jsx       # 状态徽标、选中和菜单
│   ├── InputBar.jsx                # Composer 装配
│   ├── input/MentionPicker.jsx     # 有界文件引用
│   ├── input/SlashCommandMenu.jsx  # Slash 解析与候选
│   ├── input/ApprovalDock.jsx      # Allow/Deny/Remember 展示
│   └── SidePanel.jsx               # Tab 装配
└── utils/
    ├── messageState.js             # 保持纯消息/事件投影
    ├── sessionState.js             # 会话快照和隔离 selector
    └── ...
```

`api.js` 可以先保留为向后兼容的 facade，内部转发到 `api/` 模块；迁移完成后
再评估是否删除 facade。`messageState.js` 不应和 React hook 混合，继续保持可用
纯函数测试。

Frontend 的关键不变量：

- 所有异步结果都用 `(projectId, threadId, requestEpoch)` 校验后才能写入当前 UI；
- WebSocket 事件仍按 Project/Thread/Turn/sequence 过滤，丢包通过 snapshot/replay
  修复，不能由组件自行猜测；
- `pendingApproval` 只能由当前会话且未停止的 Turn 驱动；切换会话或停止后，旧
  审批事件不能重新打开审批 UI；
- `App.jsx` 不再保存与 hook 重复的 mirror state；需要跨模块共享时使用明确的
  snapshot/dispatch 返回值，而不是读取组件私有状态。

### 2. Gateway 目标拓扑

`SessionManager` 目前是控制面单体，建议按所有权拆成内部协作者。第一阶段不改变
外部导入路径，仍由 `server/session_manager.py` 暴露 `session_manager` facade。

```text
server/
├── session_manager.py              # facade、生命周期装配和跨域协调
├── control/
│   ├── project_registry.py         # 项目注册、切换、源目录和执行配置
│   ├── thread_registry.py          # Thread -> Project、元数据和 canonical 读取
│   ├── client_pool.py              # client 创建、绑定、复用、restart/stop
│   ├── turn_registry.py            # active Turn/task、取消和停止分类
│   ├── approval_bridge.py          # pending approval、tombstone、resolve/broadcast
│   └── ws_broker.py                # Project-scoped WebSocket 连接和广播
├── persistence/
│   ├── json_store.py               # 原子 JSON 写入和有限错误处理
│   ├── settings_store.py           # 全局设置读写
│   └── project_threads_store.py    # 分项目 Thread metadata 读写
├── session_catalog.py              # canonical SessionStore 目录（保持单一实现）
└── routes/
    ├── threads.py                  # Thread 资源和投影路由
    ├── agent.py                    # 兼容入口或最终变为薄路由汇总
    ├── agent_turns.py              # 同步/SSE Turn 入口
    ├── agent_control.py            # Steer/Interrupt/approval response
    ├── agent_ws.py                 # WebSocket 连接和流适配
    ├── world_projects.py           # Project 路由
    ├── world_execution.py          # access/policy/MCP/approval
    ├── world_workflows.py          # Plan/Goal/Workflow
    └── world_files.py              # workflow files/workspace/Git
```

这里的 `control/` 不是第二个权限系统：

- 项目执行范围和审批 authority 仍只有 Gateway/Capabilities 现有来源；
- `approval_bridge` 只等待、取消和转发决定，不自行授权工具；
- `client_pool` 只负责 Project/Thread 到 client 的绑定，不保存另一份会话历史；
- `session_catalog` 继续是 canonical SessionStore 读取入口；
- `ws_broker` 不能改变事件身份或把一个项目的消息广播给另一个项目。

### 3. Route 与服务边界

每个路由处理器应稳定在“验证输入 -> 调用一个控制面操作 -> 转换结果/异常”范围
内。当前 `agent.py` 中的流循环、审批等待和 WebSocket 辅助函数应先抽到
`control`/`transport` 层，再保留薄 HTTP/SSE/WS adapter。`world.py` 拆分后所有
路由仍使用同一个 `APIRouter` 汇总，避免重复注册或改变 OpenAPI 路径。

错误转换要集中并保持兼容：

- `409` 继续表示锁、并发或状态冲突；
- `404` 继续表示不存在的 Project/Thread；
- `400/503` 继续区分应用错误和服务进程不可用；
- 结构化 detail 字段不因模块移动而改名。

## Migration plan

### M0 — 基线与契约锁定

- 记录入口函数、路由表、导出 `api` 形状和当前测试基线；
- 为项目/Thread/Turn scoped key、审批停止、WebSocket 项目过滤补齐 characterization
  tests；
- 明确每个待拆函数的“输入、输出、拥有的状态、允许的副作用”；
- 每个 PR 完成 `.github/pull_request_template.md` 的六项 change admission。

### M1 — 先拆纯函数和无副作用投影

- 从 `App.jsx` 提取 session key、请求上下文、状态投影和事件分类 helper；
- 从 `Sidebar.jsx`、`InputBar.jsx`、`SidePanel.jsx` 提取行组件、弹窗和纯 selector；
- 从 `session_manager.py` 提取路径解析、元数据投影和异常分类 helper；
- 只移动代码并保持现有测试，不在此阶段改变并发时序。

### M2 — Frontend hook 与 API domain 拆分

- 引入 `api/` domain modules，保留 `api.js` facade；
- 按会话目录、运行时流、Turn 控制、Workflow 控制拆分 hooks；
- `App.jsx` 只负责装配和跨域协调；
- 针对会话切换期间的旧请求、后台运行会话、工具审批和停止竞态增加 UI 测试。

### M3 — Gateway control plane 拆分

- 先拆 persistence，再拆 project/thread registry；
- 再拆 client pool 与 turn registry；两者必须共用结构化 Project/Thread identity；
- 最后拆 approval bridge 和 WebSocket broker；审批与广播迁移期间保留旧端到端测试；
- `SessionManager` 暂时只做组装和兼容转发，确认调用方迁移后才删除旧私有实现。

### M4 — 路由拆分与清理

- 将 `world.py`、`agent.py` 按资源/传输职责拆成路由模块；
- 对外仍由现有 `app.py` 注册同一批路由；
- 删除已无调用方的兼容 wrapper、重复错误转换和死分支；
- 更新目录 README、测试说明和本提案状态；落地后将本文件移到
  `.agents/notes/implemented/architecture/`。

每个阶段应使用小提交完成，推荐提交边界：`extract pure helpers`、`split frontend
domain`、`split gateway control`、`split routes`、`remove obsolete shims`。禁止把
功能变更、协议变更和大规模格式化混在同一个重构提交中。

## Verification and acceptance

### 必须保持的行为

1. REST、SSE、WebSocket 路径、请求字段、响应字段和错误码保持兼容；
2. 多项目可以同时拥有同名 Thread（例如各自的 `default`），不会串流或串策略；
3. 会话切换、重连、历史 replay、运行中 Turn、停止和工具审批的状态保持一致；
4. 停止发生在审批等待期间时，审批决定不能重新启动已停止 Turn，UI 仍显示最终
   停止状态；
5. Plan 关闭、Goal 暂停/恢复、策略切换和 session attach 的现有语义不变；
6. `SessionCatalog`、项目元数据和 SessionStore 仍只有一个权威读取/写入路径。

### 自动化证据

- Backend：`uv run pytest -q`、`uv run ruff check .`、`uv run ruff format --check .`；
- Frontend：`npm --prefix frontend run lint`、`npm --prefix frontend test`、
  `npm --prefix frontend run build`；
- 路由契约：启动无 provider 的 Gateway，检查路由数量、OpenAPI 路径和关键字段；
- 竞争场景：至少覆盖两个项目、两个会话、两个浏览器连接同时运行，一个连接切换
  会话、一个连接处理审批、另一个连接停止 Turn 的组合；
- 失败场景：App Server 锁定、WS 断线重连、事件重复/乱序、replay gap、请求取消、
  client 创建失败、持久化写入失败和过期审批决定；
- 每个阶段审查物理行数、导入依赖和测试差异，不能以减少行数换取边界退化。

### 结构质量门槛

- `App.jsx`、`session_manager.py` 在最终阶段只保留装配和少量跨域协调；
- 新模块默认不超过约 400–600 行，超过时必须在 change admission 中说明原因；
- 新模块不能同时拥有 UI 渲染、异步请求和持久化副作用；
- 不新增全局 singleton、隐式 event bus、通用 service locator 或平行权限缓存；
- 无新增循环依赖，路由模块不能反向依赖 React/CLI，纯 reducer 不能依赖网络；
- 重构后的失败路径必须比重构前更容易定位，至少保留 Project/Thread/Turn 和
  request/sequence 信息。

## Risks and mitigations

| 风险 | 表现 | 缓解 |
| --- | --- | --- |
| React 闭包/epoch 丢失 | 旧会话历史覆盖新会话 | 先提取 request context 和 scoped key，增加切换竞态测试 |
| 审批 authority 分叉 | 不同模块各自决定 Allow/Deny | bridge 只转发，授权仍走现有控制面；禁止 shadow cache |
| Thread/Project 串线 | 两项目同名 `default` 收到对方事件 | 所有内部 map/key 强制使用结构化 tuple/key helper |
| WebSocket 双重监听 | 重连后重复消息或重复审批 | broker 负责连接生命周期，保留 sequence 去重和重连测试 |
| 路由重复注册 | OpenAPI 或请求命中顺序改变 | 迁移前后对比路由表，统一在 `app.py` 汇总注册 |
| 持久化写放大/脏写 | 拆分后不同 store 覆盖彼此状态 | 复用现有原子写入和按域保存，不新增无锁全量写路径 |
| 过度抽象 | 文件变短但调用跳转变多 | 每次拆分先写责任表；没有独立状态/测试价值的函数不抽服务类 |

## Non-goals

- 不借重构机会修改模型、Provider、App Server 或 JSON-RPC 协议；
- 不新增策略框架、插件系统、事件总线、数据库或依赖注入容器；
- 不重新设计 Web Studio 视觉样式，不把 CSS 拆分当作本阶段主目标；
- 不改变默认会话、Plan/Goal、审批、停止和恢复的产品语义；
- 不为了达到某个行数数字删除必要的边界测试、Actor/CAS/Session authority 或
  公开协议行为。

## Open questions and reconsideration triggers

1. `SessionManager` facade 在 M3 后保留到哪个版本；若外部代码仍直接使用私有属性，
   应先完成调用方迁移，而不是继续扩张兼容层。
2. Frontend hooks 是否按“会话/Turn/Workflow”拆分，还是保留一个运行时 hook；以
   请求取消、测试隔离和跨模块依赖数量作为决定依据，不以文件数量决定。
3. `world.py` 是否保留为路由汇总文件；若汇总本身超过简单注册职责，应迁移为
   `routes/world/` 包，但必须避免与已有 `world.py` 同名导入冲突。
4. 若重构暴露出 App Server 缺少稳定的 approval/stop/replay 契约，应记录为独立
   协议提案，不能在本提案中通过 Gateway 私有状态补齐。
