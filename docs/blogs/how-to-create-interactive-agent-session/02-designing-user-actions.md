# 02 把 Agent 的停顿变成明确的用户动作

Agent 等待用户时，界面必须先说明它在等什么，再说明用户的选择会改变什么。回答问题、批准副作用、补充方向、停止运行和核对未知结果都不是同一个动作。

## 当前 Studio 把动作放在哪里

| 用户动作 | 当前界面 | 提交后的含义 |
| --- | --- | --- |
| 回答 Agent 问题 | 工具活动里的 `UserQuestionCard` | 答案回到原问题，Agent 才能继续这段工作。 |
| 批准工具操作 | 对应工具活动中的 `ApprovalDock`；直接子会话的审批也会显示在父会话输入区 | 用户决定是否允许该操作，并可选择授权范围；父会话入口会标出请求来自哪个子会话。 |
| 补充方向或排队 | InputBar 与 `PendingMessageDock`；子会话也可接收来自父会话的 steer | 新输入可以留在队列中，也可以作为 steer 送入当前 Turn；受理不代表文本已进入模型上下文。 |
| 请求停止 | InputBar 的停止按钮 | 向当前 Turn 请求取消；界面显示“停止中”，直到运行时确认结算。 |
| 核对未知工具结果 | 对应工具活动中的 `TurnReconciliationForm`；未匹配到活动时保留在恢复提示中 | 保存用户观察到的结果；完成核对后还要显式继续原 Turn。 |

对应实现见 [`UserQuestionCard.jsx`](../../../frontend/src/components/UserQuestionCard.jsx)、[`ToolCard.jsx`](../../../frontend/src/components/ToolCard.jsx)、[`ApprovalDock.jsx`](../../../frontend/src/components/input/ApprovalDock.jsx)、[`PendingMessageDock.jsx`](../../../frontend/src/components/PendingMessageDock.jsx)、[`TurnReconciliationForm.jsx`](../../../frontend/src/components/TurnReconciliationForm.jsx) 和 [`InputBar.jsx`](../../../frontend/src/components/InputBar.jsx)。

查看工具细节本身也是一个用户动作。工具卡先显示简短摘要；需要审查时再点“查看详情”展开参数和输出。这样既保留审查依据，也避免浮动内容遮住邻近活动。

实时纠偏不是立刻改写正在生成的内容。运行时会先确认收到请求，再在合适的执行节点把它交给模型；如果停止先完成，界面会说明纠偏还没有生效。原有的思考和工具活动会留在原来的位置，不会因纠偏被切成一段新的历史。

InputBar 的“停止本轮”只中断父 Turn，不会批量停止 Child Sessions。需要停止整条会话及其子任务时，使用子任务面板中的“停止整个会话”。两种操作影响的对象不同，按钮和反馈应明确说明这一点。

父子会话之间也要显示消息来源。父会话发给子会话的纠偏应与原始任务分开，并标明来自主会话。子代理报告应说明是哪项子任务的更新；父任务仍运行时先记录，等它空闲后再处理。直接子会话的审批回到父会话处理时，也要说明请求来自哪里。

StatusRail 只负责摘要和定位。它按连接同步、只读或停止限制、工具核对、审批、问题回答、继续 Turn 或确认计划的顺序选择下一项。审批和核对表单显示在匹配的工具卡中。找不到对应活动时，原有审批 Dock、问题卡或恢复提示仍提供操作入口。

操作入口按对应活动定位，而不是按相似的工具名称猜测。ChatArea 可以跳到当前未显示的活动；状态同步、只读或停止期间，卡片保留上下文，但暂不接受提交。

## 以未知工具结果为例

App Server 重启时，如果一条工具调用已经开始但没有持久化结果，Studio 会把它显示为待核对活动。表单先让用户选择实际状态：`已执行并成功`、`已执行但失败`，或 `确认尚未执行`。前两项要求填写核对依据，并允许填写真实的工具输出。成功或失败状态会随输出一起交给 Agent。选择 `确认尚未执行` 时，表单只要求核对依据；继续原 Turn 时 App Server 会重新执行该调用。

停止一组工具操作时，尚未开始的操作不会继续启动，已经开始的操作保留真实结果。若副作用是否发生仍不确定，Studio 会要求用户核对，不把停止请求当作“确认尚未执行”。

核对依据只写入执行日志，不会传给 Agent。保存核对决定不会执行工具，也不会继续 Turn。待核对调用全部处理后，ChatArea 会显示 `继续当前 Turn`，并展示检查点编号。用户需要区分核对依据与实际输出，也需要知道 `保存` 和 `继续` 是两个不同动作。

提交核对后，Studio 会重新确认当前恢复状态。若保存成功但暂时读不到新状态，界面会分别说明保存结果和状态读取结果，并提示用户刷新确认下一步。

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
