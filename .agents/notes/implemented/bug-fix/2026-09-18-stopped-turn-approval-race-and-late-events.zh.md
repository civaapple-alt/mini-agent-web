# 停止 Turn 的审批竞态与迟到事件

状态：implemented  
日期：2026-09-18  
范围：`mini-agent-web` Gateway、Web Studio；`mini-codex` App Server worker

## 结论

停止一个正在等待工具审批的 Turn 时，系统必须先向 App Server 排入
`turn/interrupt`，再释放审批等待。审批结果固定为拒绝。这样可以避免模型在收到拒绝后，
先执行下一步，再处理停止命令。

Studio 不再把 WebSocket `send()` 成功当作服务端已经处理停止请求。待审批场景使用
`POST /api/agent/interrupt` 作为权威停止入口。对已经中断的 Turn，Studio 丢弃迟到的
reasoning、文本增量和工具事件，只保留 `turn_finished` 完成状态收敛。

## 根因

此前 Gateway 先取消审批，再异步发送 `turn/interrupt`。取消审批会唤醒 App Server 的
审批回调。模型可能在停止命令到达前继续生成 reasoning，并发起下一次工具调用。

此前 Studio 的 WebSocket `send()` 只表示浏览器接受了消息帧。它不表示 Gateway 已经处理
该帧。审批等待期间，页面可能先进入“停止中”，而运行时仍停在 `waiting_approval`。

## 实现

- Gateway 的 HTTP 和 WebSocket 停止路径先排入 App Server 中断，再取消当前
  `Project + Thread + Turn` 的待审批项。
- App Server worker 优先处理已排队的控制命令。取消命令会先设置 `RunControl`，再让
  Turn 从审批边界恢复。
- Studio 为停止请求增加 REST API 方法。WebSocket 不可用时，普通停止也回退到该方法。
- Studio 保存最近的中断 Turn ID。迟到的非终态流事件不会重新打开内容或工具卡片。
- 当前已经写入 Session 的内容不删除。修复只阻止新的迟到事件继续污染当前页面投影。

## 验证

| 仓库 | 命令 | 结果 |
| --- | --- | --- |
| `mini-agent-web` | `npm test` | Node 66 passed；Vitest 56 passed |
| `mini-agent-web` | `npm run lint`；`npm run build` | passed |
| `mini-agent-web` | `uv run pytest tests/gateway/test_gateway_agent.py -q` | 18 passed |
| `mini-agent-web` | `uv run ruff check server/routes/agent_ws.py server/routes/agent_turns.py` | passed |
| `mini-codex` | `cargo test -p mini-agent-app-server` | 62 passed |
| `mini-codex` | `cargo clippy -p mini-agent-app-server --all-targets -- -D warnings` | passed |
| `mini-codex` | `python scripts/line_budget.py` | release 35,923 / 40,000，passed |

## 影响

- 审批失效后，模型不会因为审批拒绝而继续进入下一步。
- 停止请求仍是协作式取消。已经发生的工具副作用不会回滚。
- `turn/interrupt` 的成功响应仍只表示停止请求已被接受。`turn_finished` 仍是 Turn
  结算依据。
- 要让修复生效，需要重启使用旧代码的 Gateway 和 App Server，并刷新 Web Studio。
