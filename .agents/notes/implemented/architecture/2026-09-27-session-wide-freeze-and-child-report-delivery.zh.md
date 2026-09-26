# 主会话冻结与子任务报告收讫

**状态：已实现**

## 决策

父会话 Stop 是 Session 级冻结：Gateway 先通过 App Server 持久化冻结意图，再请求 parent Turn 与活动 children 协作式停止。运行中的 children 结算为由 `parent_freeze` 暂停，排队 children 保持 queued。冻结期间不启动队列、重试或 child completion wake-up Turn。Gateway 重启时按持久 Session-control、operation 和 Turn 状态继续对账。

只有用户显式 Continue 才会恢复。Gateway 恢复由父冻结暂停的 children、排空原队列，并向同一 parent Thread 启动 `session_resume` Turn。子任务面板单独暂停或停止的任务仍由各自操作决定，不被父会话 Continue 覆盖。每个控制 operation 保存 `main_agent`、`user_panel` 或 `parent_freeze` 来源。

子报告在 Child Session 持久化。`task_read` 返回报告时，Capabilities 在父 Session 有界回执中记录对应的 child、operation、attempt 与 cursor。主线程任务面板将报告显示为“待主线程读取”或“主线程已收到”；读取重复执行不会增加重复回执。停止与报告竞争时，已提交报告保留，冻结期间不触发 parent wake-up。

## Gateway 与 WebStudio 行为

- Gateway 的 `freeze_session` 与 `continue_session` 仅协调 App Server 的持久状态和 child operation，不创建 Gateway 侧任务账本。
- 自动队列、失败重试、child 控制和 parent wake-up 在 Session `freezing` / `frozen` 时拒绝或跳过启动；面板仍允许用户单独取消 queued child。
- 页面和抽屉同步显示 `running`、`freezing`、`frozen`、`resuming`。冻结结算期间显示处理中，冻结后 composer 禁止提交并提供明确的 Continue 操作。
- 子任务状态、报告回执和 Session-control 更新都由持久端投影；刷新与 WebSocket 更新共用同一 hook 和 API。

## 验证

- Gateway：3 个冻结/恢复/队列测试通过；Python SDK 的 Session-control 与 child-control 调用测试通过；Ruff 与 Python compileall 通过。
- 前端：相关 `InputBar`、`ChildTasksPane`、`useChildTasks` 用例 28 个通过；ESLint 与 Vite production build 通过。Vite 报告当前 JavaScript bundle 超过 500 kB 建议值，此为构建警告，不影响构建结果。
- App Server 与 Capabilities：持久状态、Turn 准入、报告回执、parent-freeze 控制来源等定向测试通过；所有测试使用本地 deterministic model，没有付费模型请求。
- 本轮未运行完整 Web 测试矩阵或完整 Harness workspace suite。浏览器与真实进程重启的人工验收仍可后续补充。
