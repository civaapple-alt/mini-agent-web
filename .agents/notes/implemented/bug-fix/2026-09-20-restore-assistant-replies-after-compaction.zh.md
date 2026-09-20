# 压缩恢复缺失的 assistant 回复

状态：Implemented

## 问题

checkpoint 压缩会删去较早的 assistant 对话，但 App Server 的 ThreadItems 仍保留原始输入和回复。Web Studio 已从 ThreadItems
恢复旧用户输入，却只为 checkpoint 中已有的 assistant 消息重建执行段，导致旧输入仍显示、对应回复却消失。

## 决策

- 为包含 reasoning、agentMessage、toolCall 或 compaction item 的缺失 Turn 创建 assistant 恢复锚点。
- 使用现有 item 顺序和 segment ID 还原回复与工具活动，不添加第二份 transcript 或新查询接口。
- 对 checkpoint 已包含 assistant 消息的 Turn 不再创建锚点，避免重复显示。
- 最终显示顺序沿用持久化 ThreadItem 的 Turn 和 item 顺序。

## 实现与验证

- `frontend/src/utils/messageState.js`：发现 checkpoint 未覆盖的 assistant Turn，并从 durable items 恢复其执行段。
- `frontend/src/tests/message_state.test.js`：覆盖压缩后缺失的旧回复、执行段顺序、失败工具诊断，以及 checkpoint 当前 Turn 不重复。
- `frontend/src/components/ChatArea.jsx`、`ChildSessionViewer.jsx` 和 `MessageItem.jsx`：只在每个 Turn 最后的 assistant 回复段显示回复操作，避免中途进度文本带有“复制回答”。
- `frontend/src/tests/ChatArea.test.jsx`：覆盖同一 Turn 的中间进度与最终回复操作位置。
- `docs/troubleshooting.md` 与 `CHANGELOG.md`：记录重启后从 ThreadItems 补回旧回复的行为。
- 验证：`node --test src/tests/message_state.test.js`（34 项通过）；`npx vitest run src/tests/ChatArea.test.jsx`（7 项通过）；改动文件 ESLint 通过；`npm run build` 通过；`python ..\mini-codex\scripts\check_docs_links.py README.md docs` 通过。
- 构建仍提示主 JavaScript chunk 超过 500 kB；构建成功，此项为现有体积提示。
