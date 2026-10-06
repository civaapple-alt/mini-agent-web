# 03 断线后怎样让界面重新对齐运行状态

连接中断时，浏览器会暂时失去新事件。界面不能据此判断 Turn 已结束，也不能把未收到的工具结果当作失败。对用户来说，恢复工作的目标是重新显示服务端当前确认的状态，并给出仍然有效的下一步。

## Studio 如何重新对齐

当前 Web Studio 先重新连接并读取 Thread 历史，再回放有限范围的事件。出现事件缺口时，它重新读取 canonical Thread 和活动项，随后读取运行状态。这样可以用持久投影补足浏览器错过的活动。

浏览器重新进入 Thread 时，Studio 还会加载最新活动、待回答问题、审批和运行状态。较早的历史按需加载。详情见 [`App.jsx`](../../../frontend/src/App.jsx) 和 [`threadHistoryPages.js`](../../../frontend/src/utils/threadHistoryPages.js)。

| 用户看到的状态 | 界面当前做法 | 用户需要理解的事 |
| --- | --- | --- |
| 正在恢复连接 | StatusRail 显示连接恢复状态，历史和运行状态重新读取 | 连接恢复中，不能据此判断 Agent 已停止。 |
| 本轮未完整结束 | ChatArea 显示检查点、阶段或失败原因 | 当前 Turn 还没有完成，继续与重试可能有不同含义。 |
| 结果待核对 | 在匹配的工具活动中展示核对表单；未匹配到活动时保留在恢复提示中 | 工具结果未知，先检查真实状态。 |
| 等待继续 | 显示 `继续当前 Turn` 操作 | 核对已保存，点击后才会恢复原 Turn。 |
| 只读查看 | 禁止提交控制动作，并说明 Session 由其他进程持有 | 你可以查看状态，暂时不能控制这条运行。 |

事件回放发现缺口时，当前实现会提示已从会话快照恢复。事件负责及时更新界面；Thread、Turn 和活动项投影用于重建历史和当前状态。二者用途不同，不能把本地事件缓存当成完整记录。

## 哪些设计点还需要验证

当前界面把连接状态和待处理摘要放在 StatusRail，把工具核对和 Turn 级继续操作放在 ChatArea，把检查点细节放在状态侧栏。这些信息来自不同读取路径，也承担不同职责。重连时需要验证用户能否看出它们描述的是同一个 Project、Thread 和 Turn。

待核对摘要会显示剩余调用数和检查点编号。核对表单靠近对应的工具活动，`继续当前 Turn` 仍留在 Turn 检查点提示中。保存核对决定后，提示会说明继续操作会恢复原 Turn，并复用已记录的工具结果。实际走查还要确认用户能否快速找到继续入口，并理解尚未执行的调用会在恢复时重新运行。

StatusRail 使用 `callId`、`interactionId` 和 `turnId` 定位目标。ChatArea 会挂载虚拟列表中的目标活动并把焦点移到卡片。若活动尚未出现在时间线中，核对表单会保留在恢复提示中。断线、只读和停止结算期间，StatusRail 不提供过期操作的跳转，工具卡也会禁用提交。

Turn 结束事件到达后，Studio 会读取该 Turn 的最新恢复状态，避免用事件摘要覆盖检查点状态。提交核对后，Studio 也会读取最新检查点。若核对请求失败，页面会重新读取状态；若核对已保存但读取失败，页面会分别说明保存结果和状态读取结果。这样可以区分“决定未保存”和“保存已完成，但当前状态尚未读回”。

恢复路径不应自动重发用户输入或重跑结果未知的工具。Studio 应明确显示 `状态尚未确认`，并保留能解释下一步的上下文。若连接本身也未恢复，则应显示读取失败或等待状态，不能填入猜测的完成结果。

Harness 文章追踪事件顺序、持久检查点和重启语义。本篇检查这些边界怎样变成用户看到的等待提示、加载状态和恢复操作。

- [Harness 上下文与持久状态](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/blogs/how-to-build-agent-harness/03-context-and-state.md)
- [Studio 集成与重连规范](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/studio-integration.md#turn-事件与重连)
- [`App.jsx` 中的事件回放与历史读取](../../../frontend/src/App.jsx)
- [`StatusDetailsPane.jsx`](../../../frontend/src/components/StatusDetailsPane.jsx)
- [`ChatArea.jsx`](../../../frontend/src/components/ChatArea.jsx)

下一篇会把这些观察整理成可验证的原则和候选组件：[04 把经验变成可验证的原则和组件](04-principles-and-components.md)。
