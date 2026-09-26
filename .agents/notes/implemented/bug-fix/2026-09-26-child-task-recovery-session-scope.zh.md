# 子任务恢复按父 Session 隔离

状态：Implemented

## 问题

Gateway 重启时会重试 `pending` 和 `materialized` 委派回执。`materialized` 已表示 App Server 接收了持久 operation；再次从回执启动会把旧父 Session 的 Thread ID 用在当前 Session 下。

失败回执只按父 Thread 和项目筛选。Thread 切换到新 Session 后，旧 Session 的失败项仍会显示在当前子智能体列表中。

停止请求是协作式操作。Gateway 需要等待 App Server 结算 Turn。若 Web Studio 丢失 `turn_finished`，本地 `isInterrupting` 状态可能一直保留。

## 决策

- 委派回执键包含父 Session ID、父 Turn ID 和工具调用 ID；回执同时持久化 `parent_session_id`。
- Gateway 只恢复 Session 身份匹配当前父 Session 的 `pending` 回执。旧记录缺少 Session 身份时不重放。
- `materialized` 回执不再启动子任务。App Server 的持久 operation 负责活动任务重连和排队任务排空。
- Gateway 只重连归属当前 canonical 父 Session 的 Child Session。失败回执也按当前父 Session 过滤。
- Web Studio 在停止期间轮询运行状态。运行时确认 Turn 结算，或报告了另一个当前 Turn 后，界面读取最新快照并清除过期停止状态。
- 父会话停止只作用于主 Turn。用户需要在对应任务卡单独停止子任务。

## 实现与验证

- `server/session_manager.py`：回执身份、恢复条件、子任务重连和失败列表都限定到父 Session。
- `frontend/src/App.jsx`、`frontend/src/utils/sessionRecovery.js`：停止期间读取权威运行状态；事件通知结算后触发快照对账。
- Gateway 定向测试：130 项通过。
- Web 前端测试：79 项 Node 测试、131 项 UI 测试通过；lint 和生产构建通过。
- `uv run ruff check server/session_manager.py tests/gateway/test_session_manager.py` 与 `git diff --check` 通过。
- 生产构建通过，生成的 JavaScript bundle 为 710.46 kB，并报告 chunk 大小提示；本次改动未调用模型。
