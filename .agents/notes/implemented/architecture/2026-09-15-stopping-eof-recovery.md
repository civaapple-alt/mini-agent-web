# Stopping, EOF, and cross-repository recovery

状态：implemented  
Date: 2026-09-15  
Batch: Iteration 9, stopping and runtime disconnect recovery  
Scope: Gateway stream handling, Session catalog persistence, and Web Studio recovery projection

## Decision

Transport-task cancellation and App Server EOF are not evidence that a Turn
completed or failed. The Gateway no longer synthesizes `turn_finished` and no
longer publishes `ServerProcessError` as a terminal Turn error. Authoritative
settlement remains an App Server event or durable state.

The Gateway writes the fork result to its catalog before starting the child
client. If child startup fails, the persisted `projectId + threadId + sessionId`
remains attachable and a retry reuses the SessionStore result instead of
creating a second Session.

Web Studio projects WebSocket loss and runtime errors as `reconnecting`, then
reconciles through the existing `attachThread`, `runtime/status`,
`thread/items/list`, and event replay paths. No public recovery endpoint,
second Gateway execution state machine, or authorization cache was added.

## Harness hypothesis

If stopping, EOF, child startup failure, and reconnect preserve the unsettled
fact and reconcile through SessionStore, App Server runtime/status, and Thread
Item history, recovery will not invent completion/failure, drift the
`projectId + threadId + turnId` identity, or create a second execution state
from late or duplicate events.

## Ownership and boundaries

- App Server/Core owns Turn settlement and publishes the real `turn_finished`.
- SessionStore owns durable Session identity and fork idempotency.
- Gateway owns transport routing and an attachable catalog projection, but not
  authorization or a shadow recovery state machine.
- Web Studio owns reconnecting presentation and reconciliation requests, but
  does not retry execution, approve tools, or execute locally.

## Cross-repository contract

`ThreadItem.status` remains lifecycle state and `ThreadItem.outcome` remains
tool-result state. A `turn_finished` event is settlement evidence; WebSocket
cancellation, EOF, and runtime errors are transport/recovery signals. Events
remain scoped by `projectId + threadId + turnId` during replay.

## Verification

- `uv run pytest -q tests/gateway/test_gateway_agent.py tests/gateway/test_session_manager.py tests/sdk/test_sdk_events.py`: 85 passed, with two existing Windows asyncio resource-destructor warnings.
- `uv run ruff check server/control/client_pool.py server/routes/agent_ws.py tests/gateway/test_gateway_agent.py tests/gateway/test_session_manager.py`: passed.
- `npm test`: Node 53 passed and Vitest 36 passed.
- `npm run build`: passed with the existing Vite chunk-size warning.
- `npm run lint`: passed.

## Consequences

- An interrupt accepted before process exit is not reported as interrupted unless the authoritative runtime settles it.
- A failed child start leaves a discoverable fork record for attach/retry.
- Web Studio shows recovery in progress instead of a false completed Turn, then accepts replay only after reconciliation.

## Remaining risks

- No paid provider or full controlled subprocess crash injection was run; the evidence is boundary-fixture based.
- If SessionStore is unavailable, Web Studio can report recovery failure but cannot rebuild authority from a Gateway cache.
- Legacy tool migration and the Batch 11 Plan Mode, resolver, compaction, and Harness Scenario/Eval evidence remain outstanding.
