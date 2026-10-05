# 怎样创建一个可交互、可恢复的 Agent 会话

这组文章从 Mini Agent 当前的 App Server、Python SDK、Gateway 和 Web Studio 实现出发，讨论长时间运行的 Agent 怎样接收用户输入、等待控制动作、保存进度，并在客户端或服务进程中断后安全地继续。

## 范围说明

你提到的个人助理愿景类似 Meta Muse 或 Grok bots，重点是比价、邮件处理和日程协助等个人需求。这是未来期望，不是当前仓库已经实现的产品范围。当前的 `mini-agent-harness/cookbook/python-demo/08_personal_agent.py` 是一个小型 SDK 会话示例：它附着命名 Session、处理 `ask_user`，并展示未完成状态的恢复边界；它没有实现比价、邮件或日历助理。示例保留原文件名和默认 Session ID，便于继续使用现有命令与会话数据。

文章会把当前实现事实和面向未来产品的设计建议分开说明。涉及协议字段、限制或运行行为时，以各仓库的当前规范为准。

## 阅读顺序

| 篇目 | 要回答的问题 |
| --- | --- |
| [01 从愿景到会话模型](01-from-vision-to-session-model.md) | Session、Thread、Turn 和操作各自代表什么？ |
| [02 把交互做成明确的控制动作](02-interaction-and-control.md) | Agent 提问、审批、纠偏、停止和恢复核对有什么区别？ |
| [03 让持久化与恢复尊重副作用](03-persistence-and-recovery.md) | 服务重启后如何判断哪些工作可以续接，哪些必须核对？ |
| [04 从组件边界推导设计原则](04-components-and-principles.md) | 哪一层拥有哪项事实，哪些取舍适合未来个人助理？ |

## 当前规范

- [Harness 运行时架构](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/harness-framework.md)
- [App Server 协议与恢复](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/app-server.md)
- [Web Studio 集成与重连](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/studio-integration.md)
- [Web Studio 用户提问](../../user-questions.md)
- [Web Studio 执行检查点](../../child-tasks.md#main-与-child-的执行检查点)
