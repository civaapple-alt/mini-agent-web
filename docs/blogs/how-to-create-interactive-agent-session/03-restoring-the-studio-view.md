# 03 断线后怎样让界面重新对齐运行状态

连接中断时，浏览器会暂时失去新事件。界面不能据此判断 Turn 已结束，也不能把未收到的工具结果当作失败。对用户来说，恢复工作的目标是重新显示服务端当前确认的状态，并给出仍然有效的下一步。

## Studio 如何重新对齐

当前 Web Studio 先重新连接并读取 Thread 历史，再回放有限范围的事件。出现事件缺口时，它重新读取 canonical Thread 和活动项，随后读取运行状态。这样可以用持久投影补足浏览器错过的活动。

浏览器重新进入 Thread 时，Studio 还会加载最新活动、待回答问题、审批和运行状态。较早的历史按需加载。详情见 [`App.jsx`](../../../frontend/src/App.jsx) 和 [`threadHistoryPages.js`](../../../frontend/src/utils/threadHistoryPages.js)。

| 用户看到的状态 | 界面当前做法 | 用户需要理解的事 |
| --- | --- | --- |
| 正在恢复连接 | StatusRail 显示连接恢复状态，历史和运行状态重新读取 | 连接恢复中，不能据此判断 Agent 已停止。 |
| 本轮未完整结束 | ChatArea 显示检查点、阶段或失败原因 | 当前 Turn 还没有完成，继续与重试可能有不同含义。 |
| 结果待核对 | 展示具体工具调用和核对表单 | 工具结果未知，先检查真实状态。 |
| 等待继续 | 显示 `继续当前 Turn` 操作 | 核对已保存，点击后才会恢复原 Turn。 |
| 只读查看 | 禁止提交控制动作，并说明 Session 由其他进程持有 | 你可以查看状态，暂时不能控制这条运行。 |

事件回放发现缺口时，当前实现会提示已从会话快照恢复。事件负责及时更新界面；Thread、Turn 和活动项投影用于重建历史和当前状态。二者用途不同，不能把本地事件缓存当成完整记录。

## 哪些设计点还需要验证

当前界面把连接状态放在 StatusRail，把未完成原因和可执行控制放在 ChatArea，把检查点细节放在状态侧栏。这些信息来自不同读取路径，也承担不同职责。重连时需要验证用户能否看出它们描述的是同一个 Project、Thread 和 Turn。

另一个问题是操作的连续性。用户可能从核对表单保存结果，再到 Turn 提示中找 `继续当前 Turn`。应该验证该按钮是否容易找到、按钮出现前是否清楚说明了保存结果，以及连续几个未知调用时用户能否看出还剩几项。

一次实际操作反馈中，用户提交核对并继续后，页面仍显示本轮未完整结束及 `process_restart_during_tool_call`。这条提示本身不能说明上一次核对没有保存。它可能对应恢复后的新中断，也可能要求界面重新读取最新检查点。页面需要同时标出最近一次核对决定、当前待处理调用和 Turn 整体状态，让用户知道应该继续、核对，还是先刷新状态。

恢复路径不应自动重发用户输入或重跑结果未知的工具。Studio 应明确显示 `状态尚未确认`，并保留能解释下一步的上下文。若连接本身也未恢复，则应显示读取失败或等待状态，不能填入猜测的完成结果。

Harness 文章追踪事件顺序、持久检查点和重启语义。本篇检查这些边界怎样变成用户看到的等待提示、加载状态和恢复操作。

- [Harness 上下文与持久状态](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/blogs/how-to-build-agent-harness/03-context-and-state.md)
- [Studio 集成与重连规范](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/studio-integration.md#turn-事件与重连)
- [`App.jsx` 中的事件回放与历史读取](../../../frontend/src/App.jsx)
- [`StatusDetailsPane.jsx`](../../../frontend/src/components/StatusDetailsPane.jsx)
- [`ChatArea.jsx`](../../../frontend/src/components/ChatArea.jsx)

下一篇会把这些观察整理成可验证的原则和候选组件：[04 把经验变成可验证的原则和组件](04-principles-and-components.md)。
