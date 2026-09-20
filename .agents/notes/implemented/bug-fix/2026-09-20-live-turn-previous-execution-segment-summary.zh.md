# 实时消息收拢已结束执行段

状态：Implemented

## 问题

实时事件会把一个 Turn 的思考和工具活动累积在同一条 assistant 消息中。`MessageItem` 在 Turn 运行时绕过活动分组器，
因此即使新执行段已经开始，之前完成的执行段仍逐项展开。

## 决策

- 将当前执行段之前已结束的相邻成功思考和工具活动合并为默认收起的摘要。
- 保留当前执行段的原始活动块和顺序；活跃思考仍保持展开。
- 新段开始后收拢上一段；Turn 结束后的规则继续由同一分组器处理。
- 根据当前活动块及其前置思考定位执行段，不增加协议字段或持久化状态。

## 实现与验证

- `frontend/src/components/MessageItem.jsx`：只对当前执行段前的已结束 block 调用摘要分组，并用 block 对象身份定位流式活动。
- `frontend/src/tests/AssistantTextBlock.test.jsx`：覆盖单条实时 assistant 消息中的历史摘要、当前段展开和新段推进后的收拢。
- `docs/troubleshooting.md` 与 `CHANGELOG.md`：说明实时消息内的执行段摘要规则。
- 验证：`npx vitest run src/tests/AssistantTextBlock.test.jsx`（5 项通过）、`npx eslint src/components/MessageItem.jsx src/tests/AssistantTextBlock.test.jsx`、`npm run build`、`python ..\mini-codex\scripts\check_docs_links.py README.md docs` 与 `git diff --check` 均通过。构建保留已有的 500 kB chunk 提示。
