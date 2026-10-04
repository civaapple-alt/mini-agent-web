# Verification and Utility Scripts

本目录包含 `mini-agent-web` 的端到端验证脚本。

## 脚本清单

| 脚本 | 用途 | 依赖 |
| --- | --- | --- |
| `full_stack_smoke_test.py` | 真实 Provider 下的 REST、WebSocket、审批、Plan、Goal 和工具调用全栈冒烟 | Provider 凭证和 Harness App Server 二进制 |

## 运行方式

从项目根目录执行：

```bash
uv run python scripts/full_stack_smoke_test.py
```

执行时脚本会从 `~/.mini-agent/.env` 读取 LLM 配置，并自动定位同级
`mini-agent-harness` 目录中编译的 `mini-agent-app-server`。也可以通过
`MINI_AGENT_APP_SERVER_PATH` 指定二进制路径。该脚本会调用真实 Provider 并可能产生费用。
