# Plan 审查后直接启动实施 Turn

## 症状

Plan Mode 生成计划并进入待确认状态后，点击“开始实施”只关闭了 Plan Mode，
没有创建下一条实施 Turn，用户还必须手动输入“实现计划”。

## 根因

前端的 `handleStartImplementation` 只调用了 `setCollaborationMode('default')`，
没有复用正常的 `handleSendMessage` 发送路径。因此界面虽然提示模式已关闭，
但运行时没有收到新的 `turn` 请求。

## 修复

按钮现在按顺序执行：

1. 关闭当前 Plan Mode；
2. 成功后自动提交一条实施 Turn，提示模型读取并执行当前计划并完成验证；
3. 只有 Turn 已成功提交时才显示“已根据当前计划开始实施”。

关闭模式失败或发送链路不可用时，不发送实施 Turn，也不显示成功提示。

## 验证

新增 `plan_workflow.test.js`，覆盖成功提交和关闭 Plan Mode 失败时不提交两条路径；
前端 Node/UI 测试、lint 和 production build 均通过。
