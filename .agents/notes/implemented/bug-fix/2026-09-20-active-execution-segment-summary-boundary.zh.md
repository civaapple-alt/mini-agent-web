# 活动摘要等待执行段结束

状态：Implemented

## 问题

运行中的 assistant 执行段会把已经完成的 reasoning 和工具活动合并到默认收起的摘要卡。分组器只检查
block 是否成功结束，没有判断所属执行段是否仍是当前段，导致同一段运行过程中出现折叠跳变。

## 决策

- 当前 assistant 执行段运行、等待审批或仍含有排队/运行活动时，保留逐项消息流，不创建活动摘要。
- 后续 assistant 执行段成为当前段后，前段中相邻的成功 reasoning 和工具活动才组成默认收起的摘要。
- Turn 结束时，最后一段的成功活动也收拢；进度文本、失败、审批、委派和最终回复继续单独显示。
- 使用 `MessageItem` 的当前段身份和现有 block 状态判定，不增加协议字段或持久化状态。

## 实现与验证

- `frontend/src/components/MessageItem.jsx`：先从未分组的 block 中识别当前活动，再决定是否调用成功活动分组器。
- `frontend/src/tests/AssistantTextBlock.test.jsx`：覆盖当前段运行时不分组、下一段开始后前段收拢，以及 Turn 结束后的最终摘要。
- `docs/troubleshooting.md` 与 `CHANGELOG.md`：同步当前折叠规则。
- 验证：`npx vitest run src/tests/AssistantTextBlock.test.jsx`（4 项通过）；`npm run lint` 通过；`npm run build` 通过，构建保留已有的 500 kB chunk 提示。
