# Web Studio tool outcome consumption

Status: implemented
Date: 2026-09-15
Batch: Iteration 8, complete public tool outcome consumption
Scope: Python SDK, Gateway projections, Web Studio frontend, and TUI

## Decision

Web Studio tool blocks preserve lifecycle `status` and runtime `outcome` as
separate fields. The SDK parses outcome strings at the boundary. Known values
are documented by `KnownToolOutcome`, while unknown strings pass through and
receive a generic UI label. The frontend renders the value and never starts a
retry, approval, or local execution.

## Harness hypothesis

If live events, Item history, and Session catalog entries feed the same bounded
tool block, Web Studio will not report `retryable`, `deferred`, or a future
unknown value as an ordinary failure, and diagnostic text will not control the
runtime.

## Ownership and boundaries

- Core/Host/Capabilities produce the outcome.
- App Server projects it into events and Items.
- SDK preserves valid strings at the external boundary.
- Gateway and frontend project and render without creating a second authority.

## Cross-repository contract

`status` remains the three-value lifecycle `inProgress`, `completed`, or
`failed`. `outcome` uses the server's snake_case string values. Older Items may
omit the field. Future unknown strings remain visible to the client and render
with a generic label instead of becoming `failed`.

## Verification

- `npm test`: Node 53 passed and Vitest 36 passed.
- `npm run build`: passed with the existing Vite chunk-size warning.
- `npm run lint`: passed.
- Targeted SDK/Gateway/TUI tests: 79 passed with one existing Windows asyncio
  resource-destructor warning.
- Ruff and protocol compatibility checks passed.

## Remaining risks

- Stopping-phase EOF/reconnect recovery is the next batch.
- Automatic retry and approval continuation remain App Server behavior.
- No real provider, MCP transport, or browser fault-injection run was added.
