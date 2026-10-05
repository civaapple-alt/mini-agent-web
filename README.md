# mini-agent-web

`mini-agent-web` 是 Mini Agent 运行系统的用户侧控制平面适配层，包含 FastAPI 网关
和 Web Studio，并保留实验性 TUI。Web Studio 面向项目和
长时间运行的 Session，负责把 App Server 的执行状态、审批、恢复、Child Session、
Notebook 和运行事件变成可操作、可观察的工作台。当前发布版本为 `1.0.0`，协商
App Server protocol version `2`，请求使用 JSON-RPC 2.0 envelope。升级兼容性见
[`Harness App Server 文档`](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/app-server.md)。

本仓不创建第二条 Agent 执行循环。App Server、Host 和 Capabilities 保持运行时、
准入和副作用的权威；SDK、Gateway 和 Web Studio 负责连接、投影、控制和用户交互。

## 从哪里开始

| 目标 | 入口 |
| --- | --- |
| 启动或修改 FastAPI 网关 | [`server/README.md`](server/README.md) |
| 开发 React Web Studio | [`frontend/README.md`](frontend/README.md) |
| 验证 Python SDK/App Server 的实验性 TUI | [`tui/README.md`](tui/README.md) |
| 查看测试 | [`tests/README.md`](tests/README.md) |
| 查阅稳定运行文档 | [`docs/README.md`](docs/README.md) |
| 了解怎样创建交互式 Agent 会话 | [`docs/blogs/how-to-create-interactive-agent-session.md`](docs/blogs/how-to-create-interactive-agent-session.md) |
| 查阅架构决策 | [`.agents/notes/README.md`](.agents/notes/README.md) |

根 README 只负责项目定位和目录导航；进入目标目录后，继续阅读该目录的
README。贡献规则从 [`AGENTS.md`](AGENTS.md) 开始。

## 运行关系

```text
Web Studio (browser) ── REST / WebSocket ──> FastAPI Server ──> Python SDK ── Stdio JSON-RPC ──> App Server
Experimental TUI ── direct dependency ──────────────────> Python SDK ── Stdio JSON-RPC ──> App Server
```

- App Server 拥有 Thread、Turn、Goal 与 ThreadItem 的运行时语义；
- Python SDK 是 Gateway 和实验性 TUI 的运行时依赖，负责进程连接、JSON-RPC、
  类型解析和有界事件流；
- Server 将 SDK 能力映射为 Web API 与 WebSocket；
- Web Studio 通过 Server 使用 Web API 与 WebSocket；TUI 直接使用 Python SDK。Harness
  仓库维护 SDK 源码、文档、测试和通用示例。

SDK 使用指南位于 [Harness SDK 文档](https://github.com/civaapple-alt/mini-agent-harness/tree/main/sdk/python/README.md)，
通用 App Server 示例位于 [Harness Cookbook](https://github.com/civaapple-alt/mini-agent-harness/tree/main/cookbook/python-demo/README.md)。

## 同时开发 Harness SDK

把两个仓库放在同一个父目录下：

```text
work/
├── mini-agent-harness/
└── mini-agent-web/
```

`pyproject.toml` 将 `../mini-agent-harness/sdk/python` 配置为 editable 依赖。运行 `uv sync` 后，
`uv run mini-agent-server` 会直接使用 Harness checkout 中的 SDK。修改 SDK 源码后无需
重新安装，也无需给 `uv run` 添加 `--no-sync`。

## 快速启动

需要 Python 3.10+、`uv`、Node.js 和 npm，以及可执行的
`mini-agent-app-server`。如果二进制不在 `PATH`，设置
`MINI_AGENT_APP_SERVER_PATH`。本分支之后的 Harness Release 会提供包含 CLI 和 App
Server 的平台归档；已发布的 Harness v1.0.0 归档早于此变更，不含 App Server，可从
Harness 仓库源码构建。

```bash
uv sync
npm --prefix frontend ci
npm --prefix frontend run build
uv run mini-agent-server
```

浏览器访问 `http://127.0.0.1:8000`。`uv run mini-agent-server` 不会构建前端，
它只提供现有的 `frontend/dist/`。修改前端源码后，重新运行
`npm --prefix frontend run build`。之后启动 Gateway 时不需要重复安装 npm 依赖。

Gateway 通过 SDK 启动 `mini-agent-app-server` 子进程。SDK 默认从 Gateway 继承的
`PATH` 查找可执行文件；正常使用时，把与 SDK 协议兼容的 Harness App Server 目录加入
`PATH` 即可。只有二进制不在 `PATH` 时，才需要设置 `MINI_AGENT_APP_SERVER_PATH`。

首次打开后，在 **设置 → Agent 能力 → 模型设置** 配置供应商和全局默认模型。API
Key 由 Host 保存在当前用户的 `.mini-agent` 目录。输入框会在尚无可用默认模型时提供
“先配置模型”入口。CLI 与 Web Studio 共用同一模型目录，供应商配置无需放进 `.env`。

开发 Web Studio 时，保留 Gateway 在 `8000` 端口运行，再另开终端启动 Vite：

```bash
cd frontend
npm install
npm run dev
```

开发时访问 `http://127.0.0.1:5173`。Vite 会把 API 和 WebSocket 请求转发到 Gateway。

启动实验性 SDK/App Server 验证 TUI：

```bash
uv run mini-agent-tui
```

## 本地验证

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
uv build --project .
```

默认验证不调用真实模型 Provider。SDK 与 App Server 通用示例见 Harness Cookbook；
本仓 TUI 用于 SDK/App Server 边界验证。

## 顶层目录

```text
server/               FastAPI 网关
frontend/             React Web Studio
tui/                  实验性 Python SDK/App Server 验证 TUI
tests/                Gateway、TUI 与全栈冒烟测试
docs/                 稳定运行与参考文档
```

MIT License。
