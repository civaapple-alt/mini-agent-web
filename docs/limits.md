# Mini Agent Web & SDK 运行时边界与硬限制 (Limits)

本文档定义了 `mini-agent-web`（包含 Python SDK、FastAPI 网关、Web Studio 前端及终端 TUI）各层级的显式硬边界与安全限制。遵循 Mini Agent 零无界输入（Bounded Surface）纪律，杜绝无限制内存膨胀与阻塞。

---

## 1. 客户端与协议核心边界一览

| 边界维度 | 默认限制 | 超限行为与处理策略 |
| :--- | :---: | :--- |
| **单次用户输入 (Prompt Input)** | **32 KiB** | 输入框与网关直接拦截并抛出错误，拒绝将超限 Payload 注入 Stdio 管道 |
| **粘贴文本附件** | **每个 128 KiB，最多 4 个** | 多行、较长或明显日志格式的粘贴内容转为临时文本附件；正文写入 Gateway 会话附件目录，模型按需读取 |
| **文件附件** | **每个 8 MiB，最多 16 个** | 无可用物理路径的普通文件作为有界内容附件；复制或拖入的文件夹只记录物理路径，不复制或展开目录 |
| **单次实时纠偏 (Steer Input)** | **16 KiB** | 前端与 SDK 校验长度，超限拒绝发送并提示原因 |
| **单条工具返回结果预览** | **16 KiB** | `ToolCard` 与 TUI 保留 UTF-8 安全的首尾截断预览，避免撑爆 DOM / 控制台 |
| **单轮模型流式文本输出** | **64 KiB** | 流式规约器持续追踪字节数，超限时触发截断告警并结束当前块聚合 |
| **内置基础工具集** | **4 种默认工具** | 默认暴露 `read_file`、`apply_patch`、`shell`、`read_image`；`web_fetch` 仅作为显式扩展，`write_file`、`edit_file` 已移除 |
| **管理接口请求超时** | **30 秒** | `initialize`、`thread/start`、`thread/settings/update` 等控制面 RPC 30 秒超时熔断 |
| **SDK JSON-RPC 请求超时** | **30 秒** | 单次 Stdio 请求/响应超时后清理 pending request，并抛出 `ServerProcessError` |
| **Goal 自治循环上限** | **100 loops** | 运行时安全护栏；达到上限后标记为 `usageLimited` 并结算退出 |
| **Goal 单个里程碑步数上限** | **200 steps** | 运行时安全护栏；达到上限后结束当前里程碑并进入受控结算 |
| **Goal 单个里程碑墙上时钟** | **1800 秒** | 触发协作式取消（`turn/interrupt`）并标记为超时结算 |
| **WebSocket 帧与缓冲区** | **1 MiB** | 超出单帧大小的异常报文直接拒绝解析并断开异常连接 |

---

## 2. 前端 Web Studio 渲染与状态边界

### 2.1 消息流与 DOM 保护
- **结构化聚合（Blocks）**：前端采用 `messageState.js` 将原始细碎的字符级 Delta 聚合成结构化的 Thinking 块、Markdown 文本块与 Tool 卡片，防止高频触发 React Virtual DOM 重绘；
- **思考链截断与折叠**：`ThinkingBlock` 默认折叠，实时显示耗时与字符数，单次思考链文本展示上限为 64 KiB；
- **图片上传与 Lightbox**：工作区图片读取（`read_image`）经由网关受控暴露，前端单张图片预览分辨率自适应适配视窗，杜绝内存溢出；大段剪贴板文本不会直接填满输入框，而是作为有界临时文本附件提交。

### 2.2 工作区与会话列表
- **会话历史检索**：会话搜索在前端进行亚毫秒级模糊过滤，历史会话加载采用异步渐进骨架屏（Skeleton Loading）；
- **SessionStore 投影**：网关最多读取 128 个 Session；单个 `session.jsonl` 最大 32 MiB，与 App Server SessionStore 对齐，单条 Gateway 记录预览最大 64 KiB；超大 checkpoint 只保留有界投影；历史、运行中和已暂停 Session 均通过 canonical projection 展示；侧栏将 `turn_active` 与 `process_online` 分开投影，并保留 `last_turn_status` 诊断；完成 Plan Turn 后的 `plan_review_pending` 从 Session-owned `plan_mode.json` 恢复；Thread 的 `manual` / `continuous` 偏好从带 Thread ID 的 `thread_settings.json` sidecar 读取，网关不再保存第二份 continuation 状态；
- **Session 切换**：历史或已暂停 Session 可通过 `/api/threads/{thread_id}/attach` 恢复；被其他 App Server 持有锁的运行中 Session 只读展示，锁释放后再 attach；“派生独立分支”只复制最近一次已结算 checkpoint，默认精确快照，不在 fork 时触发模型压缩；显式 `contextPolicy=compact` 才压缩 child，并创建新的 SessionStore 和 App Server client，返回父子 Session lineage 与有界大小指标；切换、创建、Fork、关闭或项目切换会通过 request epoch/取消机制丢弃晚到响应；
- **工作区项目管理**：支持多项目并行固定（Pin），系统目录选择器受限于宿主操作系统权限。

### 2.3 访问范围、批准与工作流
- **访问范围**：`project` 限定在当前 Project 的主目录及关联目录；`full_machine` 只扩大路径范围到整机，不等于全部 Allow，Deny、Plan 模式下的源文件变更锁和高风险动作确认仍有效；Shell 仍按所选审批策略执行，Plan 不额外施加只读限制；
- **审批策略**：`interactive` 每个敏感动作交互确认；`automatic` 只自动放行受限低风险检查；`trusted` 自动放行经过工具自身校验的普通工作区操作和普通 Shell，递归/强制删除、破坏性 Git、系统级命令、MCP、工作区外 `read_image` 和安全 Deny 规则仍需确认或拒绝；
- **策略切换边界**：`/api/world/execution` 通过现有 App Server 动态更新 Project 的访问范围和审批策略，不重启运行时；活动 Turn 期间不接受这类控制面变更，Web Studio 会提示本轮结算后重试。运行时重启仅用于 Project/Workspace 重绑或显式撤销批准授权等生命周期操作；
- **推进方式**：普通 Chat 默认 `manual`，每轮最多 8 步；显式选择 `continuous` 后使用连续循环，但仍受取消、超时和上下文边界约束；该偏好由 App Server/SessionStore 持久化，Gateway 只在启动和 Goal settlement 时转发恢复请求；活动 Goal 使用独立的 Goal Runtime 里程碑预算，不继承或覆盖普通 Chat 设置；
- **批准策略与授权**：Project 的 `policy` 为 `interactive` / `automatic` / `trusted`；审批响应的 `grantScope` 只有 `once` / `session` / `project`。Web 只展示和转发 pending request，action key、grant store、撤销与恢复由 Host/Capabilities 持有；`automatic` 只自动放行受限、只读且路径位于工作区或配置读取根内的 Shell 检查；`trusted` 额外放行完整校验的普通工作区操作和普通 Shell，递归/强制删除、破坏性 Git、系统级命令、MCP、工作区外 `read_image` 和安全 Deny 规则仍需显式审批或拒绝。
- **Goal 顶部控制**：活动 Goal 在当前 Thread 顶部显示，支持暂停、恢复、更新和删除；Goal 状态由 App Server canonical state 提供，页面刷新或切换 Session 后重新读取。

---

## 3. Python SDK 与网关传输边界

### 3.1 零外部依赖传输保障
- SDK 仅依赖 Python 3.10+ 标准库（`asyncio`, `json`, `subprocess`），使用 Stdio 行缓冲读取，单行 JSONL 读取缓冲区上限设为 **2 MiB**；该上限覆盖 App Server 512 KiB Session record 与 JSON-RPC envelope，同时保留超大输出的 fail-closed 边界；
- 收到超出协议规范的超大行或格式错误帧时，SDK 记录错误日志并跳过解析，避免主读循环挂起。

### 3.2 动态 Steering 与 Interrupt 竞态边界
- 运行时纠偏（`turn/steer`）仅在当前 Turn 处于活动生成状态时允许下发；
- 协作中断（`turn/interrupt`）采用幂等设计，如果 Turn 已在此前完成结算，服务端安全返回无害结果，不抛出异常。
