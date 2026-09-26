# 子智能体列表折叠状态与数量摘要

状态：Implemented

## 决策

- 子智能体面板的“已结束”数量包含已完成和已取消任务；与列表折叠分组口径一致。
- 完成/取消任务的展开页数由 SidePanel 持有。打开子 Session 详情会卸载列表，但返回后恢复原展开状态和已加载页数；切换父 Session 或项目时重置。
- 详情继续保持页内导航，任务状态仍来自 Gateway/App Server 的 operation 投影。

## 实现与验证

- `ChildTasksPane` 让数量摘要分别展示运行、排队、待处理、已结束和总数；`StatusDetailsPane` 使用相同计数口径。
- SidePanel 持有已结束任务展开页数，返回列表时复用；父 Thread 或 Project 变化时清零。
- `npm run lint`、`npm run build` 和文档链接检查通过。
- 更新了已有 UI 断言；本轮未运行自动化测试。
