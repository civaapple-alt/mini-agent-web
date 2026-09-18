# Web Studio 消息流阅读层级与执行详情

状态：Implemented

## 背景

消息流此前把模型回答、思考内容和工具事件按相近的视觉重量连续展开。已完成的思考会占用
较大区域，`read_file` 结果会自动打开，工具卡片关闭时还会额外保留一行“执行输出”。
用户需要先扫过内部过程，才能找到模型回答。

## 决策

- 模型文本使用 `assistant-answer` 作为主内容样式，保持默认可读和突出。
- 执行中的思考保持实时显示，但限制内容高度；已完成的思考默认收起，点击标题后查看全文。
- 工具标题行同时承载工具名、参数摘要、状态和“查看输出”入口。
- 工具输出只在用户主动展开后渲染。`read_file` 不再因完成而自动展开。
- 审批等待、失败和中断状态继续保持醒目，帮助用户判断是否需要介入。

这次只调整 Web Studio 的展示层，没有新增事件字段，也没有改变消息历史和工具结果的存储。

## 实现范围

- `frontend/src/components/ThinkingBlock.jsx` 和 `ThinkingBlock.css`：收敛思考标题和默认展开策略。
- `frontend/src/components/ToolCard.jsx` 和 `ToolCard.css`：合并输出入口，移除完成后的自动展开。
- `frontend/src/components/MessageItem.jsx` 和 `frontend/src/index.css`：突出模型正文。
- `frontend/src/tests/ThinkingBlock.test.jsx` 和 `frontend/src/tests/ToolCard.test.jsx`：覆盖默认折叠和主动展开。
- `docs/troubleshooting.md`：更新消息流和 `read_file` 的实际使用方式。

## 验证

- `npm run lint`
- `npx vitest run src/tests/ThinkingBlock.test.jsx src/tests/ToolCard.test.jsx`
- `npm test`
- `npm run build`

验证重点是：已完成思考默认收起、`read_file` 结果默认收起、工具关闭时没有独立输出行、
模型正文继续正常渲染，以及完整输出仍可展开和复制。
