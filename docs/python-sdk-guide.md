# Mini Agent Official Python SDK (`mini-agent`) 0.6.0 Developer Guide

The `mini-agent` Python package is the official, zero-dependency async SDK designed to communicate with the [Mini Agent Harness (`mini-agent-app-server`)](https://github.com/civaapple-alt/mini-agent-harness) over **Stdio JSON-RPC 2.0**.

---

## 1. Quickstart & Installation

The SDK is packaged under `sdk/python` with full PEP 561 type annotation (`py.typed`).

### In this workspace (with `uv`):
```bash
# Editable install is automatically wired via root pyproject.toml
uv sync
```

### Direct use in your Python scripts:
```python
import asyncio
from mini_agent import MiniAgentClient


async def main():
    async with MiniAgentClient() as client:
        await client.initialize(profile="interactive")
        await client.start_thread()

        async for event in client.stream_turn("List files in current directory"):
            if event["type"] == "event":
                typed = event["typed_event"]
                print(f"[{typed.event_type}]: {typed}")


if __name__ == "__main__":
    asyncio.run(main())
```

---

## 2. Core Concepts & Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                 Consumer Applications                       │
│        (FastAPI Web UI / Streamlit / Cookbook / TUI)        │
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
└─────────────────────────────────────────────────────────────┘
```

### Zero-Dependency Philosophy
`mini-agent` uses **pure standard library** (`asyncio`, `json`, `subprocess`, `dataclasses`, `logging`). It introduces no heavy third-party networking packages (such as `requests`, `httpx`, or `pydantic`), ensuring instant startup and zero dependency conflicts.

---

## 3. Client Lifecycle & Configuration

### 3.1 Initializing the Client

```python
from mini_agent import MiniAgentClient

client = MiniAgentClient(
    executable="mini-agent-app-server",  # Auto-discovers the App Server on PATH
    log_dir="logs",  # Auto-records detailed session logs
    approval_handler=None,  # Custom async approval callback
)
```

### 3.2 Automated `.env` Discovery
`MiniAgentClient` automatically locates and parses `.env` files, providing credentials (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, etc.) directly to the backend process environment without modifying global state. Set `MINI_AGENT_APP_SERVER_PATH` to select an explicit 0.6.0 App Server binary.

### 3.3 Dynamic File-Based Logging
Passing `log_dir="logs"` automatically creates script-isolated logs (e.g. `logs/02_streaming_events.log`).
```python
# Enable SDK debug logging with script-name auto-detection
setup_logging(log_dir="logs", level=logging.DEBUG, mode="w")
```

---

## 4. Interaction Patterns

### 4.1 Token-by-Token Streaming (`stream_turn`)
`stream_turn` returns an async generator yielding only the requested Thread/Turn's real-time events until `turn_finished` or `run_failed`. It also parses `context_compaction_started`, `context_compaction_finished`, and `run_finished`:

```python
async for envelope in client.stream_turn("Explain quantum computing"):
    if envelope["type"] == "event":
        event = envelope["typed_event"]

        # Token deltas
        if event.event_type == "assistant_text_delta":
            print(event.delta, end="", flush=True)

        # Tool execution lifecycle
        elif event.event_type == "tool_started":
            print(f"\n[Calling Tool]: {event.call.name}({event.call.arguments})")
        elif event.event_type == "tool_finished":
            print(f"\n[Tool Result]: {event.content}")
```

### 4.2 Security Approval Interception (`approval_handler`)
Sensitive actions (shell execution, workspace file modification, web fetching) trigger an `approval/request` notification from the backend. You can intercept these programmatically:

If `approval_handler` is omitted, the SDK uses its default auto-approve handler.
This is why Cookbook Demo 02 can execute its inspection Shell calls without a
manual prompt. Use a custom callback, as in Demo 03, when every sensitive action
must require an explicit human decision; do not use the default in an untrusted
workspace.

```python
async def custom_approver(request_id: str, action: str, params: dict) -> bool:
    print(f"[SECURITY ALERT] Request: {action}")
    # Prompt user or verify against whitelist
    return True


client = MiniAgentClient(approval_handler=custom_approver)
```

### 4.3 Runtime Steering (`steer_turn`)
Mid-flight corrections can be injected while a turn is actively executing:

```python
# Start turn
resp = await client.start_turn("Write a 1000-word essay on AI")

# Wait a second and inject steering instruction
await asyncio.sleep(1.0)
await client.steer_turn(resp.turn_id, "Change tone to a 3-bullet summary.")

# Wait for turn to settle with the new instructions
result = await client.wait_for_turn(resp.turn_id)
print(result.final_text)
```

### 4.4 Cooperative Interruption (`interrupt_turn`)
Cancel long-running turns safely without corrupting session state:

```python
await client.interrupt_turn(turn_id)
result = await client.wait_for_turn(turn_id)
assert result.status == "cancelled"
```

### 4.5 Protocol Compatibility and Future Events

The 0.6.0 SDK targets App Server JSON-RPC protocol version `1`. Parsed event
objects expose `event_type`, and the typed event surface includes context
compaction (`context_compaction_started` / `context_compaction_finished`) and
run lifecycle (`run_finished` / structured `run_failed`) events. Unknown future
event types remain available as `GenericEvent` instead of breaking the stream.

Use the deterministic Cookbook contract check when changing event models:

```bash
uv run python cookbook/python-demo/06_protocol_compatibility.py
uv run pytest tests/test_sdk_events.py tests/test_cookbook_validation.py -q
```

### 4.6 Workflows & Plan Mode
```python
# Inspect system environment & available tools
world_state = await client.get_world_state()

# Enter read-only exploration mode
await client.set_plan_mode(
    active=True, prompt="Analyze codebase without modifying files"
)

# Read settled thread checkpoint
checkpoint = await client.read_thread()
print(f"Messages count: {len(checkpoint.messages)}")
```

### 4.7 Thread Branching & Resuming
```python
# List all active threads
threads = await client.list_threads()

# Fork thread state into an experimental branch
forked = await client.fork_thread(
    source_thread_id="default", new_thread_id="feature-experiment"
)

# Resume thread from checkpoint
resumed = await client.resume_thread(thread_id="restored-thread", checkpoint=checkpoint)
```

### 4.8 Multi-Milestone Goal Workflows
```python
# Start a multi-stage goal workflow
goal = await client.start_goal("Implement High-Performance Caching Layer")
print(
    f"Goal ID: {goal.goal_id}, Status: {goal.status}, Milestone: {goal.current_milestone}/{goal.total_milestones}"
)

# Fetch milestone verification criteria
criteria = await client.get_goal_criteria()

# Pause or advance goal
await client.pause_goal()
```

---

## 5. Exception Hierarchy

All SDK exceptions inherit from `MiniAgentError`:

```text
MiniAgentError (Base)
├── AppServerError (JSON-RPC error with code, message, and data)
├── ProtocolVersionMismatchError (Server/Client protocol mismatch)
├── ServerProcessError (Backend binary crash or startup failure)
└── TurnTimeoutError (Turn polling timeout)
```
