# mini-agent-web

`mini-agent-web` 是 Mini Agent App Server 的 Python SDK、FastAPI 网关、Web
Studio、TUI 与 Cookbook 工作区。当前发布版本为 `0.7.0`，使用 JSON-RPC
wire protocol version `1`。

## 从哪里开始

| 目标 | 入口 |
| --- | --- |
| 使用或开发 Python SDK | [`sdk/python/README.md`](sdk/python/README.md) |
| 启动或修改 FastAPI 网关 | [`server/README.md`](server/README.md) |
| 开发 React Web Studio | [`frontend/README.md`](frontend/README.md) |
| 使用或修改终端 TUI | [`tui/README.md`](tui/README.md) |
| 运行示例 | [`cookbook/python-demo/README.md`](cookbook/python-demo/README.md) |
| 查看测试 | [`tests/README.md`](tests/README.md) |
| 查阅稳定运行文档 | [`docs/README.md`](docs/README.md) |
| 查阅架构决策 | [`.agents/notes/README.md`](.agents/notes/README.md) |

根 README 只负责项目定位和目录导航；进入目标目录后，继续阅读该目录的
README。贡献规则从 [`AGENTS.md`](AGENTS.md) 开始。

## 运行关系

```text
Web Studio (browser) ── REST / WebSocket ──> FastAPI Server ──> Python SDK ── Stdio JSON-RPC ──> App Server
TUI ── direct dependency ────────────────────────────────> Python SDK ── Stdio JSON-RPC ──> App Server
Cookbook ── direct dependency ──────────────────────────> Python SDK ── Stdio JSON-RPC ──> App Server
```

- App Server 拥有 Thread、Turn、Goal 与 ThreadItem 的运行时语义；
- Python SDK 是 TUI 和 Cookbook 的直接运行时依赖，负责进程连接、JSON-RPC、
  类型解析和有界事件流；
- Server 将 SDK 能力映射为 Web API 与 WebSocket；
- Web Studio 通过 Server 使用 Web API 与 WebSocket；TUI 和 Cookbook 直接使用
  Python SDK。

## 快速启动

需要 Python 3.10+、`uv`，以及可执行的 `mini-agent-app-server`。如果二进制
不在 `PATH`，设置 `MINI_AGENT_APP_SERVER_PATH`。

```bash
uv sync
uv run mini-agent-server
```

浏览器访问 `http://127.0.0.1:8000`。开发 Web Studio 时另开终端：

```bash
cd frontend
npm install
npm run dev
```

启动终端界面：

```bash
uv run mini-agent-tui
```

## 本地验证

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
npm --prefix frontend test
npm --prefix frontend run build
uv build --package mini-agent
```

默认验证不调用真实模型 Provider；需要 Provider 的示例只在 Cookbook 中显式
运行。

## 顶层目录

```text
sdk/python/           Python SDK
server/               FastAPI 网关
frontend/             React Web Studio
tui/                  终端交互界面
cookbook/python-demo/ 示例程序
tests/                Python 测试
docs/                 稳定运行与参考文档
.agents/notes/        架构决策与提案
```

MIT License。
