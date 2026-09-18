# 故障排查指南 (Troubleshooting)

本文档整理了在运行、调试 `mini-agent-web`（包含 SDK、FastAPI 网关、Web Studio 与 TUI）过程中可能遇到的常见故障与解决方案。

---

## 1. 找不到 App Server 可执行文件 (App Server Not Found)

### 现象
- 启动网关或 SDK 时抛出 `FileNotFoundError: mini-agent-app-server not found`；
- Web Studio 页面提示 `Disconnected from App Server`。

### 排查与解决
1. **检查全局 PATH**：在终端运行 `mini-agent-app-server --version`。如果提示命令不存在，说明二进制文件未编译或未加入环境变量；
2. **本地编译**：在 `mini-codex` 目录下执行编译：
   ```bash
   cargo build -p mini-agent-app-server --release
   ```
3. **显式配置路径**：在 `.env` 文件中设置绝对路径：
   ```env
   # Windows:
   MINI_AGENT_APP_SERVER_PATH=D:\gh-ws\codex-ws\mini-codex\target\release\mini-agent-app-server.exe
   
   # Linux / macOS:
   MINI_AGENT_APP_SERVER_PATH=/path/to/mini-codex/target/release/mini-agent-app-server
   ```

---

## 2. 网关端口冲突 (Address Already in Use)

### 现象
启动服务时报错：`OSError: [Errno 48] Address already in use` 或 `[WinError 10048]`。

### 排查与解决
1. **查看占用进程**：
   ```powershell
   # Windows PowerShell:
   Get-NetTCPConnection -LocalPort 8000
   
   # Linux / macOS:
   lsof -i :8000
   ```
2. **释放端口或修改配置**：
   - 终止残留的 Python 进程；
   - 或在启动命令中指定新端口：`uv run python -m server.main --port 8001`。

---

## 3. Web Studio WebSocket 连接断开或失败

### 现象
浏览器界面右上角显示“已断开”红点，或反复弹出连接重试的 Toast 通知。

### 排查与解决
1. **验证网关健康状态**：在浏览器访问 `http://127.0.0.1:8000/api/health`，确保返回 `{"status": "ok"}`；
2. **检查前端反向代理**：确认 `frontend/vite.config.js` 中的 proxy 配置正确映射了 `/api` 与 `/ws` 到网关端口；
3. **查看终端日志**：检查网关控制台是否有反序列化异常或 App Server 退出日志。

### Turn 失败后仍显示“运行中”

网关现在会把流式 Turn 异常作为终态事件发送，Studio 会清理生成中、活动 Turn 和待审批状态。如果使用旧版本在纠偏期间中断过 Turn，导致历史中残留未结算的工具调用，请重启绑定该项目的 App Server 后重新发送；Core 会在恢复或下一轮开始前修复这类历史。若 Session 仍被其他进程持有，先等待该进程结束，再重新 attach。

`run_failed` 和 `run_finished` 是运行级诊断事件，`turn_finished` 才是本轮持久化后的权威终态。模型请求、传输或上下文错误会从已结算的 Session 回读并显示在状态条中；因此“本轮执行失败”不再等同于步数上限。若需要判断是谁发起了中断，查看浏览器控制台的 `[Studio][turn-control]` 记录，以及网关日志中的 `source` 字段（例如 `composer-stop`、`clear-chat` 或 `queue-steer`）。

### 停止后重启，Session 无法加载

如果点击“停止”后长时间显示“停止中”，随后重启 Web Studio 发现原会话无法打开，
先不要删除 `~/.mini-agent/sessions` 下的目录。常见原因是本轮生成了较大的 checkpoint：
旧版本的 Gateway 会把超过 8 MB 的 Session 隐藏，SDK 也可能因 JSONL 行缓冲过小而失去
App Server 连接；重启期间这可能进一步留下一个指向空历史的新 Session。

更新 Gateway/SDK 后重启 Gateway 即可恢复：Session catalog 现在与 App Server 的 32 MB
边界一致，并对大 checkpoint 做有界投影；如果 thread index 指向空的重启 Session，
会优先恢复同一 Thread 中已有历史的旧 Session。SDK 读管道失败时也会回收失联的
App Server，避免停止、恢复或下一次请求继续等待一个已关闭的管道。恢复后的会话可能标记
`history_truncated=true`，这表示展示层只保留了有界预览，原始 Session 日志仍由 App Server
负责读取。若旧 Session 仍被其他进程锁定，页面会保持只读，需等待锁释放后再 attach。

### 长时间思考内容没有显示最新位置

ThinkingBlock 超过可视高度后会使用内部滚动区域。只要用户没有手动向上滚动，
新到达的 reasoning 内容会自动跟随到底部；如果用户向上查看旧内容，自动跟随会暂停，
滚动回底部后恢复。外层聊天区的“回到底部”按钮只控制消息列表，不替代 ThinkingBlock
内部滚动。

### 信息流中的思考和工具内容过多

Web Studio 将模型回答作为消息流的主内容。已完成的思考默认收起，执行中的思考仍会显示
有界的实时内容。点击“思考”标题可以查看完整内容。

工具卡片在关闭时只显示工具名、参数摘要和状态。工具有返回内容时，点击标题行中的
“查看输出”即可展开完整结果；展开后仍可以复制输出。`read_file` 的结果默认不再自动展开，
但文件路径和请求的行范围会保留在卡片标题中。审批等待、工具失败和中断结果仍保持醒目，
便于判断是否需要处理。

---

## 4. 大模型调用凭证丢失或鉴权失败 (401 Unauthorized)

### 现象
提交 Turn 后模型立即报错退出，或 TUI 显示 `run_failed: Provider credentials missing`。

### 排查与解决
1. **检查 `.env` 文件**：确保在工作区根目录下创建了 `.env`，并且配置了 `OPENAI_API_KEY` 与 `OPENAI_MODEL`；
2. **自定义服务商配置**：如使用 DeepSeek、通义千问或 SiliconFlow，请同时配置 `OPENAI_BASE_URL`：
   ```env
   OPENAI_BASE_URL=https://api.deepseek.com/v1
   OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
   OPENAI_MODEL=deepseek-chat
   ```

---

## 5. 工具调用等待卡死 (Tool Approval Hang)

### 现象
Turn 发送后，流式输出了部分思考链，随后一直停留在某个工具调用状态不再继续。

### 排查与解决
- **等待用户审批**：敏感工具（如 `shell`、`apply_patch`）默认必须经过安全审批：
  - 在 Web Studio 中，请查看输入栏底部的审批悬浮 Dock，点击“允许”或“拒绝”；
  - 在 TUI 中，控制台会弹出 `[y]es / [n]o / [a]lways` 的选项提示；
  - 在自动化测试或无头脚本中，请提供自定义 `approval_handler` 或使用默认的自动放行策略。
- **信任执行仍出现审批**：`trusted` 是低打断模式，不是无条件 allow-all。普通工作区操作和
  普通 Shell 会自动执行；递归/强制删除、破坏性 Git、系统级命令、MCP、工作区外 `read_image`
  以及命中 Security Deny 的操作仍会请求审批或直接拒绝。对 `blender-intro` 这类持续维护任务，通常选择
  `full_machine + trusted`，只有识别出的危险边界需要人工确认。
- **审批期间点击停止**：停止后审批 Dock 会显示“审批已锁定”，所有审批按钮暂时不可用。
  网关先向 App Server 排入 `turn/interrupt`，再将该 Turn 的待审批项明确记为拒绝。
  这个顺序可以避免审批拒绝让模型继续执行下一步。Studio 会等待当前 Turn 的终态事件，
  并丢弃同一 Turn 的迟到内容事件。此时不要重复点击审批。若页面仍停留在“停止中”，
  先确认 Gateway 日志中有对应 `turnId` 的停止请求，再刷新页面让 Studio 通过运行状态和
  事件回放完成核对。
- **同一轮出现多个审批**：工具审批按 `Project + Thread + Turn + call_id` 区分，页面一次展示
  一个待处理项并在标题显示队列数量，完成当前项后自动展示下一项。`requestId` 是传输标识，
  不能在多个待审批项之间单独使用；如果外部客户端没有提供 `call_id` 且 request ID 重复，
  网关会拒绝这次有歧义的响应，避免误放行另一条工具调用。
- **审批证据与完整命令**：`approval-evidence.jsonl` 保持有界，只记录审批类型、`call_id`、
  `session_item_id`、策略和哈希。需要核对完整命令时，用 `session_item_id`/`call_id` 关联同一
  Thread 的 Session 日志；不要把完整命令复制进审批 trace，也不要仅凭 `action_summary` 还原
  命令。Turn 在中断或运行时断开前未提交 Session item 时，trace 可能没有可关联的完整命令，
  这属于有意保留的证据边界。

### 执行策略切换

- 空闲时可以在 Web Studio 输入栏切换访问范围或批准策略；变更写入当前 Project，
  不会重启运行时，也不会清空会话历史。
- 如果当前 Turn 仍在生成，策略切换会被暂缓并提示“本轮结束后重试”；请等待 Turn
  结算后再次选择。不要用“停止”按钮代替策略切换，因为停止会主动中断本轮。
- 如果旧版本在策略切换后显示“本轮已中断”，请更新 Gateway/Studio 到包含本次修复的
  版本，并重新启动 Gateway；之后只有 Project/Workspace 重绑或显式撤销授权才会重启运行时。

### `read_file` 分段结果没有显示

`read_file` 支持使用 `offset`（从 0 开始的行偏移）和 `limit`（最多读取的行数）读取
文件的一页。完成后的卡片默认收起，但会在文件名后显示实际请求的 1-based 行范围；点击
“查看输出”后可以读取结果，结果头中的 `next_offset` 可直接用于读取下一页。若看不到
“查看输出”，请确认工具事件包含 `output`、`result` 或 `content` 返回字段，并确认页面已
更新到当前版本的 Web Studio。

### Goal 运行与控制

- `/plan` 单独输入会切换 Plan Mode；也可以直接输入 `/plan 任务`，Studio 会先开启
  Plan Mode，再把任务发送到当前会话。当前 Turn 运行时不能切换 Plan Mode，请等待本轮结算。
- 从斜杠菜单选择 `/goal` 只会把 `/goal ` 填入输入框；输入目标后再按 Enter 才会创建 Goal。
- 信息流中的 Goal 卡片是内部自治 turn 的用户可见投影；`Autonomous Goal Mode is active...`
  这类完整提示不会作为普通用户消息重复显示。
- Goal 的 `goal/plan.md` 是 Session 已创建的受控文件。应使用相对别名读取，并用
  `*** Update File: goal/plan.md` 更新，不能用 `*** Add File`；`prompt_context.json`、绝对
  `~/.mini-agent/sessions/...` 路径以及包含 `..` 的逃逸路径均属于内部或越界路径，不应读取。
- 活动 Goal 点击“暂停”时，网关只提交 `status=paused` 的安全状态变更，然后当前 turn 在安全边界
  结算；如果仍看到 `thread already has an active turn`，请确认网关和 App Server 已使用本次修复后的版本。
- Goal 进入 Verify 后，当前 Thread 顶部和信息流会显示 `Verify 进行中`、`Verify 已完成`
  或 `Verify 失败`；规划与目标侧栏会同步显示里程碑、循环次数、错误原因，并提供
  `goal/plan.md` 和 `goal/verifier_verdict.md` 的实时内容。
- 如果 `/api/workflows/state?thread_id=...` 曾因 `thread/goal/get` 超时返回 500，刷新或重启
  网关后会优先读取 SessionStore 的有界状态投影；超大的历史 checkpoint 会被标记为截断，
  但 Goal 状态和验证 Markdown 仍可读取。若仍返回 503，请先确认对应 App Server 进程已退出或可恢复。
- 如果进程在 `turn_started` 后异常退出，侧栏会将该 Session 显示为“可恢复”，而不是继续显示
  “运行中”；确认对应 Session 的锁已释放后即可重新 attach。Plan Mode 在已完成规划 Turn 后的
  “开始实施”确认也会随 Session-owned `plan_mode.json` 恢复。

---

## 6. Windows 下 Shell 工具报错或找不到 `pwsh`

### 现象
执行 `shell` 工具时提示找不到命令或子进程异常退出。

### 排查与解决
Mini Agent 默认使用跨平台且现代的 **PowerShell 7 (`pwsh`)**。
1. 请确保已安装 PowerShell 7，并将其加入系统 PATH；
2. 在终端运行 `pwsh --version` 进行确认。

---

## 7. 历史 Session 显示为只读或无法立即恢复

### 现象
- 侧栏可以看到 Session，但提示“正在另一个进程运行”；
- 已暂停 Goal 显示在历史列表中，点击后没有立即开始新一轮执行。

### 处理方式
- 被其他 App Server 持有锁的 Session 仍可读取 canonical history，但不能被第二个
  进程同时 attach；等待原进程结束后重新选择该 Session；
- 已暂停 Session 的 attach 只恢复运行时连接，不会自动执行新 Turn；发送下一条消息
  或恢复 Goal 后才会继续推进；
- 如果仍然无法恢复，先刷新 Web Studio，再检查对应 Project 的 SessionStore 和
  App Server 日志，避免删除 Session 文件来绕过锁。

### 查看实际 Session ID

Web Studio 的会话标题是可编辑的展示名称，不等同于磁盘上的 SessionStore
身份。当前会话的 Header 会在标题下显示 `Session <session_id>`，项目会话树也会
显示同一个 ID；鼠标悬停可以查看完整值。需要区分同一 Project/Thread 下的恢复、
锁定或重复目录时，以这个 canonical `session_id` 和 Session 日志为准，Thread ID
仍然只负责逻辑路由。

## 8. 侧栏出现多个“运行中”或上下文压缩记录连续出现

侧栏的“运行中”只由当前 Project 中是否存在尚未结算的活跃 Turn 决定；SessionStore
进程锁是独立的“在线/待命”状态。空闲但在线的进程不会再被当成运行中的 Turn，崩溃后
留下的未结算记录则显示为可恢复并保留诊断状态。多个项目即使使用同名 `default`
Thread，也不会互相贡献运行状态；若仍异常，请检查请求和 WebSocket 是否携带了正确的
`project_id`。

连续的 Compaction 生命周期会按相邻顺序合并为“上下文压缩 ×N”。展开卡片可查看每条
记录的 `turn_id` 与 `item_id`；这表示一次运行中的多次压缩被聚合展示，不是启动了多个
Agent 或多个 Turn。

## 9. 切换 Session 后仍看到旧历史或旧项目状态

会话目录、历史、Workflow、Runtime 和 SidePanel 文件请求都绑定 `project_id`，并受
request epoch/取消机制保护。切换、创建、Fork 或关闭 Session 时，Studio 会原子清空
旧的消息和状态投影，再加载新 Session；失效请求的晚到响应会被丢弃。

如果页面仍混入旧内容，请在浏览器 Network/WS 面板确认请求 URL、payload 和 WebSocket
`ping` 都使用当前项目；随后刷新并查看 Gateway 是否记录了旧 epoch 响应被忽略。不要通过
删除 Session 文件解决显示问题。

## 10. 多项目、多会话运行与实时切换

Web Studio 支持同一项目下的多个不同会话，以及多个项目下的会话同时运行。切换项目
或会话只改变当前查看和请求路由，不会停止其他项目的后台 Turn；同一个
`project_id` + `thread_id` 仍然只允许一个 active Turn。

侧栏状态来自有界的会话 catalog：运行中的会话显示“运行中”，成功结算显示“已完成”，
失败、中断、步数上限、暂停和可恢复状态分别显示。项目行的“活跃”数量也会随 catalog
刷新，而不是只使用项目创建时的静态计数。

点击正在运行的会话时，Studio 会先载入快照，再按事件序号回放遗漏事件，最后继续接收
当前会话的 WebSocket 流。若事件已过期或出现缺口，页面会提示“事件回放存在缺口”，
并以 canonical history 对账；缺失的中间增量不会被伪装成完整流。

若会话由其他进程持有 Session 锁，Studio 会以“只读查看”打开：可以查看历史和最终状态，
但不能发送消息、纠偏、打断或处理该进程的审批。等待锁释放后重新选择会话即可恢复控制。

访问范围和批准策略属于 Project 级配置；同一 Project 下的多个空闲运行时 Client 会
一起接收更新，其他 Project 不受影响。推进方式（`manual`/`continuous`）、Plan 状态
和内置工具属于 Thread/Session 级配置，同一 Project 下的不同会话也不会互相覆盖。
若该 Project 中已有 active Turn，策略或访问范围变更会被拒绝，请等待所有相关 Turn
结算后再修改。

后台会话遇到工具审批时，Turn 会保持等待，审批请求会携带 Project、Thread 和 Turn
身份。切换到其他会话后，审批卡片会隐藏；重新选中原会话时，Studio 会从审批快照恢复
卡片。只有当前会话对应的审批可以操作，身份不匹配的响应会被网关拒绝。审批默认最多
等待 600 秒，超时后自动拒绝。

如果同一个 Session 同时在多个浏览器中打开，审批卡片会同步显示在同 Project 的
客户端中。只有第一个通过身份和 grant scope 校验的响应生效；其他浏览器的旧卡片会
在收到 `approval.phase=resolved` 后关闭，并提示审批可能已由其他浏览器处理或已经失效。
如果响应恰好与停止、超时或运行时断开竞争，审批以拒绝处理；若网关连接断开后重新
打开页面，Studio 会通过审批快照再次核对，避免误把旧卡片当成可执行授权。

如果在审批 Dock 出现时点击“停止”，Gateway 会先向 App Server 排入 `turn/interrupt`，
再撤销该 Project/Thread/Turn 下的所有待审批项。原审批 Future 会以拒绝结束，之后到达的
同一 Turn 审批也会被拒绝，因此停止后再点击“允许”不能放行工具。App Server worker 会
优先处理已排队的停止命令，避免审批拒绝让模型进入下一步。界面会暂时显示“停止中”，
直到收到权威的 `turn_finished`。如果 App Server 没有接受中断，Studio 会恢复“停止”按钮
并提示重试，不会把仍在远端运行的 Turn 误报成已完成。Studio 还会丢弃已中断 Turn 的迟到
reasoning、文本和工具事件，但保留终态事件用于清理界面。已经持久化的历史内容不会被这条
规则删除。

Plan Mode 的“关闭 Plan Mode”是当前 Thread 的控制面操作，不会创建新的 Turn。空闲时
App Server 会执行计划工作区清理、清除 living plan 并恢复普通系统提示；清理失败时接口
返回错误，前端重新读取状态，Plan Mode 保持开启，避免出现“界面已关闭但运行时仍是规划态”。
正在运行或等待工具审批时关闭 Plan Mode 会被拒绝（HTTP 409）；请先等待本轮结算，或先
停止本轮并等到 `turn_finished` 后再关闭。关闭后若要继续实施，应在普通模式下发送新的
消息；Plan 规划完成后的“开始实施”按钮也遵循同一结算边界。

### 运行中断、断线与异常恢复

- 浏览器标签页、WebSocket 或网络短暂断开时，网关不会取消已经提交的 Turn；运行中的
  流任务仍由网关负责消费，重新连接后会通过 Session catalog、Runtime 状态和有界事件
  回放恢复界面。只有用户明确点击“停止”、网关主动重启或进程退出，才会结束运行。
- App Server 意外退出或传输读取异常时，SDK 会让所有等待中的流和请求收到明确的连接
  错误，不会无限停在“生成中”；如果当时正等待工具审批，网关会立即取消该审批并按
  拒绝处理。SessionStore 没有锁且 Turn 未结算时，侧栏会显示“可恢复”；待进程锁释放
  后重新 attach，再从 canonical history 对账。
- 同一个 `project_id + thread_id` 同时提交第二个 Turn 会被视为独立失败请求；它的错误
  不会清理第一个仍在运行的 Turn。不同项目或不同 Thread 的运行状态、审批和控制请求
  按完整身份隔离。
- `thread/fork` 和 `session/fork` 都按 App Server worker 的命令顺序与当前 Turn 竞争：运行中
  直接返回 busy，不复制未结算的消息、工具或审批；停止请求只在安全边界生效，之后再派生
  才能看到已提交的 settled checkpoint。`attach` 若复用本 Gateway 的 Client，会返回当前
  active Turn 标识并继续观察同一运行；若 Session 由其他进程持锁，则保持只读，不创建第二个
  writer。
- `session/fork` 的重试应保持相同的 source Thread、child Thread ID 和 `context_policy`。
  相同请求会复用已有 child Session；如果 child 已经按另一种压缩策略创建，Gateway 返回
  HTTP 409，detail 中的 `code` 为 `-32001`、`data.kind` 为 `contextPolicy`，不能通过
  重试改变 child 的上下文。跨进程和本地已绑定 child 的这两条路径使用同一错误契约。
- 网关关闭时会先关闭 WebSocket、取消待审批请求和流任务，再停止各项目的 App Server
  Client。已发出的工具副作用不能被网关回滚；需要依赖工具自身的幂等性或 SessionStore
  的恢复边界。
