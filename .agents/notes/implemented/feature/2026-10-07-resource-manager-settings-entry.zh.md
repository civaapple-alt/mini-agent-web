# 资源管理入口与页面简化

状态：implemented；日期：2026-10-07；范围：Web Studio 设置面板与资源管理器

## 决策

资源管理属于运行维护入口，不放在会话主侧栏。设置面板新增“运行管理 / 资源管理”，同时保留 `/resources` 直达地址。

资源页用一行指标和精简列表作为默认视图。列表显示会话、运行状态、内存、CPU、JSON-RPC 流量和操作。用户选择一行后，页面再显示 PID、运行时长、历史趋势和 RPC 方法统计，避免首次打开时自动展开一块明细面板。

设置面板只在选中资源管理时挂载该组件。切换到其他设置页后，组件清理快照和历史轮询。

## 验证

- `npm --prefix frontend run lint`：通过。
- `npm --prefix frontend run build`：通过；Vite 报告主 JS chunk 超过 500 kB。
- `git diff --check`：通过。
