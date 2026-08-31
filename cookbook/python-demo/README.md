# Mini Agent Python Cookbook (Based on Official SDK)

本目录提供了基于官方 Python SDK `mini-agent` 调用并集成 `mini-agent-app-server` 的全套实战示例。

---

## 目录结构

```text
cookbook/python-demo/
├── 01_basic_turn.py               # 基础对话与 Turn 执行示例
├── 02_streaming_events.py         # 深度流式事件监听 (Token/Step/Tool/Usage)
├── 03_approval_handling.py        # 敏感工具权限审批拦截与交互处理
├── 04_steering_and_interrupt.py   # 运行时协同中断与中途转向 (Steer)
├── 05_workflows_and_inspection.py # 环境快照、Plan Mode 与线程检查点读取
└── README.md                      # 本说明文档
```

---

## 运行环境

已在根目录 `pyproject.toml` 中将 `sdk/python` 注册为工作区依赖包：

```bash
# Windows PowerShell / Linux / macOS
uv run python cookbook/python-demo/01_basic_turn.py
```

---

## 核心 SDK 快速上手

```python
import asyncio
from mini_agent import MiniAgentClient


async def main():
    async with MiniAgentClient() as client:
        # 1. 协商协议与初始化
        await client.initialize(profile="interactive")
        await client.start_thread()

        # 2. 流式发起 Turn 并实时消费事件
        async for item in client.stream_turn("查看当前目录下的文件并总结"):
            if item["type"] == "event":
                event = item["event"]
                if event.get("type") == "assistant_text_delta":
                    print(event.get("delta", ""), end="", flush=True)


asyncio.run(main())
```

---

## 示例运行指南

### Demo 01: 基础对话执行
演示最基础的客户端初始化、启动线程以及发起 Prompt 交互。
```bash
uv run python cookbook/python-demo/01_basic_turn.py
```

### Demo 02: 深度流式事件监听
演示如何精细化捕获 Step 步长、推理 Token、工具调用参数、工具输出 UTF-8 截断状态及 Token 使用量。
```bash
uv run python cookbook/python-demo/02_streaming_events.py
```

### Demo 03: 敏感操作安全审批拦截
演示当 Agent 尝试执行写文件或 Shell 敏感命令时，客户端如何收到 `approval/request` 通知，并在控制台/Web 弹窗中由用户授权决策。
```bash
uv run python cookbook/python-demo/03_approval_handling.py
```

### Demo 04: 中途转向与协同中断
演示在 Agent 执行长任务时，如何中途注入矫正 Prompt（`turn/steer`）或安全终止当前轮次（`turn/interrupt`）。
```bash
uv run python cookbook/python-demo/04_steering_and_interrupt.py
```

### Demo 05: 工作流与状态检查点
演示查询 `WorldState` 环境快照、开启/关闭只读探索的 `Plan Mode`，以及读取 `ThreadCheckpoint` 检查点。
```bash
uv run python cookbook/python-demo/05_workflows_and_inspection.py
```

---

## Web / FastAPI 后端集成范式

```python
from fastapi import FastAPI, WebSocket
from mini_agent import MiniAgentClient

app = FastAPI()


@app.websocket("/ws/agent")
async def agent_endpoint(websocket: WebSocket):
    await websocket.accept()
    async with MiniAgentClient() as client:
        await client.initialize()
        await client.start_thread()

        while True:
            prompt = await websocket.receive_text()
            async for item in client.stream_turn(prompt):
                await websocket.send_json(item)
```
