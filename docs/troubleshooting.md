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
