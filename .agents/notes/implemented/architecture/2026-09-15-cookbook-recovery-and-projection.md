# Cookbook recovery and projection contract

状态：implemented  
Date: 2026-09-15  
Batch: Cookbook and SDK contract synchronization, Batch 2  
Scope: offline recovery, Session fork projection, EOF handling, and execution controls

## Decision

The Cookbook now has a provider-free recovery example. It calls the existing SDK
read methods in order: `get_runtime_status`, `replay_events`,
`list_thread_items`, and `read_thread`. The fixture keeps
`projectId/threadId/turnId` together, filters stale and cross-turn events, and
collapses duplicate item projections to the latest record.

The example treats `stopping` plus a running checkpoint and no current-turn
`turn_finished` event as unsettled. It does not infer completion, retry a turn,
approve a tool, or execute a local side effect. Session fork results and
structured context-policy conflicts use the existing SDK types.

The steering and interruption example catches `ServerProcessError` around
control and stream operations. After EOF it attempts the authoritative runtime,
item, and checkpoint reads. The workflow example shows independent project
access and approval policy, and states that `trusted` is not allow-all.

## Harness hypothesis

If Cookbook recovery examples reconcile through the App Server's existing reads,
then an EOF or delayed event cannot be mistaken for Turn completion, identity
cannot drift across a projection, and a client example will not grow a second
execution state machine.

## Ownership and boundaries

- App Server and mini-codex own settlement, SessionStore authority, and the
  public runtime projection.
- The SDK owns transport calls and typed parsing for runtime, event, item,
  checkpoint, fork, and conflict results.
- Cookbook examples demonstrate call order and rendering only. They do not
  retry turns, approve actions, or reproduce authorization logic.

## Cross-repository contract

Recovery uses `runtime/status`, `turn/events`, `thread/items/list`, and
`thread/read` as existing public reads. A stopping runtime is not a completed
Turn. `ThreadItem.status` remains lifecycle state and `ThreadItem.outcome`
remains tool-result state. Gateway and Web Studio keep consuming these fields
without creating local authority.

## Verification

- `uv run python cookbook/python-demo/07_recovery_and_projection.py`: passed
  with stopping, duplicate, late-event, identity, and fork-conflict fixtures.
- `uv run python cookbook/python-demo/06_protocol_compatibility.py`: passed.
- `uv run pytest -q tests/cookbook tests/sdk`: 43 passed.
- `uv run ruff check cookbook/python-demo sdk/python tests/cookbook tests/sdk`:
  passed.
- `uv run ruff format --check cookbook/python-demo sdk/python tests/cookbook tests/sdk`:
  19 files already formatted.
- `git diff --check`: passed with only Windows line-ending warnings.
- No App Server process, provider, or frontend production code was used.

## Remaining risks

- The recovery example uses deterministic fixtures and does not inject an actual
  child-process crash or hostile transport failure.
- Live steering and interruption remain provider-backed demonstrations and are
  compile-checked rather than default CI scenarios.
- Reconnect authority still depends on the App Server and SessionStore being
  available; the Cookbook does not add a cache fallback.
