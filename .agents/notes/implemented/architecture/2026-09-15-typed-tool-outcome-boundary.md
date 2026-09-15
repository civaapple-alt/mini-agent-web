# Typed tool outcome consumption boundary

Status: implemented
Date: 2026-09-15
Batch: Iteration 6, main execution-chain outcome propagation
Scope: Python SDK, Gateway, Web Studio, and the Rust `Core → Host → App Server` producer chain

## Decision

The Rust runtime now produces tool lifecycle status at the typed Host/Capabilities
boundary. The App Server continues to project that status through the existing
`ToolFinished` and ThreadItem fields. The Python SDK, Gateway, and Web Studio remain
consumers of the bounded projection and do not infer retry, approval, or deferred
semantics from tool content.

## Harness hypothesis

If the Web stack keeps treating `outcome` as a transport projection rather than a
second authority, internal improvements to approval, Plan-mode deferral, Shell
timeouts, and MCP retryability can ship without a Web protocol migration or local
state divergence.

## Ownership and boundaries

- Core owns the turn loop, history writeback, and event ordering.
- Host/Capabilities owns admission, approval, concrete side effects, and outcome classification.
- App Server owns ordered RPC and Item projection.
- The Python SDK transports the existing outcome field.
- Gateway and Studio render bounded events and keep no retry or authorization cache.

## Cross-repository contract

There is no JSON-RPC, SDK, REST, WebSocket, or frontend schema change in this batch.
The existing outcome values remain consumable as strings, while the Rust producer no
longer rewrites legacy failures based on human-readable content. A future public enum
change must add SDK/Gateway/frontend fixtures before changing the wire contract.

## Verification

- The Rust Protocol, Capabilities, Host, and App Server suites passed for the producer change.
- Existing SDK/Gateway consumer tests passed: 83 tests, with two existing
  Windows asyncio resource-destructor warnings; no Web runtime code was changed.
- Ruff/format checks and protocol compatibility fixtures remain the required Web gates
  for any later wire change.

## Consequences

- Web behavior remains source-compatible while the producer chain has a clearer status owner.
- UI code must continue to use structured event/item fields for control decisions and treat
  tool content as display-only diagnostic text.

## Remaining risks

- This batch does not add a frontend build or real provider/MCP transport test.
- Legacy producer paths can still return string errors internally; they are intentionally
  isolated from Gateway classification rather than silently reinterpreted.
