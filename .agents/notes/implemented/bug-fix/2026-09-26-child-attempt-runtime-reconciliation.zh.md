# 子任务 attempt 与 Runtime 快照对账

状态：Implemented

## 问题

Child Session 会保留最近一次 Turn 的 Runtime 快照。新 attempt 已持久化为 `queued` 时，如果 Gateway
仍把旧 `turn_id` 和 `failed` phase 投影到当前任务，排队项会变成“运行中”，占用并发槽并阻止后续任务启动。
Gateway 重启后，如果只凭持久化的 `pausing` 或 `cancelling` 状态重放中断，也可能把请求发给已经没有活动 Turn
的 Session，产生 `thread has no active turn`。

事件回放缺口时，前端也可能保留旧的 `isStreaming` 标记。Runtime 已空闲，但思考块仍计时并显示为思考中。

## 决策

- `queued` operation 没有当前 Turn，不读取同一 Session 上一次 attempt 的 Runtime 状态。
- 只有 operation 当前 Turn ID 与 Runtime 的活动 Turn ID 相同，Gateway 才将 operation 投影为运行中并计入并发。
- Runtime 明确显示 idle、终态或其他 Turn 时，保留持久 operation 状态，清除旧活动 Turn 投影，标记恢复待处理；不自动重启或中断 Turn，也不向用户提供无法命中目标 Turn 的控制按钮。
- Gateway 恢复只在 Runtime 确认相同 Turn 仍活动时重新挂接；暂停/停止请求只针对该匹配 Turn 重放。
- WebStudio 用有 revision 的 Runtime 快照和事件更新结算陈旧流块。没有活动 Turn 时冻结所有残留思考和文本块；计时器只在流状态变化时启动或冻结。
- Child Thread 身份继续使用父 Session 与 `child_key` 派生的 canonical ID；标题只用于显示，不参与任务身份。

## 实现

- `server/session_manager.py`：排队状态不受旧 Runtime 覆盖；活动任务必须匹配 Runtime 的当前 Turn；识别陈旧活动投影，并在恢复时跳过过期中断。
- `frontend/src/App.jsx` 与 `frontend/src/utils/messageState.js`：统一应用 Runtime 快照和通知，拒绝倒退 revision，并结算与活动 Turn 不匹配的思考/文本块。
- `frontend/src/components/ThinkingBlock.jsx`：移除由每次计时刷新反复重建的 interval，按 streaming 状态边界计算耗时。
- `frontend/src/components/ChildTasksPane.jsx`：显示具体恢复原因，并隐藏当前无法作用于目标 Turn 的控制操作。

## 验证

- `uv run pytest tests/gateway/test_session_manager.py -q`：137 项通过。
- 前端 Node 单元测试：80 项通过；`ChildTasksPane` 和 `ThinkingBlock` UI 测试：14 项通过。
- `npm run lint`、`npm run build`、修改文件的 Ruff 检查和格式检查均通过。
- Harness 未改代码；`cargo test -p mini-agent-app-server`：72 项通过，
  `cargo clippy -p mini-agent-app-server --all-targets -- -D warnings` 通过。
- 生产构建报告 JS bundle 712.33 kB（gzip 212.27 kB），并提示 chunk 超过 500 kB；
  没有调用模型，也没有改写会话日志。
