# Child Session operation、恢复与 Session notebook

- status: implemented
- date: 2026-09-17

## 决策

WebStudio 使用独立的 App Server client 和独立 Session/runtime 承载 child
Turn。Gateway 不在内存中复制 child history、授权或生命周期状态。Child 的
lineage、operation 记录和最终结果来自 Mini Agent SessionStore。

父模型发出 `delegate_task` 的真实 `tool_started` 事件后，SessionManager 触发
正常的 exact fork 和 child `turn/start`。这个观察动作不会在 Gateway 增加一套
调度器。Child 最多一层，每个父 Thread 同时最多两个 active children。

`GET /children` 从 canonical Session catalog 和 live runtime projection 组合
有界状态。`cancel` 调用 child 的标准 `turn/interrupt`，`retry` 使用相同
operation ID 和递增 attempt 创建新的 child Turn。Gateway 重启后仍可从
`session.jsonl` 的 operation 记录恢复 `queued`、`running`、
`awaiting_approval`、`completed`、`failed` 和 `cancelled` 状态。

Session notebook 由 Mini Agent 持久化。WebStudio 只通过
`GET /api/threads/{thread_id}/notebook` 读取投影，不建立内容缓存。运行时只
恢复有界摘要，完整内容仍由 Host 工具按需访问。

## 相关接口

- `POST /api/threads/{thread_id}/children`
- `GET /api/threads/{thread_id}/children`
- `POST /api/threads/{thread_id}/children/{child_thread_id}/cancel`
- `POST /api/threads/{thread_id}/children/{child_thread_id}/retry`
- `GET /api/threads/{thread_id}/notebook`

## 验证

- `uv run pytest -q`
- `uv run ruff check .`
- `cd frontend && npm test`
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
