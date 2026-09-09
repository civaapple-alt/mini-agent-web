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

### Goal 运行与控制

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
