# Session fork structured conflict contract

Status: implemented
Date: 2026-09-15
Batch: Iteration 4, cross-process conflict code and error data

## Decision

The App Server now reports child-lineage and fork-policy conflicts with the
fixed JSON-RPC code `-32001` and tagged error data. The Python SDK exports
`SESSION_FORK_CONFLICT_CODE` and keeps the server's `data` on `AppServerError`.
The Gateway maps this code to HTTP 409 and includes the code, message, and data
in the response detail. Other App Server errors remain HTTP 400.

## Harness hypothesis

If clients receive a stable conflict code and machine-readable reason, retries
can distinguish a child identity conflict from a storage failure without parsing
error text or accidentally changing a durable Session.

## Ownership and boundaries

- Capabilities owns the typed classification of parent-lineage and context-policy
  conflicts.
- App Server Protocol owns the wire code and tagged data shape.
- The Python SDK transports the code and data without interpreting Session state.
- The Gateway owns HTTP status mapping and live client routing, not Session files.

## Cross-repository contract

`-32001` identifies a `session/fork` identity conflict. `data.kind` is either
`parentLineage` or `contextPolicy`. For an admitted action, action metadata is
merged into the same error data object. The Gateway exposes these fields in its
HTTP 409 detail so Web callers can decide whether to choose another child ID.

## Verification

- Gateway, SessionManager, and SDK tests pass: 63 tests, with two existing
  Windows asyncio resource-destructor warnings.
- The protocol compatibility cookbook passes with the structured conflict
  fixture.
- Ruff passes for the SDK, Gateway route, tests, and cookbook.
- Rust Protocol, Capabilities, and App Server tests pass: 18, 77, and 57.
- Rust affected-package clippy, formatting, and the line-budget delta gate pass.

## Remaining risks

- A conflict detected from an already bound local Gateway child still uses a
  `RuntimeError` and a string detail, although it already returns HTTP 409.
- Legacy Session metadata without a stored policy cannot prove the historical
  fork policy and remains compatible rather than guessing.
