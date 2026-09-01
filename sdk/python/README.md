# Mini Agent Python SDK 0.6.0

Official asynchronous Python SDK for interacting with the `mini-agent-app-server` runtime and Harness engine.

## Installation

```bash
pip install mini-agent
```

Or when developing within the workspace:

```bash
uv sync
```

## Quick Start

```python
import asyncio
from mini_agent import MiniAgentClient


async def main():
    async with MiniAgentClient() as client:
        # 1. Initialize and start thread
        await client.initialize(profile="interactive")
        await client.start_thread()

        # 2. Stream turn prompt
        async for item in client.stream_turn("List available tools and summarize."):
            if item["type"] == "event":
                event = item["event"]
                if event.get("type") == "assistant_text_delta":
                    print(event.get("delta", ""), end="", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
```

## Key Features

* **Async Context Manager**: Simple `async with MiniAgentClient()` manages subprocess lifecycle cleanly.
* **Stream Generator**: `stream_turn()` yields target-Thread/Turn events, real-time reasoning deltas, text tokens, tool start/finish, context compaction, and run lifecycle events.
* **Security & Approval Interceptor**: Native support for `approval/request` and `approval/respond` protocol.
* **Steering & Interrupt**: Mid-turn instruction injection (`turn/steer`) and cooperative cancellation (`turn/interrupt`).
* **Zero Required Dependencies**: Runs entirely on Python 3.10+ Standard Library (`asyncio`, `json`, `subprocess`).

## 0.6.0 Compatibility

The SDK targets `mini-agent-app-server` 0.6.0 over JSON-RPC wire protocol
version `1`. It exposes typed context-compaction and run-lifecycle events,
preserves unknown events as `GenericEvent`, and keeps `stream_turn()` scoped to
the requested Thread and Turn. Set `MINI_AGENT_APP_SERVER_PATH` when the
matching App Server binary is not on `PATH`.

For a deterministic protocol check that does not start the App Server or call a
model provider, run:

```bash
uv run python cookbook/python-demo/06_protocol_compatibility.py
```

## License

MIT License. See [LICENSE](LICENSE) for details.
