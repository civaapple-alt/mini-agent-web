# Tool outcome public projection and Web consumption

Status: implemented
Date: 2026-09-15
Batch: Iteration 7, preserve tool result semantics in public Items
Scope: App Server Protocol `ThreadItem`, Python SDK, Gateway Session catalog, and TUI

## Decision

The public `ToolCall` Item now has an optional `outcome` alongside its existing
`status`. `status` remains the Item lifecycle (`inProgress`, `completed`, or
`failed`); `outcome` preserves the bounded Rust tool result values
`completed`, `failed`, `needs_approval`, `deferred`, and `retryable`.

The SDK parses `outcome` as `ToolOutcome`, the Gateway preserves it in historical
Session projections, and the TUI uses it only for display text. Missing outcome
fields in older Session records remain valid.

## Harness hypothesis

If the Web stack consumes the separate outcome field, it can distinguish a
retryable timeout or deferred operation from a generic failure without parsing
diagnostic content or creating a second runtime authority.

## Ownership and boundaries

- Core/Host/Capabilities produce and settle the tool outcome.
- App Server Protocol projects it into live and persisted-facing Items.
- SDK transports the bounded value.
- Gateway projects historical records without writing Session state.
- TUI renders the value and never triggers retry or approval actions.

## Cross-repository contract

The additive `ToolCall.outcome` field uses snake_case values matching
`ToolExecutionStatus`. The existing camelCase lifecycle `status` remains
unchanged. Older clients may ignore `outcome`; newer clients must not derive it
from `output` text.

## Verification

- App Server Protocol tests pass: 19 tests.
- SDK, Gateway Session catalog, and TUI tests pass: 79 tests, with two existing
  Windows asyncio resource-destructor warnings.
- The protocol compatibility cookbook passes.
- No Web runtime API or persistence writer changed.

## Consequences

Web consumers can show policy and retry semantics without changing the existing
lifecycle handling. Historical Session projections and live Item notifications
now expose the same tool result dimension.

## Remaining risks

- Runtime validation of unknown outcome strings is intentionally not added yet.
- Automatic retry and approval continuation remain App Server control-plane
  behavior and are outside the TUI rendering change.
