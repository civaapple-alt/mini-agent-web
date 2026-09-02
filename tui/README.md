# Mini Agent Terminal User Interface (TUI) Studio

`tui` 是 `mini-agent-web` 工作区内为终端开发者打造的现代化纯文本 / TUI 交互工作台。它通过异步 Python SDK 直接连接 `mini-agent-app-server`，提供与 Web UI 等价的完整核心能力与沉浸式人机结对协作体验。

---

## 🌟 核心特性

- **⚡ 模块化架构**：从单文件解耦为 `state`、`approvals`、`completer`、`commands`、`stream_renderer` 与 `tui_app` 六大单一职责模块。
- **⌨️ 智能 Tab 补全与二级联想**：集成 `prompt_toolkit`，支持斜杠命令前缀提示与二级参数（如 `/policy auto_approve`、`/effort high`）浮动候选菜单。
- **🧠 思考链与文本打字机流式渲染**：支持 `💭 Thinking:` 暗淡斜体思考流与响应正文实时推流。
- **🔍 深度工具透明度与错误诊断**：
  - 工具调用时显示**入参简要**：`⚡ Tool started: shell(command='pytest')`；
  - 工具完成时展示**输出预览**与截断标识；
  - 工具报错显式呈现**红色报错徽章**（`✗ Tool failed: ...`），杜绝误报绿色 ✓；
  - 运行时失败（`run_failed`）显式呈现**结构化原因**（`⛔ Run failed: ...`），杜绝无声丢弃。
- **📊 轮次结算遥测（Turn Settlement Telemetry）**：每轮结束自动输出状态、执行步数、停止原因与 Token 消耗（`Status | Steps | Stop | Tokens`），并沉淀至 `/status`。
- **🛡️ 交互式安全审批与策略引擎**：敏感操作拦截弹窗，支持 `[y]es`、`[n]o` 与 `[a]lways`（会话级工具放行记忆），支持 `/policy`（`per_action` / `auto_approve` / `strict`）动态切换。
- **🎯 实时纠偏与协作中断**：
  - `/steer <指令>`：在模型长推理中动态注入纠偏指令（Steering Guidance）。
  - `Ctrl+C` 智能清空：输入框有内容时按 `Ctrl+C` 立即清空当前缓冲行（Reset Buffer）；输入框为空时按 `Ctrl+C` 优雅退出；模型执行中按 `Ctrl+C` 仅中断当前轮次并保留历史。
- **🌿 会话与多分支管理**：支持 `/threads`（列出会话）、`/new`（新建线程）、`/fork`（分叉当前历史到新分支）、`/switch`（切换线程）与 `/history`（查看 Checkpoint）。
- **🔍 环境与工作流自省**：支持 `/status`（服务与配置状态）、`/mcp`（MCP 工具诊断）、`/git`（工作区分支与变更）、`/files`（快速文件检索）、`/workflows`（计划探测）、`/plan`（Thread collaboration mode）与 `/goal`（Thread Goal Runtime）。
- **🛡️ 双模自适应降级**：在真实终端（TTY）中提供完整 UI 与快捷键；在自动化脚本、管道重定向（Non-TTY / Headless）环境中自动降级为标准输入行读取，稳定不崩溃。

---

## 📂 模块结构

```text
tui/
├── __init__.py          # 模块级公共接口导出 (TUIState, console, main, run_tui)
├── state.py             # 会话状态类 (TUIState) 及跨平台 UTF-8 Console 配置
├── approvals.py         # 安全审批策略评估与交互确认面板 ([y]es / [n]o / [a]lways)
├── completer.py         # 智能 Tab 补全器与二级参数上下文联想 (SlashCommandCompleter)
├── commands.py          # 斜杠命令分发器与帮助表格 (/plan, /goal, /policy, /effort 等)
├── stream_renderer.py   # 思考流、文本流、工具状态实时渲染与上下文压缩提示
└── tui_app.py           # 极简主入口、CLI 参数解析器与自愈探针 (~120 行)
```

---

## 🚀 快速启动

### 1. 安装与进入环境
```bash
# 在 mini-agent-web 根目录下
uv sync
```

### 2. 交互式启动
```bash
# 使用默认配置启动 (interactive 模式, per_action 审批, medium 思考)
uv run mini-agent-tui

# 或直接通过 Python 模块启动
uv run python -m tui.tui_app
```

### 3. 自定义启动参数 (CLI Flags)
```bash
# 指定初始 Profile、审批策略与思考强度
uv run mini-agent-tui --profile auto --policy auto_approve --effort high --thread my-branch
```

#### 参数一览：
| 参数 | 缩写 | 可选值 | 默认值 | 描述 |
| :--- | :---: | :--- | :--- | :--- |
| `--profile` | `-p` | `interactive`, `auto`, `ask` | `interactive` | 启动系统 Profile |
| `--policy` / `--approval-policy` | `-a` | `per_action`, `auto_approve`, `strict` | `per_action` | 工具安全审批策略 |
| `--effort` | `-e` | `low`, `medium`, `high` | `medium` | 模型思考链强度 |
| `--thread` | `-t` | `<字符串>` | `default` | 初始会话线程 ID |

Bundled App Server 0.7.0 binds `thread/settings/update` and Goal Runtime to the
`default` runtime Thread. The TUI may still use `--thread` or `/switch` for
conversation history; `/profile`, `/plan`, and `/goal` explicitly target the
bound runtime Thread so switching conversations does not break workflow control.

---

## 📖 斜杠命令参考大全 (`/help`)

| 分类 | 命令 / 格式 | 功能说明 |
| :--- | :--- | :--- |
| **工作流模式** | `/plan [on\|off]` | 设置 runtime Thread collaboration mode（Plan 为只读架构与方案探索；Shell 仅允许受控只读探查） |
| | `/goal <目标描述>` | 设置 runtime Thread Goal，由 Goal Runtime 自动推进 |
| | `/goal` | 查看当前 Goal 状态、Token 与时间预算 |
| | `/workflows` | 探测工作区内规范与计划文件（`plan.md`, `AGENTS.md`） |
| **模型与思考** | `/effort [low\|med\|high]` | 查看或切换思考链强度 |
| | `/steer <纠偏指令>` | 向当前轮次检查点注入实时纠偏，或以 Follow-up 发送引导指令 |
| **安全与审批** | `/policy [mode]` | 切换审批策略（`per_action`, `auto_approve`, `strict`） |
| | `/clear-approvals` | 清空本会话已记住的工具放行白名单缓存 |
| | `/profile [mode]` | 查看系统 Profile 对照表或切换 Profile |
| **会话管理** | `/threads` | 列出所有历史会话与分支列表 |
| | `/new [thread_id]` | 新建并切换至新会话线程 |
| | `/fork <new_id>` | 分叉当前会话历史为新的实验分支 |
| | `/switch <thread_id>` | 切换当前活跃会话线程 |
| | `/history` | 查看当前会话已结算 Checkpoint 与轮次元数据 |
| **工作区探测** | `/status` | 查看运行时环境、Server 状态与配置总览 |
| | `/mcp` | 查看已启用的 MCP 服务与扩展工具状态 |
| | `/git` | 查看当前工作区 Git 分支及未提交变更 |
| | `/files [query]` | 快速检索当前工作区代码文件路径 |
| | `!<command>` | 直接在宿主终端执行本地 Shell 命令 (如 `!git status`, `!cargo test`) |
| **通用控制** | `/copy` | 复制模型最新回复/文档 Markdown 到系统剪贴板 (别名: `/cp`) |
| | `/clear` | 清空终端屏幕 |
| | `/help` | 显示完整命令参考大全 |
| | `/exit` / `/quit` | 退出 TUI 交互终端 |

---

## 🧪 自动化测试与质量保障

```bash
# 代码风格与 Lint 检查
uv run ruff check tui/

# 运行自动化测试套件
uv run pytest tests/ -v
```
