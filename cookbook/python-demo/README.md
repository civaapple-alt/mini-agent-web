# Python Cookbook

本目录包含可直接运行的 `mini-agent` 示例。每个脚本都是一个独立入口；示例
之间不共享运行时状态。

## 示例清单

| 脚本 | 内容 | 类型 |
| --- | --- | --- |
| `01_basic_turn.py` | 初始化、Thread 和基础 Turn | live |
| `02_streaming_events.py` | 文本、思考、工具和 usage 流 | live |
| `03_approval_handling.py` | Shell 与 `apply_patch` 审批回调 | live |
| `04_steering_and_interrupt.py` | Steer 和协作中断 | live |
| `05_workflows_and_inspection.py` | World、Plan、Goal 和 Checkpoint | live |
| `06_protocol_compatibility.py` | 当前事件与 ThreadItem 类型检查 | offline |

## 运行

先确保 App Server 可执行文件可被 SDK 找到；不在 `PATH` 时设置
`MINI_AGENT_APP_SERVER_PATH`。Live 示例还需要模型 Provider 的凭证。

```bash
uv run python cookbook/python-demo/01_basic_turn.py
uv run python cookbook/python-demo/02_streaming_events.py
uv run python cookbook/python-demo/03_approval_handling.py
uv run python cookbook/python-demo/04_steering_and_interrupt.py
uv run python cookbook/python-demo/05_workflows_and_inspection.py
```

离线协议检查不启动 App Server，也不调用模型：

```bash
uv run python cookbook/python-demo/06_protocol_compatibility.py
```

## 编写约定

- 示例应保持短小，直接展示一个 SDK 边界；
- Live 示例不能成为默认自动化测试的隐式依赖；
- 新增公共事件或 ThreadItem 形状时，同步扩展离线示例；
- 所有 `.py` 文件必须保持可编译。
