# 子 Session 活动详情按执行段阅读

- status: implemented
- date: 2026-09-27

## 问题

子 Session 详情复用主消息流的活动压缩：较早执行段的连续思考和工具块被收进一个折叠摘要，用户容易误以为只显示了最后一段。长任务提示也会作为普通气泡无限撑高；已完成任务的结果还会在状态卡顶部重复出现，而正文活动记录中已有最终回复。

## 决策

- 子 Session 详情逐项呈现思考和工具活动，按顺序标出多段执行；思考正文仍限高，工具输出继续由单个工具卡控制展开，避免整段活动无限增长。
- 长任务提示在详情内使用独立限高、可滚动的气泡。
- 持久化的最终回复沿用其时间线位置。只有结果未出现在最新 Turn 的活动记录中时，才将结果补到时间线末尾；状态卡不再重复显示最终回复。

## 实现

- `frontend/src/components/MessageItem.jsx`：增加仅供子 Session 详情使用的逐项活动呈现，不改变主消息流的折叠行为。
- `frontend/src/components/ChildSessionViewer.jsx`：限制最终结果的补齐位置，并在活动记录末尾渲染缺失结果。
- `frontend/src/components/SidePanel.css`：限制长提示气泡高度并提供局部滚动。
- 更新 `docs/child-tasks.md` 和 `CHANGELOG.md`。

## 验证

- `git diff --check`：通过。
- `npm --prefix frontend run lint`：通过。
- `npm --prefix frontend run build`：通过；Vite 提示现有 JS bundle 超过 500 kB。
- 未运行测试。
