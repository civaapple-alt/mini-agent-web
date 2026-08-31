# Mini Agent Web & Python SDK Workspace

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

本项目内置 `uv` 虚拟环境与依赖管理配置，并支持通过 `.env` 配置文件注入模型密钥：

```bash
# 1. 复制环境配置模板并填写 API Key (DeepSeek / OpenAI / GLM 等)
# Windows PowerShell:
Copy-Item .env.example .env

# Linux / macOS:
cp .env.example .env

# 2. 一键同步环境与 SDK (无需手动激活虚拟环境)
uv sync

# 3. 运行基础示例
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
        async for event in client.stream_turn("请列出当前目录下的所有文件并给出简短总结"):
            if event["type"] == "event":
                typed = event["typed_event"]
                if typed.event_type == "assistant_text_delta":
                    print(typed.delta, end="", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
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
├── cookbook/python-demo/      # 实战示例集
│   ├── 01_basic_turn.py               # 基础一问一答与生命周期
│   ├── 02_streaming_events.py         # 深度流式事件（Thinking/Tokens/多步工具）
│   ├── 03_approval_handling.py        # 敏感工具权限审批拦截
│   ├── 04_steering_and_interrupt.py   # 运行时动态转向与协作取消
│   └── 05_workflows_and_inspection.py # WorldState 快照与只读 Plan Mode
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

## 📦 依赖组与开发命令

| 场景 | 命令 |
| :--- | :--- |
| **安装基础 SDK 环境** | `uv sync` |
| **安装 Web 开发依赖** (FastAPI / WebSockets) | `uv sync --extra web` |
| **安装 TUI 终端依赖** (Rich) | `uv sync --extra tui` |
| **安装代码检查与测试依赖** (Pytest / Ruff) | `uv sync --extra dev` |
| **代码格式与类型检查** | `uv run ruff check .` |
