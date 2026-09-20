# 新活动按钮跳到当前 Turn 最新执行段

## 问题

用户向上查看消息时，新活动按钮显示“有新活动 · 查看当前 Turn”。点击后，Studio 把该 Turn 的用户输入滚到屏幕中央。用户看到的是任务起点，无法直接查看最新活动。

## 根因与修复

`buildTurnHistoryEntries` 为 Turn 导航生成的 `messageId` 指向用户输入。新活动按钮复用 `scrollToEntry`，所以它滚到了输入气泡。

Turn 导航继续定位到用户输入。新活动按钮单独查找当前 Turn 最后一条 assistant 消息，并把该消息滚到可视区底部。当前 Turn 尚无 assistant 消息时，按钮回退到输入锚点；找不到可用锚点时回到底部。

## 验收证据

- `frontend/src/tests/TurnHistory.test.jsx` 覆盖当前 Turn 已有 assistant 活动和仅有输入两种情况。
- 已有活动时，测试验证按钮滚动到最后一条 assistant 消息，并使用 `block: "end"`。
- 尚无活动时，测试验证按钮仍定位到用户输入，并使用 `block: "center"`。
- `npm run test:ui -- src/tests/TurnHistory.test.jsx`：13 项通过。
- `npm run lint` 通过。
