# Web Studio and SDK limits

This document lists limits implemented by the Python SDK, FastAPI Gateway, and
Web Studio. Agent Loop, model-context, tool, Goal, and Session limits belong to
the compatible App Server runtime. The Gateway forwards those runtime results;
it does not reinterpret them or create another execution limit model.

## SDK transport

| Boundary | Limit | Behavior |
| --- | ---: | --- |
| JSON-RPC stdio line | 2 MiB | The SDK rejects an oversized App Server line before JSON parsing. |
| JSON-RPC request | 30 seconds by default | The SDK removes the pending request and raises a process error on timeout. |
| `wait_for_turn` | 60 seconds by default | The caller can choose a different positive timeout. |

The SDK preserves unknown event types as generic events. This lets an older
SDK display bounded data from a newer App Server without inventing semantics.

## Gateway inputs and projections

| Boundary | Limit | Owner |
| --- | ---: | --- |
| Text attachments | 4 per request, 128 KiB each | Gateway request validation |
| Content file attachments | 16 per request, 8 MiB each | Gateway request validation |
| Child-task prompt | 32 KiB | Gateway and App Server child control path |
| Project Session list | 128 entries | Gateway Session catalog |
| Thread item page | 128 entries | Gateway projection endpoint |
| Notebook search page | 8 entries | Gateway endpoint |

Gateway stores accepted text and content attachments in a Thread-specific
attachment directory. It passes that directory to the runtime as a read-only
Session root. A file path reference is not copied into the Project workspace.

The limits in this table do not relax the App Server contract. For example, an
accepted attachment can still be rejected later by the runtime path policy,
tool policy, or model-context limit.

## Web Studio input and rendering

The composer applies the same attachment count and size limits before it sends
a request. It recognizes long or diagnostic-looking paste content and offers to
store it as a text attachment rather than expanding the visible composer.

Web Studio keeps a bounded reconnect buffer of 128 pending Session events. On
an event replay gap, it reloads canonical Thread and item projections. The
browser does not treat its message list, approval card, or reconnect buffer as
the source of truth for a Turn or Session.

## Long-running controls

Child capacity, Notebook capacity, background Shell task state, scheduled wake
up state, approval policy, and Goal budgets are runtime controls. Web Studio
can show them and submit user actions, but App Server and Host remain the
owners. See [background Shell tasks](background-tasks.md) and [scheduled
tasks](scheduled-tasks.md) for the Web-facing behavior.
