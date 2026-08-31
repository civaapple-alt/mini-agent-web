# Mini Agent Web & Python SDK Workspace

`mini-agent-web` 是连接现代 Web 前端与 [Mini Agent Harness](https://github.com/civaapple-alt/mini-agent-harness) 的 Python SDK、示例与工作区。

它通过 Stdio JSON-RPC 2.0 协议连接 `mini-agent-app-server`，为 Python 开发者提供异步 Client SDK、实战 Cookbook 以及未来 Web/TUI 扩展底座。

---

## 架构示意

```text
┌─────────────────────────────────────────────────────────────┐
│                 Python Application / Web API                │
│       (FastAPI / WebSocket / CLI Cookbook / Streamlit)      │
└──────────────────────────────┬──────────────────────────────┘
                               │ Async JSON-RPC over stdin/stdout
                               │ (MiniAgentClient in client.py)
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

## 快速上手（基于 uv）

本项目内置 `uv` 虚拟环境与依赖管理配置，并支持通过 `.env` 配置文件注入模型密钥：

```bash
# 1. 复制环境配置模板并填写 API Key (DeepSeek / OpenAI / GLM 等)
# Windows PowerShell:
Copy-Item .env.example .env

# Linux / macOS:
cp .env.example .env

# 2. 一键运行基础 Demo (无需手动 activate 虚拟环境)
uv run python cookbook/python-demo/01_basic_turn.py
```

---

## 目录结构

* [`cookbook/python-demo/`](cookbook/python-demo/): 包含全套异步 Python Client SDK 与实操 Demo。
  * `client.py`: 核心客户端 SDK，支持会话生命周期、流式事件、审批拦截与运行控制。
  * `01_basic_turn.py`: 基础对话轮次调用。
  * `02_streaming_events.py`: 深度流式事件监听（推理/步骤/工具/Token用量）。
  * `03_approval_handling.py`: 敏感工具（文件写/Shell）权限审批拦截。
  * `04_steering_and_interrupt.py`: 运行时中途插入指令（Steer）与中断（Interrupt）。
  * `05_workflows_and_inspection.py`: 环境快照（WorldState）、只读 Plan Mode 与线程检查点读取。
* `pyproject.toml`: 现代 Python 工程规范，预置 `web`、`tui`、`dev` 可选依赖组。
* `.python-version`: 锁定 Python 3.12。

---

## 依赖与环境管理

| 场景 | 命令 |
| :--- | :--- |
| **执行示例脚本** | `uv run python cookbook/python-demo/01_basic_turn.py` |
| **安装 Web 开发依赖** (FastAPI / WebSockets) | `uv sync --extra web` |
| **安装开发调试依赖** (Pytest / Ruff) | `uv sync --extra dev` |
| **传统 venv 模式** | `python -m venv .venv` && `pip install -e .` |
