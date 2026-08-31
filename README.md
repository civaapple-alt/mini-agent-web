# Mini Agent Web & Python SDK Workspace

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python: 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![uv](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/uv/main/assets/badge/v0.json)](https://github.com/astral-sh/uv)
[![Code style: ruff](https://img.shields.io/badge/code%20style-ruff-000000.svg)](https://github.com/astral-sh/ruff)

`mini-agent-web` 是连接现代 Web 前端与 [Mini Agent Harness](https://github.com/civaapple-alt/mini-agent-harness) 的官方 Python SDK、实战示例与应用开发工作区。

它通过 Stdio JSON-RPC 2.0 协议与 `mini-agent-app-server` 高效通信，为 Python 开发者提供异步 Client SDK、全套实战 Cookbook 以及未来 Web / TUI 应用扩展底座。

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
> 运行全量 API 自动化测试套件。返回 `1 passed` 即表明 Python SDK 与 App Server 进程握手通信完全正常。

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

        # 实时推流 token 与工具调用事件
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

## 🖥️ 启动 Web Studio 前端界面与 API 网关

只需一条命令即可启动 FastAPI 网关并在浏览器中体验类似 Cursor / ChatGPT 的现代化交互界面：

```bash
# 启动 Web Studio (默认运行在 http://localhost:8000)
uv run mini-agent-web

# 或者使用 uvicorn 启动
uv run uvicorn server.app:app --host 0.0.0.0 --port 8000
```
> 打开浏览器访问 `http://localhost:8000` 即可进入 Web Studio 交互控制台；API 交互文档见 `http://localhost:8000/docs`。

---

## 📟 启动终端交互界面 (Terminal TUI)

无需打开浏览器，直接在终端中进行全功能交互：

```bash
# 启动基于 Rich 的终端 TUI
uv run mini-agent-tui
```

---

## 📂 项目目录结构

```text
mini-agent-web/
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
├── server/                    # FastAPI Web API Gateway
│   ├── app.py                 # FastAPI 应用入口、CORS、生命周期与静态挂载
│   ├── config.py              # 服务端环境与网络端口配置
│   ├── session_manager.py     # Client 连接池、多会话路由与安全审批握手调度
│   ├── main.py                # Uvicorn CLI 启动器
│   └── routes/                # REST / SSE / WebSocket 路由分发
│       ├── agent.py           # /api/agent/turn, /api/agent/stream, /ws/agent
│       ├── threads.py         # /api/threads (列表/新建/分支/检查点/关闭)
│       └── world.py           # /api/world, /api/mcp, /api/workflows
│
├── web/                       # 现代化单页 Web 前端 (Cursor / ChatGPT 风格)
│   ├── index.html             # 现代化单页界面 (Thinking 折叠/工具卡片/审批弹窗)
│   └── static/                # 静态样式与交互脚本
│       ├── app.css
│       └── app.js
│
├── tui/                       # Terminal UI (基于 Rich 的交互式终端客户端)
│   └── tui_app.py
│
├── cookbook/python-demo/      # 实战示例集
│   ├── 01_basic_turn.py               # 基础一问一答与生命周期
│   ├── 02_streaming_events.py         # 深度流式事件（Thinking/Tokens/多步工具）
│   ├── 03_approval_handling.py        # 敏感工具权限审批拦截
│   ├── 04_steering_and_interrupt.py   # 运行时动态转向与协作取消
│   └── 05_workflows_and_inspection.py # WorldState 快照与只读 Plan Mode
│
├── tests/                     # 自动化集成与单元测试套件
│   ├── test_gateway_api.py    # FastAPI REST / SSE 接口集成测试
│   └── test_sdk_apis.py       # pytest-asyncio 全量 SDK API 协议测试
│
├── docs/                      # 核心文档与架构记录
│   ├── README.md                              # 文档导航中心
│   ├── python-sdk-guide.md                    # 官方开发者指南
│   ├── sdk-maturity-and-protocol-coverage.md  # 协议覆盖与成熟度报告
│   ├── app-server-concurrency-and-deadlock-analysis.md # 并发死锁与加固剖析
│   └── adr/                                   # 架构决策记录 (ADR)
│
├── logs/                      # 运行时隔离日志 (git-ignored)
├── CHANGELOG.md               # 版本变更记录
├── pyproject.toml             # 根工作区配置 (包含 web/tui/dev 可选依赖)
├── uv.lock                    # 依赖锁定文件
└── .env.example               # 模型与服务端环境配置模板
```

---

## 📚 核心文档索引

* 📘 [**Python SDK 开发者指南 (`docs/python-sdk-guide.md`)**](docs/python-sdk-guide.md)：完整 API 说明、流式事件、审批拦截与错误处理。
* 📊 [**SDK 成熟度与协议覆盖报告 (`docs/sdk-maturity-and-protocol-coverage.md`)**](docs/sdk-maturity-and-protocol-coverage.md)：JSON-RPC 2.0 接口覆盖矩阵与测试验收。
* 🛠️ [**App Server 并发死锁与流式挂起根因剖析 (`docs/app-server-concurrency-and-deadlock-analysis.md`)**](docs/app-server-concurrency-and-deadlock-analysis.md)：Tokio 多线程、Actor 自锁、SSE Keep-Alive 与子进程隔离加固实录。
* 📜 [**版本更新日志 (`CHANGELOG.md`)**](CHANGELOG.md)：版本变更与功能演进记录。

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
| **运行单元测试** | `uv run pytest tests/ -v` | 执行自动化测试套件 |
| **代码格式与 Lint** | `uv run ruff check .` | 静态检查代码质量 |
| **执行 Cookbook 示例**| `uv run python cookbook/python-demo/01_basic_turn.py` | 运行实战演示 |
| **SDK 独立构建** | `uv build --package mini-agent` | 生成 wheel 与 tar.gz |

---

## 📄 开源协议 (License)

本项目基于 [MIT 许可证](LICENSE) 开源。欢迎社区开发者贡献与二次开发！
