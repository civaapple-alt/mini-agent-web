# 02 把 Agent 的停顿变成明确的用户动作

Agent 等待用户时，界面必须先说明它在等什么，再说明用户的选择会改变什么。回答问题、批准副作用、补充方向、停止运行和核对未知结果都不是同一个动作。

## 当前 Studio 把动作放在哪里

| 用户动作 | 当前界面 | 提交后的含义 |
| --- | --- | --- |
| 回答 Agent 问题 | 工具活动里的 `UserQuestionCard` | 答案回到原问题，Agent 才能继续这段工作。 |
| 批准工具操作 | 对应工具活动中的 `ApprovalDock` | 用户决定是否允许该操作，并可选择授权范围。 |
| 补充方向或排队 | InputBar 与 `PendingMessageDock` | 运行中的新输入先进入待处理队列；用户可编辑、移除排队项，或将一项作为实时纠偏发送。 |
| 请求停止 | InputBar 的停止按钮 | 提交协作式停止请求，界面仍需等待运行时结算。 |
| 核对未知工具结果 | 对应工具活动中的 `TurnReconciliationForm`；未匹配到活动时保留在恢复提示中 | 保存用户观察到的结果；完成核对后还要显式继续原 Turn。 |

对应实现见 [`UserQuestionCard.jsx`](../../../frontend/src/components/UserQuestionCard.jsx)、[`ToolCard.jsx`](../../../frontend/src/components/ToolCard.jsx)、[`ApprovalDock.jsx`](../../../frontend/src/components/input/ApprovalDock.jsx)、[`PendingMessageDock.jsx`](../../../frontend/src/components/PendingMessageDock.jsx)、[`TurnReconciliationForm.jsx`](../../../frontend/src/components/TurnReconciliationForm.jsx) 和 [`InputBar.jsx`](../../../frontend/src/components/InputBar.jsx)。

StatusRail 只负责摘要和定位。它按连接同步、只读或停止限制、工具核对、审批、问题回答、继续 Turn 或确认计划的顺序选择下一项。审批和核对表单显示在匹配的工具卡中。找不到对应活动时，原有审批 Dock、问题卡或恢复提示仍提供操作入口。

匹配依赖 `callId`、`interactionId` 和 `turnId` 等结构化身份，不依赖工具名称。ChatArea 使用已有虚拟列表跳到离屏活动。状态同步、只读或停止期间，卡片保留上下文，但禁用提交。

## 以未知工具结果为例

App Server 重启时，如果一条工具调用已经开始但没有持久化结果，Studio 会把它显示为待核对活动。表单先让用户选择实际状态：`已执行并成功`、`已执行但失败`，或 `确认尚未执行`。前两项要求填写核对依据，并允许填写真实的工具输出。成功或失败状态会随输出一起交给 Agent。选择 `确认尚未执行` 时，表单只要求核对依据；继续原 Turn 时 App Server 会重新执行该调用。

核对依据只写入执行日志，不会传给 Agent。保存核对决定不会执行工具，也不会继续 Turn。待核对调用全部处理后，ChatArea 会显示 `继续当前 Turn`，并展示检查点编号。用户需要区分核对依据与实际输出，也需要知道 `保存` 和 `继续` 是两个不同动作。

提交核对后，Studio 会读取 `turn/read` 的最新恢复状态。若保存成功但状态读取失败，Studio 会明确报告这两件事，要求用户刷新后确认下一步。若提交请求没有得到确认，Studio 也会重新读取恢复状态；界面以 App Server 返回的检查点和待核对调用为准。

成功或失败的结果字段与核对依据在宽屏下并排显示，在窄屏下上下排列。选择尚未执行时只显示核对依据。继续入口仍属于整个 Turn，而不是单条调用；待核对项数、检查点编号和保存反馈会帮助用户判断下一步。

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
