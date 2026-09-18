# Python SDK guide

The `mini-agent` package is the zero-dependency asynchronous client for
`mini-agent-app-server`. It starts or connects to the App Server process,
speaks JSON-RPC over stdio, parses bounded events, and forwards control
requests. It does not own an Agent Loop, Session history, approval grants, or
recovery policy.

## Start a client

The SDK requires Python 3.10 or later. In this workspace, install its
development dependencies with `uv sync`. Ensure that `mini-agent-app-server`
is on `PATH`, or set `MINI_AGENT_APP_SERVER_PATH`.

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

`MiniAgentClient` loads `.env` files while it walks from `cwd` toward the
filesystem root. Explicit `env` values override process environment values,
which override values from `.env`. The client does not modify the parent
process environment.

Pass `log_dir` or `log_file` to enable SDK file logging. Logging is optional;
the default client does not create a log file.

```python
client = MiniAgentClient(
    executable="mini-agent-app-server",
    log_dir="logs",
    request_timeout=30.0,
)
```

## Use the runtime boundary

App Server owns Thread, Turn, Goal, Session, approval, and recovery semantics.
The SDK exposes those public methods directly:

| Task | SDK method |
| --- | --- |
| Create or attach a Thread | `start_thread()` |
| Submit a turn | `start_turn()` or `stream_turn()` |
| Read a settled checkpoint | `read_thread()` |
| Read live state | `get_runtime_status()` |
| Steer or stop a Turn | `steer_turn()` or `interrupt_turn()` |
| Read bounded history | `list_thread_items()` or `replay_events()` |
| Create a logical branch | `fork_thread()` |
| Create an independent persisted Session | `fork_session()` |
| Restore serialized Thread state | `resume_thread()` |
| Manage Plan and Goal | `update_thread_settings()`, `set_goal()`, `get_goal()`, `clear_goal()` |
| Read or update environment controls | `get_world_state()`, `refresh_world()`, `set_world_execution()` |

The SDK's `get_workflow_state()` is a local, read-only convenience projection.
It combines cached Thread settings with `thread/goal/get`. It does not send a
legacy `workflow/state` RPC.

## Stream events and items

`stream_turn()` yields events for its requested Thread and Turn until the
runtime settles. It keeps unknown event types as `GenericEvent`, so a newer App
Server event does not break an older consumer.

```python
async for envelope in client.stream_turn("Inspect the workspace"):
    if envelope.get("type") != "event":
        continue
    for item in envelope.get("typed_items", []):
        if item.type == "toolCall":
            print(item.id, item.name, item.status, item.outcome)
```

`ThreadItem.status` is an item lifecycle value. `ThreadItem.outcome` is the
structured tool outcome. Keep those fields separate. Do not infer approval,
retry, or success from tool output text.

For reconnects, read `get_runtime_status()` and request a bounded event page.
If `has_gap` is true, reload canonical Thread and item projections before
accepting the replay as complete.

```python
page = await client.replay_events("default", after_sequence=last_sequence, limit=128)
if page.has_gap:
    checkpoint = await client.read_thread("default")
    items = await client.list_thread_items("default", limit=128)
```

## Set execution and workflow controls

Access scope and approval policy are independent controls. They are enforced by
Host and Capabilities, not by the SDK:

```python
await client.set_world_execution(access="full_machine", policy="interactive")
await client.update_thread_settings(
    "plan",
    thread_id="default",
    continuation_mode="manual",
)
await client.set_goal("Review the repository and report verified findings.")
```

`full_machine` expands candidate filesystem scope. It does not bypass deny
rules, Plan locks, tool availability, sandbox checks, or high-risk approval.
An `approval_handler` receives only approval requests that the runtime has not
already resolved. Without a handler, the SDK denies those pending requests.

```python
async def approve_once(request: dict) -> dict:
    return {"decision": "approve", "grantScope": "once"}


client = MiniAgentClient(approval_handler=approve_once)
```

## Branches, sessions, and child work

`fork_thread()` branches an in-process Thread history. `fork_session()` creates
an independent Session from a complete checkpoint and returns its lineage and
context-policy result. Neither method copies an in-flight Turn or approval
wait. `resume_thread()` accepts a serialized `ThreadCheckpoint` when a caller
needs to restore it through the public protocol.

Child operations, Notebook entries, background Shell tasks, and scheduled
wake-up markers are App Server control-plane features. The SDK can read their
bounded projections, but it must not keep a second operation history or task
scheduler.

## Verify a protocol change

Run the deterministic compatibility fixture when changing event models or SDK
types:

```bash
uv run python cookbook/python-demo/06_protocol_compatibility.py
uv run pytest tests/test_sdk_events.py tests/test_cookbook_validation.py -q
```

The default request timeout is 30 seconds. Configure a different positive
`request_timeout` only for the caller's local environment. The SDK removes a
timed-out pending request and raises `ServerProcessError` instead of waiting
indefinitely.
