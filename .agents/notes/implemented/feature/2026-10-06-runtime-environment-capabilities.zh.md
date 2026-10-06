# 运行详情中的环境能力展示

状态：implemented；日期：2026-10-06；范围：Web Studio、Harness `WorldState`

## 决策

运行详情将 Harness `world/state` 返回的 `PATH` 命令和带 CLI 路径的应用能力分开展示。macOS 的 brew、Swift、Xcode、Python pip 模块和 Blender 检测由 Host 执行；Web Studio 只呈现投影结果，不在浏览器扫描应用或重做探测。

Blender 即使来自标准 `.app` 目录，也显示可调用的 CLI 路径，而不只显示应用名称。探测结果只说明宿主机检测到的能力，不代表工具权限已开放。

## 边界与原因

固定探测范围让结果可预测，也避免全盘应用扫描带来的延迟和隐私暴露。工具权限仍由 Host 的访问范围、审批和沙箱策略决定。

## 验证证据

- `EnvironmentToolsCard.test.jsx` 覆盖 PATH 命令、应用能力和空状态展示。
- `docs/workspaces.md` 指向 Harness 的 `docs/world-state.md`，后者说明 macOS、pip、Xcode 与 Blender 的检测条件。
- 实现提交：Web `2fdbbd5`，Harness `12b705c`。本文补录未重新运行组件测试。
