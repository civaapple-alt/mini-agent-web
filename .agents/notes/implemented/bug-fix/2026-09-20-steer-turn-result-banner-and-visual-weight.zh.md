# Steer 期间隐藏过期结果并弱化标识

状态：Implemented

## 问题

`lastTurnResult` 在 steer 交接时可能保留上一段的步数上限或失败诊断。`turn_finished: steered` 是段间交接，不代表整轮结算；但消息流横幅原先只检查 `lastTurnResult` 是否存在，所以旧提示会在继续执行时留在页面。

Steer 消息使用整圈紫色边框、紫色底色和高饱和标签，视觉权重高于消息正文。

## 决策

- 新的 `turn_started` 清除上一执行段的结果；当前 Turn 仍活跃、等待审批或正在停止时隐藏终态横幅。
- Turn 真正结算后继续显示本轮最新的失败、步数上限或中断结果。
- 保留 steer 标签和消息位置；气泡使用中性色，标签用次要文本色，只让小图标保留低强度紫色。
- 生命周期修正在 Web Studio 前端状态投影完成，不改变 App Server 终态契约。

## 实现与验证

- `frontend/src/App.jsx`：在未被忽略的 `turn_started` 时清除旧结果。
- `frontend/src/components/ChatArea.jsx`：活动 Turn、审批和停止阶段不显示终态横幅。
- `frontend/src/components/ChatArea.css`：降低 steer 标签和气泡的紫色强调。
- `frontend/src/tests/ChatArea.test.jsx`：覆盖 steer 运行中隐藏旧结果、结算后显示新结果，以及 Runtime 投影仍标记 Turn 活跃时隐藏横幅。
- `docs/troubleshooting.md` 与 `CHANGELOG.md`：记录交接期间的横幅和视觉规则。
- 验证：`npx vitest run src/tests/ChatArea.test.jsx`（6 项通过）；`npm run lint` 通过；`npm run build` 通过，保留 500 kB chunk 提示。
