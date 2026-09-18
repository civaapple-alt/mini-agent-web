# Web Studio 信息流 Turn 方向感

状态：Implemented

## 背景

信息流能够展示 reasoning、工具和模型回答，但多轮 Session 中缺少“当前做到哪一轮”和“这一轮
发生了什么”的稳定入口。用户向上回看旧内容时，新的流式输出也容易改变阅读位置。

## 决策

- 以 `collectInputMessages(messages, threadItems)` 作为 Session 输入历史投影来源，每个输入只生成
  一个 Turn 节点；来源标签区分普通输入、Goal 和实时纠偏。
- 在 assistant 内容顶部增加轻量 Turn 摘要卡，状态和指标来自现有 `statusModel`、`activeTurnId`、
  `lastTurnResult` 与可见消息块，不新增 WebSocket、JSON-RPC 或 Session 字段。
- 历史 Turn 没有明确终态证据时保持“历史”，不从回答文本推断“已完成”；问题数量不通过问号字符
  猜测。
- 用户离开底部后暂停自动跟随，以“有新活动”提示代替强制跳转；点击提示才回到当前 Turn。
- 已完成且无错误的连续 reasoning/tool 块合并为可展开步骤摘要，原始工具详情仍保留。
- 移动端隐藏 Turn 轨道，并在 `prefers-reduced-motion` 下关闭持续动画。

## 实现范围

- `frontend/src/utils/turnHistory.js`：Turn 节点、状态、可靠指标和相邻已完成步骤的纯展示投影。
- `frontend/src/components/SessionTurnRail.jsx`：输入历史轨道节点。
- `frontend/src/components/TurnActivitySummary.jsx`：Turn 内摘要卡。
- `frontend/src/components/TurnActivityGroup.jsx`：已完成内部步骤的折叠详情。
- `frontend/src/components/ChatArea.jsx`、`MessageItem.jsx`、`AppLayout.jsx` 及 `ChatArea.css`：接入
  锚点、点击定位、聚焦高亮、未读活动提示和响应式布局。
- `frontend/src/tests/TurnHistory.test.jsx`：覆盖输入顺序/来源、未知历史状态、指标、步骤合并和
  节点导航。

## 验证

- `npm run lint`
- `npm test`
- `npm run build`

验证重点是当前 Turn 的运行/审批/失败/中断状态不通过展示层重复推断，历史状态不冒充完成，以及
用户回看旧内容时不会被新事件强制拉到底部。
