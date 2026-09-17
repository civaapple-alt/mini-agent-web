# FastAPI Gateway

本目录实现 Mini Agent 的本地 FastAPI 网关。它管理 App Server 子进程，将
Python SDK 能力映射为 REST/WebSocket，并负责本地连接、审批和项目元数据的
网关级管理。

## 启动

```bash
uv run mini-agent-server
```

开发模式：

```bash
uv run mini-agent-server-dev
```

默认监听 `http://127.0.0.1:8000`，OpenAPI 页面为 `/docs`。静态 Web 资源
存在时，根路径同时提供 Web Studio。

## 路由边界

| 路由 | 作用 |
| --- | --- |
| `/ws/agent` | Turn 流、审批、Steer、Interrupt 和 runtime notifications |
| `/api/threads` | Thread 列表、创建、读取、按 source Project 派生独立 Session、摘要和关闭 |
| `/api/threads/{thread_id}/attach` | 按可选 Project ID/name attach 历史/暂停 Session，或报告外部运行锁 |
| `/api/threads/{thread_id}/items` | 有界 ThreadItem 历史投影 |
| `/api/threads/{thread_id}/events` | App Server `turn/event` 的有界 cursor 重放；发生 gap 时回退到 canonical history |
| `/api/threads/{thread_id}/runtime/status` | 非阻塞 runtime phase、Turn/operation/checkpoint 和错误快照 |
| `/api/threads/{thread_id}/settings` | Thread collaboration mode、Builtin tools、显式推进方式和 App Server `state_revision` |
| `/api/threads/{thread_id}/goal` | Thread Goal 的读取、设置和清除 |
| `/api/agent/*` | Turn、Steer、Interrupt 和审批 HTTP 操作 |
| `/api/skills` | 当前 Project 的有界有效 Skill 目录 |
| `/api/world/*` | World、MCP、Git 和本地工作区探测 |
| `/api/projects/*` | 本地项目元数据管理 |
| `/api/settings` | 网关偏好设置 |
| `/api/workflows/state` | 只读 workflow 聚合投影（含锁定 Session 的 canonical 状态） |

Thread、Turn、Goal 和 ThreadItem 的运行时语义来自 App Server；网关不创建
第二套运行时状态机。

技能目录来自当前 Project App Server 的 `initialize.capabilityManifest`，
不是 Gateway 扫描文件系统的结果。Runtime 会发现项目
`.agents/skills`、用户 `%USERPROFILE%/.agents/skills`、用户
`%USERPROFILE%/.mini-agent/skills` 和同步的 builtin group；直接子目录按
project > Agent Skills user > Mini Agent user > builtin > plugin 的优先级合并。
响应包含最多 64 个 Skill 的
`name`、`qualifiedName`、兼容 `aliases`、描述、来源、分组和启用状态，
以及最多 8 个 builtin group。WebStudio 默认把 `pstack` 写入新 Project
的 `builtin_skill_groups`；面板关闭它会在无活动 Turn/审批时重启该 Project
runtime，并让 `+ pstack` 与 `$pstack:skill` 入口 fail closed。

Turn 请求通过 `selectedSkills` 和可选 `workflow` 传递到 SDK：
`$pstack:architect` 是 Skill 级显式正文加载，`+ pstack` 是当前 Turn
的 metadata-first Skill Group 激活。Gateway 只转发清理后的 prompt 和结构化
名称，不接受或转发 Skill 路径/正文；Host 负责最终校验、8 个 Skill 和 32 KiB
正文限制。结构化 `skill_group_activated`、`skills_loaded` 和
`skills_load_failed` 事件沿 SSE/WebSocket/replay 原样转发。`skills_loaded` 的
`phase` 为 `started` 或 `loaded`；旧事件缺少该字段时按 `loaded` 处理。

运行时还会把每个已启用 Skill 的根目录作为受信任的只读根传给 Host。模型可以
通过现有 `read_file` 按需查看 `SKILL.md`、参考文档、脚本源码、assets 和其他
文本文件。Gateway 不扫描或预加载这些文件；首次读取 `SKILL.md` 才产生按需技能
状态事件，关联资源读取不重复产生事件。Skill 目录的读取合计受每个 Turn
64 KiB 的 `read_file` 输出限制，写入和脚本执行继续走 Host 现有的审批与沙箱路径。

输入历史由 `GET /api/threads/{thread_id}` 的 checkpoint 与
`GET /api/threads/{thread_id}/items` 的 bounded item projection 合并展示；
WebStudio 会跟随 `next_cursor` 加载最多最近 256 个 item，避免压缩后的
checkpoint 让较早用户输入消失。历史 item 的持久化时间以 `capturedAt` 投影，
旧记录没有有效时间时省略时间字段。附件原始字节不进入历史 JSON 或 item
projection；当前输入/队列保留图片数据，历史回放只显示已经持久化的有限附件摘要。

Web Studio 对剪贴板文本采用有界的临时附件体验：多行、较长或明显日志格式的粘贴内容
不会直接写入 composer，而是在提交前显示为 `pasted-text.txt` 附件。每个文本附件最多
128 KiB，每条消息最多 4 个；Gateway 将正文写入当前 Project/Thread 的隔离附件目录，
只把受控文件引用加入 Turn prompt，运行时可通过现有 `read_file` 按需读取。短句粘贴仍
直接进入输入框。文本附件不自动执行、不写入 Project 工作区，历史消息只显示有限文件名
摘要，不回显正文。

同一 Thread 的 Gateway attach/start 请求在客户端创建与 canonical Session 检查
期间串行化；并发请求会复用同一个已建立的 App Server client，不会制造重复的
workspace 绑定竞争。Thread fork 在同一 SessionManager 临界区内完成 source
checkpoint 复制、独立 child Session 创建、child App Server 启动、metadata 写入和
binding；父子 Thread 不共享 App Server client。并发 attach 会等待 child 完整绑定后
复用 child client；如果 child 启动失败，已持久化的 Session 仍可从 catalog 重新 attach。
Attach 成功响应同时返回 `active_turn_id` 和 `turn_active`；因此同一 Gateway
上的第二个浏览器可以沿用当前 Turn 身份继续观察。若锁属于外部进程，attach
只返回锁定信息并保持只读，不会创建第二个 writer。

Thread settings 的 `state_revision` 只是 canonical App Server revision 的有界
投影。Gateway 通过 WebSocket 原样转发 `thread/settings/updated` 以及带同一
revision 的 `thread/goal/updated|cleared`；Goal/settings REST action result 也
返回它。SDK 和 Web Studio 对每个 Thread 单调消费该 revision，Gateway 不保存
另一份 settings 或 Goal authority。历史 Session 尚未携带 revision 时返回空值；
WebSocket 重连后由 Studio 重新读取 workflow projection，以处理 App Server
重启造成的 in-memory revision 序列重置。Gateway 自己重绑 App Server 后还会
广播有界的 `gateway/runtime/restarted` generation；Studio 收到后清空旧 cursor
并执行同样的 canonical workflow read，即使浏览器 WebSocket 没有断开也不会继续
使用旧运行时的 revision。

SDK 的 `notification_handler` 负责把每个 App Server `turn/event` 和 runtime
notification 广播给所有 WebSocket 客户端；单个请求的 WebSocket 只发送自己的
`_turn_submission`，避免发起端收到重复事件。Studio 在 WebSocket 重连时使用
`/events?after_sequence=...` 补齐短暂断线期间的 Core 事件；如果返回
`has_gap=true`，则先重新读取 Thread/Item canonical projection。

工具审批也按 Project 广播给已连接的 Studio 客户端。多个浏览器可以同时看到同一
审批，但只有第一个通过 Project/Thread/Turn 身份校验的响应生效；Gateway 会立即广播
`approval.phase=resolved`，使其他浏览器关闭过期审批卡片。断线重连时仍通过审批快照
对账；Gateway 进程退出会取消内存中的待审批请求。

Studio 同时把 `approval.phase=resolved` 投影到消息流中对应的工具卡片，展示允许、拒绝、
失效或中断结果；审批 Dock 关闭后，用户仍能从工具卡片看到决策。工具匹配优先使用
`callId`，不会因为多个工具名称相同而把它们全部标记为待审批。

App Server 会在已绑定持久化 Session 的 Thread 目录旁写入独立的
`approval-evidence.jsonl`。该文件在请求进入等待态和最终决策时分别记录
`approval_requested` / `approval_resolved`，包含 Project/Thread/Turn/call 标识、策略、
访问范围、工具与命令首词、`session_item_id` 关联键、动作 hash 和结果。完整命令不复制
到该 trace；读取方用 `session_item_id=call_id` 关联同目录 `session.jsonl` 中对应的
`kind=item` 记录。它不属于 Gateway 的 pending 状态，也不是 Session history 或授权
缓存。多个 Thread 的项目级分析应在读取时聚合，trace 不能自动扩大 allow 规则。

所有 Thread、Turn、Workflow、World 和 Session 请求都使用统一的
`project_id` 路由上下文；REST 请求通过 query 参数传递，创建、attach、fork 和
Goal 请求在需要时同时保留 payload 字段。WebSocket 建连时使用
`?project_id=...`，每个 `turn`、`steer`、`interrupt`、审批响应和 `ping` 也会
携带项目标识。Gateway 按 Project 过滤 runtime 广播，Studio 会拒绝不属于当前
Thread/Project 的事件，避免同名 `default` Session 串线。

Web Studio 对会话目录、历史、Workflow 和文件读取使用 request epoch 与取消信号。
切换、创建、Fork 或关闭 Session 时，页面先原子清空旧的消息、Turn、Goal、Plan、
Runtime 和审批投影，再加载新项目的 canonical 状态；已失效请求即使晚返回也不能
回写当前页面。

Session 目录中的 `turn_active` 与 `process_online` 是两个独立观察点：前者仅表示
存在尚未结算且仍由存活进程持有的 Turn，后者表示进程锁在线。因崩溃留下的未结算
记录可能是 `process_online=false`、`turn_active=false`，但仍保留
`last_turn_status=in_progress` 供诊断，并在有 checkpoint 时标记为可恢复。空闲的
在线进程因此显示为“在线/待命”，不会被误显示为“运行中”。

`/api/workflows/state` 及线程目录还投影 `plan_review_pending`。已完成 Plan Turn
后的“继续规划/开始实施”确认写入 Session-owned `plan_mode.json`，刷新或恢复会话
时仍可继续处理；选择实施后才切回 default collaboration mode。

访问和批准是当前 Project 的执行设置：`project` / `full_machine` 控制路径范围，
`interactive` / `automatic` 控制审批策略；`once` / `session` / `project`
只在审批响应中表达本次 action grant 的生命周期。
`full_machine` 只表示整机路径范围，不是 allow-all；Deny、Plan 模式下的源文件变更锁、
工具可用性和仍需人工确认的高风险动作继续由 App Server/Host 执行。Shell 仍按所选
审批策略处理，Plan 不额外施加只读限制。`trusted` 自动放行经过工具自身校验的普通工作区
操作和普通 Shell；递归/强制删除、破坏性 Git、系统级命令、MCP、工作区外 `read_image`
和安全 Deny 规则仍需确认或拒绝。
`/api/world/execution` 更新这些 Project 设置时复用现有 App Server，不会为了策略切换重启
运行时；活动 Turn 仍由 App Server 拒绝控制面变更，Studio 提示用户等本轮结算后重试。
Auto Copilot 是 Web Studio 中显式选择的 `trusted + continuous` 运行预设，不由访问范围
或审批策略隐式推导；活动 Goal 会临时接管自己的里程碑循环。

Project 的主目录和关联目录会在启动 SDK 时分别绑定为主工作区、额外可写根目录或
只读参考根目录。切换或编辑 Project 会重启并重绑 Host；Web 的 UI 状态只保存
Project 清单和界面偏好，Session history、Goal、checkpoint 和批准授权由
App Server 的 canonical Session/Runtime 所有。若同一 Thread ID 已绑定到另一个
live Project，显式 attach 或 start 会返回 `409`，不会静默把请求路由到错误 workspace。
Fork 也沿用 source Thread 的 Project binding；如果目标 Thread ID 已属于另一个
live Project，分叉请求同样 fail closed 为 `409`。

## 文件分工

```text
app.py                 FastAPI 工厂、生命周期和静态资源
main.py                Uvicorn 启动入口
config.py              环境变量和端口配置
session_manager.py     SDK 进程、连接、审批和网关元数据
routes/agent.py        Turn 与 WebSocket
routes/threads.py      Thread 与 ThreadItem
routes/world.py        World、MCP、Git、Settings、Goal
routes/projects.py     项目元数据
routes/settings.py     网关偏好
```

## 网关开发检查

```bash
uv run ruff check server
uv run pytest tests/test_gateway_api.py -q
```
