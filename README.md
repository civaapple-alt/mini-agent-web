# Mini Agent Web & Python SDK Workspace

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python: 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![uv](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/uv/main/assets/badge/v0.json)](https://github.com/astral-sh/uv)
[![Code style: ruff](https://img.shields.io/badge/code%20style-ruff-000000.svg)](https://github.com/astral-sh/ruff)

`mini-agent-web` 是连接现代 Web 前端与 [Mini Agent Harness](https://github.com/civaapple-alt/mini-agent-harness) 的官方 Python SDK 0.7.0、实战示例与应用开发工作区。

它通过 Stdio JSON-RPC 2.0 协议与 `mini-agent-app-server` 高效通信，为 Python 开发者提供异步 Client SDK、全套实战 Cookbook 以及未来 Web / TUI 应用扩展底座。

当前发布版本为 `0.7.0`，对应 JSON-RPC wire protocol version `1`。SDK、App Server、FastAPI 网关、Frontend 和 TUI 的版本信息保持同步。

0.7.0 对齐 App Server 的 Thread/Turn/Item 语义：线程设置使用
`thread/settings/update`，目标使用 `thread/goal/set|get|clear`，Turn 事件可携带
`ThreadItem` 投影，并通过 `item/started` / `item/completed` 与
`thread/items/list` 提供生命周期和分页回放；Studio、TUI、Server 和 Cookbook
均消费这套新边界。`workflow/state` 仅在 Gateway 作为只读聚合投影保留。

---

## 🏛️ 架构示意

```text
┌─────────────────────────────────────────────────────────────┐
│                 Python Application / Web API                │
│       (FastAPI / WebSocket / CLI Cookbook / Streamlit)      │
└──────────────────────────────┬──────────────────────────────┘
                               │ import mini_agent
┌──────────────────────────────▼──────────────────────────────┐
│                  Official Python SDK (mini-agent)           │
│  ├── MiniAgentClient / AsyncMiniAgentClient (client.py)     │
│  ├── Typed Event Hierarchy (events.py, parse_event)         │
│  ├── Protocol Dataclasses (types.py, ThreadCheckpoint)      │
│  └── Error Hierarchy (errors.py, AppServerError)            │
└──────────────────────────────┬──────────────────────────────┘
                               │ Stdio JSON-RPC 2.0 (JSONL)
┌──────────────────────────────▼──────────────────────────────┐
│                  mini-agent-app-server.exe                  │
│    (Actor Control Plane, Revision CAS, State Management)    │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                   Mini Agent Execution Core                 │
│         (Model inference, Bounded Tools, Compaction)        │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 快速上手（基于 uv）

### 0. 前置准备
* **Python 与 uv 环境**：
  * Python $\ge$ 3.10
  * 安装 `uv`（现代极速 Python 包管理）：
    * Windows (PowerShell): `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`
    * Linux / macOS: `curl -LsSf https://astral.sh/uv/install.sh | sh`
* **App Server 服务端就绪**：
  * 本 SDK 需要与 Rust 后端服务 `mini-agent-app-server` 建立进程通信。
  * 服务端源码与编译指引参见：[**mini-agent-harness**](https://github.com/civaapple-alt/mini-agent-harness)。
  * 确保编译生成的 `mini-agent-app-server.exe`（或 Linux 下 `mini-agent-app-server`）已加入系统 `PATH`，或者在 `.env` 中通过 `MINI_AGENT_APP_SERVER_PATH` 显式指定其路径。

### 1. 配置模型凭证与环境文件
```bash
# 复制环境配置文件模板
# Windows PowerShell:
Copy-Item .env.example .env

# Linux / macOS:
cp .env.example .env
```
> 打开 `.env` 填入你的大模型 API 密钥（默认支持 DeepSeek / OpenAI / GLM 等任意兼容服务）。

### 2. 一键同步环境与 SDK (Editable 本地挂载)
```bash
uv sync
```
> `uv` 将自动创建虚拟环境，挂载可编辑的 `mini-agent` SDK，并自动安装测试工具链。

### 3. 通信与协议自测 (零 Token 消耗)
```bash
uv run pytest
```
> 运行全量 API 自动化测试套件。测试会验证 SDK 与 0.7.0 App Server 的握手和管理 API；需要 live Provider 的 Cookbook 不在默认测试中执行。若 App Server 不在 `PATH`，请先设置 `MINI_AGENT_APP_SERVER_PATH`。

只运行无 Provider、无 Token 的 Cookbook 协议验证：

```bash
uv run pytest tests/test_cookbook_validation.py -q
```

### 4. 运行首个实战示例
```bash
uv run python cookbook/python-demo/01_basic_turn.py
```

---

## 💻 SDK 使用示例

```python
import asyncio
from mini_agent import MiniAgentClient


async def main():
    # 自动加载 .env，自动将执行日志写入 logs/
    async with MiniAgentClient(log_dir="logs") as client:
        await client.initialize(profile="interactive")
        await client.start_thread()

        # 实时推流 token、审批 requested/resolved 与工具调用事件
        async for event in client.stream_turn(
            "请列出当前目录下的所有文件并给出简短总结"
        ):
            if event["type"] == "event":
                typed = event["typed_event"]
                if typed.event_type == "assistant_text_delta":
                    print(typed.delta, end="", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
```

---

## 🖥️ 服务与前端启动命令速查

本项目提供了清晰区分的命令行入口：

| 命令 | 启动目标 | 监听端口 | 热重载 (HMR) | 适用场景 | 访问入口 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`uv run mini-agent-server`** | **后端 API 网关服务** | `8000` | ❌ 静态托管 | 生产体验、API 服务、单一进程开箱即用 | `http://localhost:8000`<br>*(API 文档: `/docs`)* |
| **`uv run mini-agent-server-dev`** | **后端开发服务** | `8000` | ⚡ Python 热重载 | 修改 Python 后端代码、调试 API 接口 | `http://localhost:8000`<br>*(API 文档: `/docs`)* |
| **`cd frontend && npm run dev`** | **前端开发服务器** | `5173` | ⚡ Vite 毫秒热更 | 修改 React 前端代码、调试 UI 组件与样式 | `http://localhost:5173`<br>*(自动代理 8000 后端)* |
| **`uv run mini-agent-tui`** | **终端 TUI 交互客户端** | - | - | 纯命令行环境交互与权限审批 | 终端直接交互 |

---

### 🎯 场景 1：直接使用 / 体验 Web Studio（只开 1 个终端）
后端 FastAPI 会自动托管编译好的 React 前端静态包，**无需任何 Node.js 进程**：

```bash
# 启动生产级后端 API 网关（Port 8000，开箱即用）
uv run mini-agent-server
```
> 打开浏览器访问 `http://localhost:8000` 即可进入 Web Studio；API 交互文档见 `http://localhost:8000/docs`。

---

### 🛠️ 场景 2：全栈二次开发与实时热重载（开 2 个终端）
当你正在修改 Python 后端或 React 前端源码时：

```bash
# 终端 1：启动带自动重载的 Python 后端（Port 8000，修改 Python 代码自动重启）
uv run mini-agent-server-dev

# 终端 2：启动前端 Vite 开发服务器（Port 5173，修改 JSX/CSS 毫秒级热更）
cd frontend
npm run dev
```
> 打开浏览器访问 `http://localhost:5173` 即可享受毫秒级热更新开发体验。

> [!TIP]
> **❓ 为什么 8000 已经能看网页了，开发时还需要 5173？**
> * **8000 端口（生产产物）**：读取的是 `frontend/dist/` 下**已经打包固化**的静态文件。如果直接访问 8000，你修改 `src/App.jsx` 代码后**刷新页面不会有任何变化**（除非手动重新 `npm run build`）。
> * **5173 端口（开发源码）**：由 Vite 实时编译 `frontend/src/` 中的源码，支持保存代码即时热重载（HMR），大幅提升前端开发调试效率。

---

## 🎨 Web Studio 核心交互特色 (Codex 1:1 对齐)

Web Studio 采用现代 IDE 交互范式，深度对齐 Codex 交互体系：

1. **多工作区与项目导航树 (Multi-Root Workspaces)**：
   * **当前工作区默认自启**：首次启动严格绑定当前所在的本地项目（`Path.cwd()`），无任何冗余 Mock 假数据。
   * **原生文件夹选择器 (`Select Project Root`)**：新建项目或添加源目录时，一键调出操作系统本地资源管理器窗口，直接点选本地路径。
   * **3 层浮动交互体系**：
     * **项目悬停卡片**：悬停展示项目多源目录列表、任务计数统计与快捷置顶 (`📌`)。
     * **编辑项目弹窗**：支持多文件夹绑定、`[主要]` 主目录切换、文件夹删除与本地解除绑定。
     * **创建项目弹窗**：对齐官方空态占位，支持自动生成 `README.md` 与创建初始会话。
2. **重构极简 Composer 输入区**：
   * **左上工作流模式切换**：默认模式 (Default)、计划模式 (Plan Mode, `/plan`)、目标模式 (Goal Mode, `/goal`)。
   * **左下安全审批与 Profile 切换**：快速切换 `per_action` / `auto_approve` / `strict` 审批策略，以及 `interactive` / `autonomous` 运行画像。
   * **实时纠偏与打断 (Steer / Stop)**：执行中输入框自动转化为动态纠偏输入，配合停止按钮实现零等待协同交互。
3. **原子级磁盘持久化 (`~/.mini-agent/state.json`)**：
   * 所有新增工作区、多源文件夹关联、主要目录标记、会话标题与摘要均持久化在本地磁盘，重启服务后无缝恢复。

---

## 📟 启动终端交互界面 (Terminal TUI)

无需打开浏览器，直接在终端中进行全功能交互，体验现代化终端结对工作台：

```bash
# 启动基于 prompt_toolkit + Rich 的现代化终端 Studio
uv run mini-agent-tui

# 带有自定义参数启动 (支持 --profile, --policy, --effort, --thread)
uv run mini-agent-tui --profile autonomous --policy auto_approve --effort high
```

* **智能补全**：支持 Tab 键自动补全斜杠命令与二级参数候选菜单；
* **快捷按键**：输入框有内容时按 `Ctrl+C` 一键清空当前行，输入框为空时按 `Ctrl+C` 优雅退出；
* **命令集锦**：支持 `/plan`、`/goal`、`/steer`、`/policy`、`/fork`、`/mcp`、`/git`、`/status` 等 15+ 个内置命令；
* **详细文档**：参见 [**`tui/README.md`**](tui/README.md)。

---

## 📂 项目目录结构

```text
mini-agent-web/
├── AGENTS.md                 # 协作规范与变更准入要求
├── sdk/python/                # 官方 Python SDK (包名: mini-agent)
│   ├── src/mini_agent/
│   │   ├── __init__.py        # 公共导出 (MiniAgentClient, setup_logging 等)
│   │   ├── client.py          # 异步 JSON-RPC 客户端、进程管理、流式推流
│   │   ├── events.py          # 强类型事件体系与 parse_event 解析器
│   │   ├── types.py           # 协议数据类 (TurnSubmissionResult, ModelUsage 等)
│   │   ├── errors.py          # 结构化异常层次树 (MiniAgentError, AppServerError)
│   │   └── py.typed           # PEP 561 类型检查标记
│   └── pyproject.toml         # SDK 独立打包规范 (零外部依赖)
│
├── frontend/                  # React 18 + Vite 现代化 SPA 前端工程 (参见 frontend/README.md)
│   ├── package.json           # React, Lucide-React, React-Markdown, Remark-Gfm
│   ├── vite.config.js         # Vite 反向代理 (/api 与 /ws 到 8000 端口)
│   ├── index.html             # 前端 HTML 入口
│   └── src/                   # 组件库 (ChatArea, ToolCard, ThinkingBlock, ApprovalDialog, SidePanel)
│
├── server/                    # FastAPI Web API Gateway (参见 server/README.md)
│   ├── app.py                 # FastAPI 应用入口、CORS、生命周期与静态资源托管
│   ├── config.py              # 服务端环境与网络端口配置
│   ├── session_manager.py     # App Server 子进程生命周期、连接池与 WebSocket 分发池
│   ├── main.py                # Uvicorn CLI 启动器
│   └── routes/                # REST 路由 (agent.py, threads.py, world.py, settings.py)
│
├── tui/                       # Terminal TUI 交互式终端工作室 (参见 tui/README.md)
│   ├── state.py               # 会话状态管理与 UTF-8 控制台配置
│   ├── approvals.py           # 安全审批拦截与策略评估 ([y]es / [n]o / [a]lways)
│   ├── completer.py           # Tab 自动补全与二级参数联想菜单
│   ├── commands.py            # 斜杠命令分发与环境自省 (/plan, /goal, /steer, /mcp, /fork 等)
│   ├── stream_renderer.py     # 思考链、文本打字机流式渲染与上下文压缩感知
│   └── tui_app.py             # 极简 CLI 入口与自愈探针调度
│
├── cookbook/python-demo/      # 实战示例集 (参见 cookbook/python-demo/README.md)
│   ├── 01_basic_turn.py               # 基础一问一答与生命周期
│   ├── 02_streaming_events.py         # 深度流式事件（Thinking/Tokens/多步工具）
│   ├── 03_approval_handling.py        # 敏感工具权限审批拦截
│   ├── 04_steering_and_interrupt.py   # 运行时动态转向与协作取消
│   ├── 05_workflows_and_inspection.py # WorldState 快照、MCP 状态与只读 Plan Mode
│   └── 06_protocol_compatibility.py   # 0.7.0 事件与 ThreadItem 无 Token 验证
│
├── tests/                     # 自动化集成与单元测试套件 (参见 tests/README.md)
│   ├── test_cookbook_validation.py # Cookbook 编译与无 Token 协议验证
│   ├── test_gateway_api.py    # FastAPI REST 与 WebSocket 接口集成测试
│   ├── test_sdk_apis.py       # pytest-asyncio 全量 SDK API 协议测试
│   └── test_sdk_events.py     # 0.7.0 事件、ThreadItem 与 Thread/Turn 分流测试
│
├── .agents/notes/             # 架构决策记录 (ADR) 与设计笔记
│   ├── README.md              # 架构笔记索引与维护门禁
│   ├── implemented/           # 已落地的架构、特性、并发加固与测试报告
│   └── proposed/              # 规划中与评审中的提案路线图
│
├── docs/                      # 核心运维与开发者文档
│   ├── README.md              # 文档导航中心
│   ├── limits.md              # 运行边界与硬限制规范
│   ├── privacy.md             # 数据主权与隐私安全
│   ├── releasing.md           # 版本发布流程与门禁
│   ├── troubleshooting.md     # 常见故障排查指南
│   └── python-sdk-guide.md    # 官方 Python SDK 开发者指南
│
├── logs/                      # 运行时隔离日志 (git-ignored)
├── CHANGELOG.md               # 版本变更记录
├── pyproject.toml             # 根工作区配置 (包含 web/tui/dev 可选依赖)
├── uv.lock                    # 依赖锁定文件
└── .env.example               # 模型与服务端环境配置模板
```

---

## 📚 模块文档中心与索引

### 核心操作与指南 (`docs/`)
* 🛡️ [**运行边界与硬限制 (`docs/limits.md`)**](docs/limits.md)：输入限制、流式输出、工具结果、轮次步数与帧大小硬边界。
* 🔒 [**数据与隐私保护 (`docs/privacy.md`)**](docs/privacy.md)：零外部遥测、本地日志流向、API 凭证防泄露与审批机制。
* 🚀 [**版本发布流程 (`docs/releasing.md`)**](docs/releasing.md)：全栈多模块版本同步、自动化门禁测试与 Git 标签发布规范。
* 🛠️ [**故障排查指南 (`docs/troubleshooting.md`)**](docs/troubleshooting.md)：App Server 丢失、端口冲突、WebSocket 断连与 401 鉴权故障自愈。
* 📘 [**Python SDK 开发者指南 (`docs/python-sdk-guide.md`)**](docs/python-sdk-guide.md)：完整 API 说明、流式推流、审批拦截与运行时动态控制。
* 📟 [**终端 TUI 工作室文档 (`tui/README.md`)**](tui/README.md)：架构分层、Tab 补全、`/steer` 实时纠偏、`/fork` 分支与命令参考。
* 🎨 [**Web UI 前端工程文档 (`frontend/README.md`)**](frontend/README.md)：React 19 组件树、ThinkingBlock、ToolCard、Toast 通知与 WebSocket API。
* 🌐 [**FastAPI 网关服务文档 (`server/README.md`)**](server/README.md)：RESTful API、`/ws/agent` 双向全双工通道与 `SessionManager` 连接管理。
* 🧪 [**自动化测试套件文档 (`tests/README.md`)**](tests/README.md)：零 Token 消耗、AST 语法编译、网关与事件测试。
* 🧪 [**Cookbook 实战与协议验证 (`cookbook/python-demo/README.md`)**](cookbook/python-demo/README.md)：Demo 01–05 的 live 运行边界与 Demo 06 协议验证。
* 🤝 [**贡献者与变更准入规则 (`AGENTS.md`)**](AGENTS.md)：版本同步、测试规范与变更准入要求。
* 📜 [**版本更新日志 (`CHANGELOG.md`)**](CHANGELOG.md)：版本变更与功能演进记录。

### 架构决策与设计笔记 (`.agents/notes/`)
* 🏛️ [**架构设计笔记总索引 (`.agents/notes/README.md`)**](.agents/notes/README.md)：全景记录 ADR 决策、架构雷达与提案演进。
* 📈 [**客户端架构与性能全景对比**](.agents/notes/implemented/architecture/2026-09-02-client-architectures-and-performance-comparison.md)：Rust REPL、Python TUI 与 Web Studio 多维度深度对比分析。
* 🛠️ [**App Server 并发死锁与加固**](.agents/notes/implemented/bug-fix/2026-08-31-app-server-concurrency-and-deadlock-analysis.md)：Tokio 运行时阻塞、Transport Actor 自锁、SSE Keep-Alive 挂起及子进程隔离根治。
* 🏛️ [**SDK 0.7.0 适配评审与控制面演进**](.agents/notes/implemented/architecture/2026-09-03-sdk-0.7.0-alignment-review-and-control-plane-evolution.md)：系统评审 0.7.0 适配成效，解耦运行时线程绑定，落地 Builtin Tools 选择器与全量 ThreadItem 投影。
* 🌐 [**Local Web Studio 演进路线提案**](.agents/notes/proposed/feature/2026-09-02-local-web-studio-evolution-and-roadmap.md)：分阶段完善有界 Diff/Artifact、工作区树、loopback 预览、Goal 投影与安全审批。
* 💡 [**Tauri 原生桌面 Shell 提案**](.agents/notes/proposed/architecture/2026-09-02-tauri-desktop-app-and-app-server-integration.md)：以 App Server sidecar 为首选，规划 React transport、桌面原生能力与平台降级。
* 📟 [**Rust 原生 TUI 架构提案**](.agents/notes/proposed/architecture/2026-09-02-rust-native-tui-ratatui-architecture.md)：基于 Ratatui + Tokio + TEA reducer 的全屏 TUI 方案。

---

## 🛠️ 开发者指南与测试 (Development & Testing)

### 1. 安装全量开发环境

```bash
# 安装包含 dev (Pytest/Ruff), web (FastAPI), tui (Rich) 在内的所有开发依赖
uv sync --all-extras
```

### 2. 运行 Pytest 自动化测试套件

本项目在 `tests/` 目录下提供了基于 `pytest-asyncio` 的全套 API 自动化集成测试套件（覆盖 Thread 分支管理、Plan Mode、Multi-Milestone Goal 工作流、WorldState 环境快照与 MCP 服务交互）：

```bash
# 运行全量单元与集成测试
uv run pytest

# 详细输出模式 (Verbose)
uv run pytest tests/ -v

# 打印实时调试日志与标准输出
uv run pytest tests/ -s -vv

# 运行特定测试文件
uv run pytest tests/test_sdk_apis.py
```

0.7.0 发布验证还包含 SDK 事件、ThreadItem、Thread/Turn 分流和全部 Cookbook 脚本编译检查：

```bash
uv run pytest tests/test_sdk_events.py tests/test_cookbook_validation.py -q
```

### 3. 代码质量与规范检查

在提交代码前，请确保通过 Ruff 静态检查与格式化：

```bash
# 代码规范与 Lint 检查
uv run ruff check .

# 自动修复可修复的 Lint 错误
uv run ruff check . --fix

# 代码自动格式化
uv run ruff format .
```

### 4. SDK 独立构建与打包

`sdk/python` 是一个独立的 Hatchling 包，支持单独构建 wheel / sdist 发布包：

```bash
# 构建 mini-agent SDK 安装包
uv build --package mini-agent
```

---

## 📦 依赖组与开发常用命令速查

| 场景 / 操作 | 对应命令 | 说明 |
| :--- | :--- | :--- |
| **基础环境同步** | `uv sync` | 安装 SDK 基础依赖 |
| **全量开发环境** | `uv sync --all-extras` | 安装 web + tui + dev 全套工具链 |
| **运行后端测试** | `uv run pytest tests/ -v` | 执行 46 项后端 API / 网关 / 契约自动化测试 |
| **运行前端测试** | `cd frontend && npm test` | 执行 10 项前端模块与流式状态机单元测试 |
| **前端打包构建** | `cd frontend && npm run build` | Vite 生产打包并生成 `frontend/dist/` |
| **代码格式与 Lint** | `uv run ruff check .` | 静态检查代码质量 |
| **执行 Cookbook 示例**| `uv run python cookbook/python-demo/01_basic_turn.py` | 运行实战演示 |
| **SDK 独立构建** | `uv build --package mini-agent` | 生成 wheel 与 tar.gz |

---

## 📄 开源协议 (License)

本项目基于 [MIT 许可证](LICENSE) 开源。欢迎社区开发者贡献与二次开发！
