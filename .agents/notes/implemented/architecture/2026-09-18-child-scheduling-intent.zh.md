# Child 调度意图按分派决定

- status: implemented
- date: 2026-09-18

## 决策

项目或全局配置只控制 `subagent.max_concurrent_children`，默认 `2`，范围为
`1..=8`。`execution_mode` 不再作为静态配置，而由 Main Thread 在每次
`delegate_task` 或 Child 创建请求中决定：

- `parallel`：任务相互独立时并发占用可用槽位；
- `sequential`：同一 `group_id` 中按 `sequence` 排队；
- Host 负责校验、限流、排队和持久化实际 operation 元数据；
- 没有该字段的旧请求兼容回退为 `parallel`。

`delegate_task` 现在把 `execution_mode`、`group_id` 和 `sequence` 作为可选的
有界调度元数据交给 Gateway。Gateway 不从项目配置推断任务模式，也不在 Core 中
增加 Scheduler。

## 影响

- `/api/settings` 和项目配置不再保存 `default_execution_mode`；
- `GET` Child projection 继续展示实际 operation 的执行模式；
- 重试沿用已持久化 operation 的模式，不重新读取项目默认值；
- 项目设置变化只影响新的并发接纳，不改变已经运行的 Child。

## 验证

- Gateway/SessionManager 回归测试覆盖每次分派携带顺序组、序号和模式；
- `uv run pytest -q`：159 passed；
- Ruff changed-file check：通过；
- Capabilities `delegate_task` 测试覆盖兼容并发回退和 Main Thread 顺序意图。
