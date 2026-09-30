# 输入栏停止只中断当前 Turn

## 问题

输入栏的 Stop 使用 `composer-stop` 作为全会话冻结信号。它持久化 `SessionControl=frozen`，
暂停父 Turn、活动子任务和队列；冻结完成后，App Server 拒绝普通新 Turn，用户只能显式继续整个会话。
这让“停止当前生成”与“暂停整个工作流”看起来像同一项操作。

## 决策

输入栏的“停止本轮”只中断当前 parent Turn。Turn 结算后，用户可以在同一会话发送“继续”或补充指令；
这会启动新 Turn 并使用现有会话历史，不等同于从原 Turn 的执行检查点恢复。

普通停止后活动子任务继续运行，后续完成或报告可能唤醒 parent。需要暂停父会话、活动子任务和队列时，
用户在子任务面板选择“停止整个会话”。已持久化为 `frozen` 的会话保持原状态，仍需显式继续；
新停止行为不迁移既有状态。

## 实施

- 输入栏仅在 parent Turn 活动时显示“停止本轮”，使用现有 `turn/interrupt`。
- parent Turn 空闲时，即使有子任务仍在运行，输入栏也允许发送新指令。
- 删除 composer stop 到 `session_control freeze` 的隐式路由；子任务面板保留显式全会话冻结与恢复。
- 更新子任务文档、故障排查指南和 Unreleased 记录。

## 验证

- `npm --prefix frontend run test:ui -- src/tests/InputBar.test.jsx src/tests/ChildTasksPane.test.jsx`：30 项通过。
- `npm --prefix frontend run lint`：通过。
- `git diff --check`：通过。
- Vitest 过程打印访问 localhost:3000 的 `ECONNREFUSED`，但两个目标测试文件和 30 项断言均通过。
