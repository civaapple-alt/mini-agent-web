# Python Tests

本目录保存 `mini-agent-web` 的 Python 测试。测试默认不调用真实模型、不消耗
Provider Token，并覆盖 SDK、网关、会话管理、安全边界、TUI 和 Cookbook
脚本检查。

## 测试文件

| 文件 | 覆盖范围 |
| --- | --- |
| `test_sdk_apis.py` | SDK Thread、Turn、Checkpoint、设置和 Goal API |
| `test_sdk_events.py` | 事件类型、未知事件、Thread/Turn 过滤和 ThreadItem |
| `test_gateway_api.py` | FastAPI 路由、WebSocket 和 workflow 聚合 |
| `test_session_manager.py` | 子进程、连接、审批和本地元数据 |
| `test_world_security.py` | World 与安全策略边界 |
| `test_tui_rendering.py` | TUI 流式输出、失败诊断和 ThreadItem 状态 |
| `test_tui_commands_expanded.py` | 斜杠命令行为 |
| `test_cookbook_validation.py` | 示例脚本编译和离线协议检查 |

## 运行

```bash
uv run pytest tests/ -q
uv run pytest tests/test_sdk_events.py -q
uv run pytest tests/test_gateway_api.py -q
```

需要 live App Server 的测试必须显式配置其可执行文件；默认测试不能隐式启动
Provider 或产生付费请求。
