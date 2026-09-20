# Smoke Tests (冒烟测试规范)

本目录与 `scripts/` 共同构成 `mini-agent-web` 的端到端冒烟测试体系。

---

## 两级冒烟策略 (Two-Tier Smoke Strategy)

| 级别 | 执行形式 | 依赖条件 | 验证范围 | 触发时机 |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1: 离线架构级冒烟** | `uv run pytest tests/smoke/ -q` | 零依赖 / 无 Token / 无 Provider | Gateway + Client + WebSocket + 消息聚合全链路流转 | 日常提交、PR、CI 流水线 |
| **Tier 2: 全栈真实 LLM 冒烟** | `uv run python scripts/full_stack_smoke_test.py` | 需 `~/.mini-agent/.env` 真实模型凭据 | 真实 LLM API 调用、工具执行、磁盘持久化、生成带版本号与 Commit 记录的测试报告 | 发版准入、功能重大升级 |

---

## 1. 运行 Tier 1 离线冒烟测试

无需任何外部服务或 API Key：

```bash
uv run pytest tests/smoke/ -q
```

该测试会在进程内模拟 App Server 闭环，串联验证：
- FastAPI Web Gateway 启动与状态探测；
- WebSocket `/ws/agent` 双向握手；
- 模拟 Prompt 提交、流式 Chunk、ThreadItem 生命周期与最终结算；
- 线程历史投影完整性校验。

### 子代理报告跨仓场景

`test_child_agent_report_scenario.py` 使用真实 SDK 和本地 App Server 子进程，验证
父 Session fork 出子任务后，`task_report` 的 `tool_finished` 事件经 Gateway 写入
子 Session、触发空闲父会话续行，并从 `/children` 还原报告投影。场景还验证重复
报告幂等和过期 attempt 被拒绝。它只替换父续行的模型入口，不发送模型请求；App
Server 和 Gateway 的会话、JSON-RPC、持久化及投影路径均真实运行。

同一文件中的 completed-child assign 场景使用 JSONL Session fixture 提供已完成的
child operation，再验证 Gateway 通过真实 `child/task` RPC 分配后续 attempt、App
Server 持久化 `follow_up` 轮次；随后重启同一 child Session，由真实队列调度恢复该
attempt 并在原 child Thread 启动。测试只拦截终端 `turn/start`，不调用模型。

先从 `mini-codex` 构建当前 App Server：

```powershell
cargo build -p mini-agent-app-server
```

再从 `mini-agent-web` 在 PowerShell 显式设置二进制路径并运行：

```powershell
$env:MINI_AGENT_APP_SERVER_PATH = "..\mini-codex\target\debug\mini-agent-app-server.exe"
uv run pytest tests/smoke/test_child_agent_report_scenario.py -q
```

没有配置可执行文件时该场景会跳过；默认测试不启动真实 App Server。

---

## 2. 运行 Tier 2 全栈真实 LLM 冒烟测试

需本地配置合法模型凭证（位于 `~/.mini-agent/.env`）：

```bash
uv run python scripts/full_stack_smoke_test.py
```

执行完成后会自动在 `reports/` 目录下生成包含当前 App Server 版本、Git Commit ID、执行耗时与各测试项状态的详尽 Markdown 报告。
