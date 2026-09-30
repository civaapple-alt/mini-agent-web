# 本机打开项目工作区

Web Studio 顶栏右上角的打开方式按钮包含默认应用图标和下拉箭头。点击应用图标会
打开当前默认应用。点击箭头会显示本机可用的打开方式。选择其他应用后，该应用成为
新的默认项，设置保存在浏览器本地存储中。

| 目标 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| 文件管理器 | Finder | 文件资源管理器 | 文件管理器 |
| 编辑器 | VS Code | VS Code | VS Code |
| IDE | IntelliJ IDEA | IntelliJ IDEA | IntelliJ IDEA |
| 终端 | Terminal | Windows Terminal，或 PowerShell | 已检测到的终端模拟器 |

Gateway 检测不到的应用会在菜单中置灰。Windows 会检查 VS Code 和 IntelliJ IDEA 的
常见安装位置，也会查找 `PATH` 中的启动器。选择 Windows Terminal 时，Gateway 会在
项目主目录启动它。Windows Terminal 不可用时，Gateway 会在新窗口启动 PowerShell。

## Gateway API

`GET /api/world/open-targets` 返回固定目标和本机可用状态。打开工作区时，Web Studio
调用 `POST /api/world/open-project?project_id=...`，请求体只包含目标 ID，例如
`{"target":"vscode"}`。

Gateway 使用 Project 注册表解析 `project_id` 对应的主工作区。请求不接受浏览器提交的
任意路径、命令或可执行文件。Gateway 通过参数数组启动应用，不经过 Shell。终端进程的
工作目录是项目主工作区。

Gateway 在运行 Web Studio 的主机上启动应用。浏览器若连接远程 Gateway，应用会在
Gateway 主机启动，而不是在浏览器所在的设备启动。
