# Verification and Utility Scripts

本目录包含 mini-agent-web 的全栈与端到端验证脚本。

## 脚本清单

| 脚本 | 用途 | 依赖 |
| --- | --- | --- |
| ull_stack_smoke_test.py | 全栈 7 阶段全量端到端冒烟测试（Diagnostics、Turn Streaming、Tool Calling、Approval、Plan Mode、Goal Runtime、FastAPI Gateway & WebSocket） | Live LLM API 凭证 (~/.mini-agent/.env)、mini-agent-app-server 二进制 |

## 运行方式

从项目根目录执行：

`ash
uv run python scripts/full_stack_smoke_test.py
`

执行时脚本会自动查找：
1. ~/.mini-agent/.env 中的 LLM 配置（默认使用 DeepSeek 系列模型）；
2. 自动定位同级 mini-codex 目录中最新编译的 mini-agent-app-server 可执行文件；
3. 执行真实的 REST 与全双工 WebSocket 网络通信，完成全部阶段验证并输出格式化摘要。
