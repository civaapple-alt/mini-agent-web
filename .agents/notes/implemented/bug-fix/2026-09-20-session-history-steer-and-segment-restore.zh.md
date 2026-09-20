# 重启恢复保留输入与执行段边界

## 问题

重启后，Studio 用 checkpoint 消息和 Session item 投影恢复消息流。checkpoint 可能把多条用户输入压成一条。前端再按 Turn ID 去重时，后续 steer 会消失。同一 Turn 的多个 assistant 执行段也曾被恢复到同一消息中，完成的思考与工具活动因此并成一张摘要卡。

对于某些旧 Session，`turn_started.prompt` 已持久化，但对应的用户 `item` 没有写入。只读 item 投影无法显示这条输入。

## 决策

- Session item ID 和记录顺序是历史恢复的权威依据。存在持久用户输入时，不显示无法匹配的 checkpoint 用户消息。这样 checkpoint 中的合并文本不会取代原始输入。
- Gateway 对缺少用户 item 的 `turn_started` 记录投影独立输入。若该记录紧跟在 `status=steered` 的结算记录之后，则输入来源为 steer；其他缺项输入来源为 user。`child_wakeup` 仍作为 Turn 来源，不投影为用户输入。
- 前端按持久 assistant segment 分别重建执行段，并按输入 item 的顺序插入 steer。一个 Turn 允许多条用户消息，但 Turn 轨道仍只投影一个节点。
- 保留旧 checkpoint 作为模型上下文。只限制它在历史消息流中的展示范围。

## 所有权与边界

Gateway 从 App Server Session 日志构建有界 item 投影，不创建另一份持久化历史。前端负责把该投影与 checkpoint 消息按稳定 ID、Turn 和历史顺序合并。Turn 轨道按 Turn 去重，聊天消息按输入 item 分开显示。

旧记录若既没有 `turn_started.prompt`，也没有用户 item，恢复层不伪造输入内容。旧 Session 的 steer 来源仅在前一 Turn 明确以 `steered` 结算时推断。同 Turn 的后续持久用户 item 按顺序标记为 steer。

## 验收证据

- `server/session_catalog.py` 的测试覆盖：有用户 item、缺失 steer item、缺失普通输入 item，以及来源恢复。
- `frontend/src/utils/inputTrace.js` 的测试覆盖：同一 Turn 的首条输入和后续 steer 独立保留。
- `frontend/src/utils/messageState.js` 的测试覆盖：忽略 checkpoint 合并输入，并按 segment、steer 和工具顺序恢复执行段。
- `frontend/src/components/ChatArea.jsx` 的测试覆盖：重启后 steer 位于前后 assistant 段之间，且保持 steer 样式。
- `frontend/src/utils/turnHistory.js` 的测试覆盖：同一 Turn 的多条输入仍对应一个 Turn 轨道节点。

本地验证结果：

- `node --test src/tests/message_state.test.js`：33 项通过。
- `npm run test:ui -- src/tests/InputTrace.test.jsx src/tests/TurnHistory.test.jsx`：19 项通过。
- `uv run pytest -q tests/gateway/test_session_manager.py -k "steer_prompt or lists_all_items_with_bounded_pages"`：2 项通过。
- `npm run lint`、`uv run ruff check server/session_catalog.py tests/gateway/test_session_manager.py` 和文档链接检查通过。
- `npm run build` 通过；Vite 提示有单个 chunk 超过 500 KB。
- 指定 Session 的真实 item 投影返回三个独立输入，其中缺失持久 item 的第三条按前一 Turn 的 `steered` 结算记录标记为 steer。检查只输出 ID、Turn 和来源，没有输出输入正文。
