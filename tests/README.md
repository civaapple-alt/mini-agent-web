# Python Tests

本目录保存 `mini-agent-web` 的 Gateway、TUI 和全栈冒烟测试。测试默认不调用真实
模型、不消耗 Provider Token。Python SDK 的实现、单元测试和通用 Cookbook 验证位于
`mini-agent-harness`。

## 测试目录结构

```text
tests/
├── conftest.py      # 全局合成目录隔离与锁清理 Fixtures
├── gateway/         # FastAPI 路由、会话管理、控制面和安全边界
├── tui/             # 实验性终端 TUI 交互与渲染测试
└── smoke/           # Gateway 与 App Server 的集成冒烟场景
```

## 运行

全量运行：

```bash
uv run pytest -q
```

按模块聚焦运行：

```bash
uv run pytest tests/gateway/ -q
uv run pytest tests/tui/ -q
uv run pytest tests/smoke/ -q
```

需要 live App Server 的测试应使用与锁定 SDK 兼容的二进制；若其不在 `PATH`，设置
`MINI_AGENT_APP_SERVER_PATH`。默认测试不能隐式启动 Provider 或产生付费请求。
