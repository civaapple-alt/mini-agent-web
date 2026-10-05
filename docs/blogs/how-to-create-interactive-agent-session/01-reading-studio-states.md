# 01 让用户看懂 Agent 当前在做什么

Web Studio 把对话、运行状态和用户控制放在同一工作区。读懂这个界面，先看每个区域回答用户的哪个问题，再看这些区域如何共同说明当前工作。

## 当前界面怎样分工

| 区域 | 当前呈现 | 用户要从这里判断什么 |
| --- | --- | --- |
| Header 与 Sidebar | Project、Thread、会话入口和连接信息 | 我正在查看哪个工作？ |
| StatusRail | 当前生命周期、连接状态、执行设置和状态详情入口 | Agent 正在运行、等待操作，还是已经停止？ |
| ChatArea | 消息、工具活动、用户问题、历史记录和未完成 Turn 提示 | 刚才发生了什么？下一步需要处理哪条活动？ |
| InputBar | 新消息、附件、模型选项、排队消息和运行中的停止控制 | 我现在能做什么？输入会启动新工作，还是进入当前队列？ |
| 状态侧栏 | 检查点、最近进展、审批、子任务等详细信息 | 为什么卡在这里？能依据什么继续？ |

这些职责能在 [`AppLayout.jsx`](../../../frontend/src/components/AppLayout.jsx)、[`StatusRail.jsx`](../../../frontend/src/components/StatusRail.jsx)、[`ChatArea.jsx`](../../../frontend/src/components/ChatArea.jsx) 和 [`InputBar.jsx`](../../../frontend/src/components/InputBar.jsx) 中找到。`StatusDetailsPane` 展示更细的执行状态。

桌面可用宽度低于 `1100px` 时，项目侧栏折叠为图标栏；低于 `700px` 时改为可展开的抽屉。图标栏隐藏品牌名、会话列表和“最近”文字，避免内容被压成竖排；抽屉展开后恢复完整导航。

## 用四个问题检查一屏信息

一个状态界面至少要让用户找到四个答案：

1. 当前 Project、Thread 和 Turn 是什么？
2. Agent 正在运行、等待，还是已经结算？
3. 如果它没有继续，具体缺少什么？
4. 哪个控件会改变当前状态，点击后会发生什么？

StatusRail 提供摘要，ChatArea 保留按时间排列的活动，状态侧栏展示更详细的检查点和运行信息。这种分层能让用户按需查看细节，但也增加了跨区域理解的成本。相同 Turn 的摘要、等待原因和操作按钮需要保持一致；用户不应靠猜测在哪个面板里才能找到下一步。

这也是本系列要检视的地方。当前界面包含这些状态，并不证明信息层级已经合适。后续重构应先记录用户在哪个区域寻找状态、是否能解释下一步，再决定合并、移动或删减哪些内容。

## 与运行时文章的分界

Harness 文章解释 Thread、Turn 和 Session 怎样由运行时管理，也追踪状态如何跨越 App Server、SDK 和 Gateway。本篇只检查这些事实在浏览器中的呈现和可发现性。

- [Harness 运行时骨架](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/blogs/how-to-build-agent-harness/01-patterns.md)
- [Harness 上下文与状态](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/blogs/how-to-build-agent-harness/03-context-and-state.md)
- [`StatusDetailsPane.jsx`](../../../frontend/src/components/StatusDetailsPane.jsx)
- [`statusModel.js`](../../../frontend/src/utils/statusModel.js)

下一篇会沿着页面上的停顿状态，检查每一种用户动作应该改变什么：[02 把 Agent 的停顿变成明确的用户动作](02-designing-user-actions.md)。
