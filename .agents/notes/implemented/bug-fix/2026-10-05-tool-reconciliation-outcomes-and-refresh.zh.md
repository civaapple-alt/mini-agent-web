# 工具核对结果与恢复状态回读

## 背景

恢复表单原先只有“已执行”和“尚未执行”两项。`turn/reconcile` 的数据模型已经允许已执行调用提交 `completed` 或 `failed` 结果，但 Studio 总是提交 `completed`。用户无法把真实失败反馈给 Agent。

另外，表单把核对请求和随后读取 `turn/read` 放在同一个错误处理中。请求保存成功但状态读取失败时，页面会错误地显示“核对失败”。Turn 结束事件也需要再次读取权威恢复状态，避免用事件摘要丢失检查点信息。

## 实现

- 表单提供“已执行并成功”、“已执行但失败”和“确认尚未执行”三种实际状态。
- 成功和失败都通过 `completed` disposition 提交，并以 result 的 `status` 区分。尚未执行不提交 result。
- 切换实际状态时清空之前填写的工具输出，防止输出被错误地归到另一种结果状态；核对依据保留。
- 核对依据只写入执行日志。实际成功或失败输出会提交给 Agent。宽屏下两个字段并排，窄屏下上下排列。
- 恢复提示显示待核对调用数和检查点编号。等待继续时说明会恢复同一 Turn，复用已记录的结果，并重新运行先前确认未执行的调用。
- 核对请求保存成功后，Studio 单独读取 `turn/read`。若状态读取失败，提示“决定已保存，状态未读回”。若请求未获确认，Studio 重新读取最新状态并以服务端结果更新界面。
- Turn 收到未完成的终止事件后，Studio 按原 Thread、Project 和 Turn 身份读取最新恢复快照。App Server 仍是执行与恢复状态的唯一权威。

## 验证

- `npm run test:ui -- src/tests/ChatArea.test.jsx`：20 项通过。
- `uv run pytest tests/gateway/test_gateway_api.py::test_gateway_reconcile_and_context_manifest_routes_use_app_server tests/gateway/test_session_manager.py::test_reconcile_turn_forwards_stable_request_to_app_server`：3 项通过。
- `npm run lint`：通过。
- `npm run build`：通过。Vite 提示压缩后的 JavaScript 包超过 500 KiB。
- `git diff --check`：通过。
- `GET /threads/t-mut7tva5?project_id=nature`：返回 200；页面引用 `index-DiIR8GHQ.js`，服务端与 `frontend/dist` 构建产物 SHA-256 均为 `3cd2bf0439514e5999ce507ef6fad1270936276974dcdfc90b8935b4968e76fe`。
- 在 Codex 内置浏览器打开本地隔离预览，用假的 `shell` 调用核对成功、失败和未执行三个状态，确认字段随选择切换、失败输出提交为 `failed`，尚未执行时不带 result；没有向真实 Thread 或 Gateway 提交。
- 用户给出的真实 Thread 页面读取结果为 HTTP 200，Turn 已完成且没有待核对表单；未在该真实 Thread 提交测试决定。
