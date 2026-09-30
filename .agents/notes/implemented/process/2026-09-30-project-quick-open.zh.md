# 项目工作区右上角快捷打开

## 目标

在 Web Studio 顶栏右上角提供截图所示的打开方式菜单，直接打开当前会话绑定的
Project 主工作区。支持 Windows，同时兼容 macOS 和 Linux。

## 实施

- Gateway 提供固定目标列表和打开 API；前端只传当前会话 `project_id` 与目标枚举。
- 工作区路径由 Project 注册表解析，不允许前端指定任意路径、命令或可执行文件。
- macOS 提供 Finder、VS Code、IntelliJ IDEA、Terminal；Windows 提供资源管理器、
  VS Code、IntelliJ IDEA，以及 Windows Terminal 或 PowerShell 回退；Linux 提供
  文件管理器、VS Code、IntelliJ IDEA 和已检测到的终端模拟器。
- 应用缺失时在菜单中置灰。选择的默认启动目标保存在浏览器本地存储中。
- 进程启动使用参数数组和工作区 `cwd`，不通过 Shell 执行。

## 验证记录

- `uv run ruff check`（本次变更的 Gateway 文件）、前端 ESLint、Vite 生产构建及
  `git diff --check` 通过；Vite 构建保留了主 JS chunk 超过 500 KB 的提示。
- 未运行测试套件，也未实际启动桌面应用；当前验证主机为 macOS，Windows 启动行为
  尚未在 Windows 主机上实机确认。
