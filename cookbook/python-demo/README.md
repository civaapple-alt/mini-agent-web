# Mini Agent App Server - Python Cookbook & SDK

本目录提供了基于 Python 调用并集成 `mini-agent-app-server` 的全功能客户端 SDK 与实战示例。

`mini-agent-app-server` 采用类似 LSP 的 **Stdio JSON-RPC 2.0** 架构，Python 客户端通过异步子进程管道与其交互，获得纯内存、高安全边界与单一状态权威的 Coding Agent 能力。

---

## 目录结构

```text
cookbook/python-demo/
├── client.py                      # 核心异步 Python Client SDK (MiniAgentClient)
├── 01_basic_turn.py               # 基础对话与 Turn 执行示例
├── 02_streaming_events.py         # 流式事件监听 (Token/Step/Tool/Usage)
├── 03_approval_handling.py        # 敏感工具权限审批拦截与交互处理
├── 04_steering_and_interrupt.py   # 运行时协同中断与中途转向 (Steer)
├── 05_workflows_and_inspection.py # 环境快照、Plan Mode 与线程检查点读取
└── README.md                      # 本说明文档
```

---

## 环境配置

### 1. 前置要求

* **Python 3.10+**（原生标准库，**零外部 pip 依赖**）。
* `mini-agent-app-server.exe` 已安装并加入系统 `PATH`（如 `C:\Users\alwar\.tools\bin`）。

### 2. 配置模型 API Key

`mini-agent-app-server` 默认会读取环境变量或工作区 `.env` 配置。在运行前确保已配置好模型 Provider：

```bash
# Windows PowerShell
$env:OPENAI_API_KEY="your-api-key"
$env:OPENAI_BASE_URL="https://api.deepseek.com"
$env:OPENAI_MODEL="deepseek-v4-flash"
```

或者在当前目录创建 `.env` 文件：
```ini
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash
```

---

## 核心 SDK 快速上手 (`client.py`)

SDK 提供了易用的 `async with` 上下文管理器与流式事件生成器：

```python
import asyncio
from client import MiniAgentClient

async def main():
    async with MiniAgentClient() as client:
        # 1. 协商协议与初始化
        await client.initialize(profile="interactive")
        await client.start_thread()

        # 2. 流式发起 Turn 并实时消费事件
        async for item in client.stream_turn("查看当前目录下的文件并总结"):
            if item["type"] == "event":
                event = item["event"]
                if "model_responded" in event and event["model_responded"].get("text"):
                    print(event["model_responded"]["text"], end="", flush=True)

asyncio.run(main())
```

---

## 示例运行指南

### Demo 01: 基础对话执行
演示最基础的客户端初始化、启动线程以及发起 Prompt 交互。
```bash
python 01_basic_turn.py
```

### Demo 02: 深度流式事件监听
演示如何精细化捕获 Step 步长、推理 Token、工具调用参数、工具输出 UTF-8 截断状态及 Token 使用量。
```bash
python 02_streaming_events.py
```

### Demo 03: 敏感操作安全审批拦截
演示当 Agent 尝试执行写文件或 Shell 敏感命令时，客户端如何收到 `approval/request` 通知，并在控制台/Web 弹窗中由用户授权决策。
```bash
python 03_approval_handling.py
```

### Demo 04: 中途转向与协同中断
演示在 Agent 执行长任务时，如何中途注入矫正 Prompt（`turn/steer`）或安全终止当前轮次（`turn/interrupt`）。
```bash
python 04_steering_and_interrupt.py
```

### Demo 05: 工作流与状态检查点
演示查询 `WorldState` 环境快照、开启/关闭只读探索的 `Plan Mode`，以及读取 `ThreadCheckpoint` 检查点。
```bash
python 05_workflows_and_inspection.py
```

---

## Web / FastAPI 后端集成建议

在 Web 应用（如 FastAPI / WebSocket / SSE）中集成时，可将 `MiniAgentClient` 封装在会话池中：

```python
from fastapi import FastAPI, WebSocket
from client import MiniAgentClient

app = FastAPI()

@app.websocket("/ws/agent")
async def agent_endpoint(websocket: WebSocket):
    await websocket.accept()
    async with MiniAgentClient() as client:
        await client.initialize()
        await client.start_thread()
        
        while True:
            data = await websocket.receive_text()
            async for item in client.stream_turn(data):
                await websocket.send_json(item)
```
