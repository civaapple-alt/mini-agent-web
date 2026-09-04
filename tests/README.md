# Python Tests

本目录保存 `mini-agent-web` 的 Python 测试。测试默认不调用真实模型、不消耗
Provider Token，并覆盖 SDK、网关、会话管理、安全边界、TUI 和 Cookbook
脚本检查。

## 测试目录结构

```text
tests/
├── conftest.py            # 全局合成目录隔离与锁清理 Fixtures
├── sdk/                   # Python SDK 协议与客户端测试
│   ├── test_sdk_apis.py   # Thread、Turn、Checkpoint、设置和 Goal API
│   └── test_sdk_events.py # 事件类型、未知事件、Thread/Turn 过滤和 ThreadItem
├── gateway/               # FastAPI 网关、会话管理与控制面测试
│   ├── test_gateway_api.py      # FastAPI 路由、WebSocket 和 workflow 聚合
│   ├── test_session_manager.py  # 子进程、连接、审批和本地元数据
│   └── test_world_security.py   # 路径防穿越、工作区扫描与项目管理
├── tui/                   # 实验性终端 TUI 交互与渲染测试
│   ├── test_tui_rendering.py         # TUI 流式输出、失败诊断和 ThreadItem 状态
│   └── test_tui_commands_expanded.py # 斜杠命令行为与自动补全
├── cookbook/              # Cookbook 示例程序自动化验证
│   └── test_cookbook_validation.py   # 示例脚本语法编译和离线协议检查
└── smoke/                 # 全栈集成与冒烟测试规范
```

## 运行

全量运行：

```bash
uv run pytest -q
```

按模块聚焦运行：

```bash
uv run pytest tests/sdk/ -q
uv run pytest tests/gateway/ -q
uv run pytest tests/tui/ -q
uv run pytest tests/cookbook/ -q
```

需要 live App Server 的测试必须显式配置其可执行文件；默认测试不能隐式启动
Provider 或产生付费请求。
