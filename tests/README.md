# Mini Agent Automated Test Suite (tests)

`tests` 目录包含 `mini-agent-web` 完整的一体化自动化测试套件，覆盖 Python SDK、FastAPI 网关、WebSocket 事件推流、Cookbook 语法校验与核心协议强类型解析。

所有测试设计遵循**确定性与零 LLM Token 消耗（Zero-Cost & Deterministic）**原则，可在本地与 CI/CD 流水线中极速执行。

---

## 📂 测试用例分布

```text
tests/
├── test_cookbook_validation.py  # Cookbook 脚本语法编译与协议兼容性 Smoke Test
├── test_gateway_api.py          # FastAPI Gateway HTTP 路由、WebSocket 事件流与生命周期测试
├── test_sdk_apis.py             # SDK 高级线程管理、Checkpoint 检查点与工作流 API 测试
├── test_sdk_events.py           # 核心协议强类型事件解析与流式过滤测试
└── test_tui_rendering.py        # TUI 流式渲染、工具透明度、失败诊断与结算遥测测试
```

---

## 🧪 测试套件详细说明

### 1. `test_tui_rendering.py` (TUI 渲染与遥测单元测试)
- **工具透明度与错误显式化**：
  - 测试 `tool_finished` 成功状态下的参数、绿色徽章与输出折叠摘要；
  - 测试 `is_error=True` 状态下的红色 ✗ 报错徽章与 `(truncated)` 截断标识；
- **致命失败与异常诊断**：
  - 测试 `run_failed` 结构化原因提取与错误呈现，杜绝无声失败；
- **轮次结算行与遥测**：
  - 测试 `model_responded`、`run_finished`、`turn_finished` 生成的 `Status | Steps | Stop | Tokens` 结算行；
- **斜杠命令与审批安全测试**：
  - 测试 `/status`（包含轮次与 Token 统计）、`/profile`、`/policy`、`/clear-approvals` 及 `_ask_approval_sync`。

### 2. `test_cookbook_validation.py`
- **Cookbook 语法与编译校验**：
  - 自动遍历 `cookbook/python-demo/` 目录下全部 6 个示例脚本（`01_basic_turn.py` ~ `06_protocol_compatibility.py`），使用 Python AST 引擎进行静态编译与语法检查。
- **协议兼容性烟雾测试**：
  - 确定性执行 `06_protocol_compatibility.py`，在无 App Server 进程与无模型 Provider 的情况下，验证 14 种核心生命周期事件的强类型反序列化。

### 2. `test_gateway_api.py`
- **FastAPI HTTP 端点测试**：
  - `/api/health` 健康检查与 App Server 连通性测试；
  - `/api/threads` 线程创建、列出、分叉与读取；
  - `/api/workflows/*` Plan Mode 与 Goal 任务状态查询。
- **WebSocket 实时推流测试**：
  - 测试客户端连接 `/ws/events` 后的握手协商、事件广播与多订阅者并发。

### 3. `test_sdk_apis.py`
- **SDK 核心管理接口测试**：
  - 测试 `fork_thread`、`read_thread`、`resume_thread`、`set_plan_mode` 与 `start_goal`；
  - 校验请求 Payload 结构与 JSON-RPC 2.0 响应映射。

### 4. `test_sdk_events.py`
- **强类型事件反序列化**：
  - 覆盖 `AssistantTextDeltaEvent`、`AssistantReasoningDeltaEvent`、`ToolStartedEvent`、`ToolFinishedEvent`、`ContextCompactionStartedEvent`、`ContextCompactionFinishedEvent`、`TurnFinishedEvent`、`RunFinishedEvent` 与 `GenericEvent`；
- **流式事件过滤器**：
  - 验证 `stream_turn` 按 `thread_id` 与 `turn_id` 进行精确事件路由。

---

## 🚀 运行测试

### 1. 运行全量测试套件
```bash
# 详细输出模式
uv run pytest tests/ -v

# 静默快速模式
uv run pytest -q
```

### 2. 运行指定测试文件
```bash
# 仅测试 SDK 事件系统
uv run pytest tests/test_sdk_events.py -v

# 仅测试 FastAPI 网关与 WebSocket
uv run pytest tests/test_gateway_api.py -v

# 仅测试 Cookbook 静态合规
uv run pytest tests/test_cookbook_validation.py -v
```

### 3. 结合代码风格检查 (Linter & Formatter)
```bash
# 代码静态分析与规范校验
uv run ruff check .

# 自动修复可修复的格式与导入排序
uv run ruff check --fix .
```
