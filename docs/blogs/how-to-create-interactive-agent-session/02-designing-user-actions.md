# 02 把 Agent 的停顿变成明确的用户动作

Agent 等待用户时，界面必须先说明它在等什么，再说明用户的选择会改变什么。回答问题、批准副作用、补充方向、停止运行和核对未知结果都不是同一个动作。

## 当前 Studio 把动作放在哪里

| 用户动作 | 当前界面 | 提交后的含义 |
| --- | --- | --- |
| 回答 Agent 问题 | 工具活动里的 `UserQuestionCard` | 答案回到原问题，Agent 才能继续这段工作。 |
| 批准工具操作 | InputBar 上方的 `ApprovalDock` | 用户决定是否允许该操作，并可选择授权范围。 |
| 补充方向或排队 | InputBar 与 `PendingMessageDock` | 运行中的新输入先进入待处理队列；用户可编辑、移除排队项，或将一项作为实时纠偏发送。 |
| 请求停止 | InputBar 的停止按钮 | 提交协作式停止请求，界面仍需等待运行时结算。 |
| 核对未知工具结果 | ChatArea 的恢复提示和 `TurnReconciliationForm` | 保存用户观察到的结果；完成核对后还要显式继续原 Turn。 |

对应实现见 [`UserQuestionCard.jsx`](../../../frontend/src/components/UserQuestionCard.jsx)、[`ApprovalDock.jsx`](../../../frontend/src/components/input/ApprovalDock.jsx)、[`PendingMessageDock.jsx`](../../../frontend/src/components/PendingMessageDock.jsx)、[`TurnReconciliationForm.jsx`](../../../frontend/src/components/TurnReconciliationForm.jsx) 和 [`InputBar.jsx`](../../../frontend/src/components/InputBar.jsx)。

## 以未知工具结果为例

App Server 重启时，如果一条工具调用已经开始但没有持久化结果，Studio 会把它显示为待核对活动。当前表单先让用户选择实际状态。选择 `已执行，记录实际结果` 后，表单要求填写核对依据，并允许填写工具真实返回的结果。选择 `确认尚未执行` 时，表单要求核对依据；之后继续原 Turn 会重新执行该调用。

保存核对决定不会执行工具，也不会继续 Turn。所有未知调用处理完后，ChatArea 才显示 `继续当前 Turn`。这个顺序保留了副作用边界，但操作横跨表单和 Turn 提示。用户需要区分核对依据与实际输出，还要明白 `保存` 和 `继续` 是两个不同动作。

一次实际使用中，用户提交核对并继续后，仍看到 `本轮未完整结束` 和 `process_restart_during_tool_call`。这个反馈暴露出一个需要验证的问题：用户能否看出核对决定针对一条工具调用，而完成恢复针对整个 Turn？界面还需要明确回显刚提交的决定是否已保存，以及还有哪些调用待处理。

当前字段分别标为 `核对依据` 和 `工具实际返回结果`，说明也给出填写示例。用户仍需先判断哪段内容属于依据、哪段属于工具输出，以及结果字段是否可以留空。完成核对后，下一步按钮位于恢复提示，而不是表单内。后续设计可以把流程明确展示为 `检查实际状态 → 记录依据 → 保存决定 → 继续原 Turn`，并按所选状态只保留相关字段。

## 用动作后果检查控件

检查一个交互时，逐项回答：

- 用户是在提供信息、授权动作，还是触发副作用？
- 这次提交会保存决定、启动工具，还是恢复当前 Turn？
- 哪个对象会变化：问题、工具调用、当前 Turn，还是下一条用户消息？
- 服务端确认后，界面会显示什么状态和下一步？

按钮文案应说清提交的动作。状态提示应说明后续还要做什么。对于审批、核对和恢复，不能只给一个没有对象和结果的 `确认` 按钮。

Harness 文章说明工具调用如何经过准入、审批和运行时。本篇关注的是 Studio 如何让用户正确完成对应动作。

- [Harness 受控执行](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/blogs/how-to-build-agent-harness/04-controlled-execution.md)
- [Studio 用户提问说明](../../user-questions.md)
- [执行检查点说明](../../child-tasks.md#main-与-child-的执行检查点)
- [`ChatArea.jsx`](../../../frontend/src/components/ChatArea.jsx)
- [`TurnReconciliationForm.jsx`](../../../frontend/src/components/TurnReconciliationForm.jsx)

下一篇会讨论页面刷新或连接中断后，Studio 如何重新对齐运行状态：[03 断线后怎样让界面重新对齐运行状态](03-restoring-the-studio-view.md)。
