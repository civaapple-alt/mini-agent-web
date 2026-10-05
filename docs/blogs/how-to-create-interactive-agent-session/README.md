# Mini Agent Studio 的交互设计：状态、动作与恢复

这组文章以当前 Web Studio 为观察对象。它记录界面怎样呈现 Agent 状态、怎样让用户介入，以及断线后怎样恢复可操作的视图。文章把当前实现当作设计案例，指出理解负担和后续可验证的改进方向。

## 与 Harness 系列的分工

Harness 系列解释运行时怎样编排任务、管理上下文并控制工具执行。本系列讨论这些状态在 Web Studio 中如何被看见、理解和操作。涉及 App Server、Host、事件和恢复契约时，以 Harness 文档为准；涉及页面组织、文案、控件和操作反馈时，以本系列和 Web 源码为依据。

- [Harness 运行时骨架](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/blogs/how-to-build-agent-harness/01-patterns.md)
- [Harness 上下文与持久状态](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/blogs/how-to-build-agent-harness/03-context-and-state.md)
- [Harness 受控执行](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/blogs/how-to-build-agent-harness/04-controlled-execution.md)

## 阅读顺序

| 篇目 | 关注的问题 |
| --- | --- |
| [01 让用户看懂 Agent 当前在做什么](01-reading-studio-states.md) | 哪些区域负责显示状态、活动和下一步？ |
| [02 把 Agent 的停顿变成明确的用户动作](02-designing-user-actions.md) | 回答、审批、纠偏、停止和核对怎样区分？ |
| [03 断线后怎样让界面重新对齐运行状态](03-restoring-the-studio-view.md) | 实时事件缺失后，界面怎样重新对齐权威状态？ |
| [04 把经验变成可验证的原则和组件](04-principles-and-components.md) | 哪些交互规则值得保留，哪些组件值得重构？ |

## 阅读说明

每篇先描述当前 Studio 的行为，再指出尚待验证的问题。文中的原则和组件边界属于设计假设。验证它们需要可重复的任务场景、用户操作记录和运行时结果，不能只凭代码结构或作者判断。
