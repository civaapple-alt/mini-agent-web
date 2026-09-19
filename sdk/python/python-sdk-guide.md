# Python SDK guide

The `mini-agent` package is the zero-dependency asynchronous client for
`mini-agent-app-server`. It starts one local App Server process, exchanges
JSON-RPC over stdio, parses bounded projections, and forwards control requests.
The client does not implement an Agent Loop or keep Session history, approval
grants, or recovery state.

## Start and initialize a client

Use the context manager so the SDK always releases its child process. After
the process starts, negotiate the protocol and select a Thread before you
submit a Turn:

```python
import asyncio

from mini_agent import MiniAgentClient


async def main() -> None:
    async with MiniAgentClient() as client:
        await client.initialize()
        await client.start_thread("default")

        async for envelope in client.stream_turn("List files in this workspace."):
            if envelope.get("type") != "event":
                continue
            event = envelope["typed_event"]
            if event.event_type == "assistant_text_delta":
                print(event.delta, end="", flush=True)


asyncio.run(main())
```

The SDK requires Python 3.10 or later. It finds `mini-agent-app-server` on
`PATH`, or you can set `MINI_AGENT_APP_SERVER_PATH` or pass `executable=`.

The constructor merges configuration in this order: explicit `env`, process
environment, then the first value found in its bounded `.env` search. That
search checks `cwd`, its parent, SDK paths, the Web workspace, and
`~/.mini-agent`. The SDK never changes the parent process environment.

Logging is disabled by default. Pass `log_dir` or `log_file`, or set
`MINI_AGENT_LOG_DIR` or `MINI_AGENT_LOG_FILE`, to write SDK logs.

```python
client = MiniAgentClient(
    executable="mini-agent-app-server",
    log_dir="logs",
    request_timeout=30.0,
)
```

## Call the public boundary

App Server owns Thread, Turn, Goal, Session, approval, and recovery semantics.
The SDK exposes its supported controls directly:

| Task | SDK method |
| --- | --- |
| Create or attach a Thread | `start_thread()` |
| List or read Threads | `list_threads()`, `read_thread()` |
| Submit a Turn | `start_turn()` or `stream_turn()` |
| Read or wait for settlement | `read_turn()` or `wait_for_turn()` |
| Steer or stop a running Turn | `steer_turn()` or `interrupt_turn()` |
| Read live or replayable state | `get_runtime_status()`, `replay_events()`, `list_thread_items()` |
| Create a logical Thread branch | `fork_thread()` |
| Create an independent persisted Session | `fork_session()` |
| Restore a serialized checkpoint | `resume_thread()` |
| Configure Plan or a Goal | `update_thread_settings()`, `set_goal()`, `get_goal()`, `clear_goal()` |
| Read or modify a Notebook | `read_notebook()`, `write_notebook()`, `forget_notebook()` |
| Inspect execution environment | `get_world_state()`, `refresh_world()`, `set_world_execution()` |
| Inspect or retry MCP | `get_mcp_status()`, `retry_mcp()` |
| Inspect local tasks | `list_background_tasks()` and `list_scheduled_tasks()` |

`get_workflow_state()` is an SDK-only read-only convenience projection. It
combines cached Thread settings with `thread/goal/get`; it does not send the
removed `workflow/state` RPC.

Protocol version 1 has no public Notebook search method. Although the current
SDK implementation exposes `search_notebook()`, compatibility code must not
use it. Use `read_notebook()` and search the returned bounded projection.

## Stream events without losing identity

`stream_turn()` submits a Turn and yields its correlated envelopes until that
Turn settles. The first envelope has type `_turn_submission`; subsequent
envelopes include `event`, `approval`, and lifecycle notifications. Unknown
Core event types remain `GenericEvent`, so a newer App Server event does not
break an older SDK consumer.

```python
async for envelope in client.stream_turn("Inspect the workspace"):
    if envelope.get("type") != "event":
        continue
    for item in envelope.get("typed_items", []):
        if item.type == "toolCall":
            print(item.id, item.name, item.status, item.outcome)
```

`ThreadItem.status` describes item lifecycle. `ThreadItem.outcome` describes
the structured tool result. Do not infer approval, retry, or success from tool
output text.

For a reconnect, use the latest per-Thread event sequence with
`replay_events()`. If the page has `has_gap=True`, load canonical history
before accepting replay as complete:

```python
page = await client.replay_events("default", after_sequence=last_sequence, limit=128)
if page.has_gap:
    checkpoint = await client.read_thread("default")
    items = await client.list_thread_items("default", limit=128)
```

## Receive notifications and approvals

`notification_handler` receives `turn/event`, item lifecycle, runtime, and
transport-error notifications. The SDK awaits the handler for `turn/event`,
so put slow work on your own queue rather than block the reader loop.

```python
async def approve_once(request: dict) -> dict:
    return {"decision": "approve", "grantScope": "once"}


async def observe(notification: dict) -> None:
    print(notification["type"])


client = MiniAgentClient(
    approval_handler=approve_once,
    notification_handler=observe,
)
```

`approval_handler` receives only requests that the runtime has not already
resolved. It must return a decision and, for approval, a grant scope allowed
by the request. Without a handler, the SDK denies the request. The SDK reports
the same approval record through `stream_turn()`.

## Set execution and lifecycle controls

Access scope and approval policy are independent. Host and Capabilities
enforce both controls, not the SDK:

```python
await client.set_world_execution(access="full_machine", policy="interactive")
await client.update_thread_settings(
    "plan",
    thread_id="default",
    continuation_mode="manual",
)
await client.set_goal("Review the repository and report verified findings.")
```

`full_machine` expands candidate filesystem scope. It does not bypass Deny
rules, Plan locks, tool availability, sandbox checks, or high-risk approval.
An accepted `interrupt_turn()` request also does not mean that the Turn is
settled. Continue streaming or call `read_turn()` until the terminal result.

`fork_thread()` creates an in-process logical branch. `fork_session()` creates
an independent Session from a complete checkpoint. Neither copy an in-flight
Turn or approval wait. Notebook entries, background Shell tasks, and scheduled
wake-up markers remain App Server control-plane state. Read their bounded
projections through the SDK, but do not keep a second operation history or
scheduler in a client.

## Handle timeouts and protocol changes

The default request timeout is 30 seconds. A positive `request_timeout`
changes that value for one client. On timeout, the SDK removes the pending
request and raises `ServerProcessError`. `AppServerError` retains the JSON-RPC
error `code`, `message`, and `data`. `session/fork` identity or context-policy
conflicts use `SESSION_FORK_CONFLICT_CODE` (`-32001`).

When event models, public types, or wire fields change, run:

```bash
uv run python cookbook/python-demo/06_protocol_compatibility.py
uv run pytest tests/sdk/test_sdk_events.py tests/cookbook/test_cookbook_validation.py -q
```
