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

---

## 2. 运行 Tier 2 全栈真实 LLM 冒烟测试

需本地配置合法模型凭证（位于 `~/.mini-agent/.env`）：

```bash
uv run python scripts/full_stack_smoke_test.py
```

执行完成后会自动在 `reports/` 目录下生成包含当前 App Server 版本、Git Commit ID、执行耗时与各测试项状态的详尽 Markdown 报告。
