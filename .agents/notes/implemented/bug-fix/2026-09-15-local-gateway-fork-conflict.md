# Local Gateway Session fork conflict contract

Status: implemented
Date: 2026-09-15
Batch: Iteration 5, unify local and cross-process policy conflicts

## Decision

The Gateway now raises its own typed `SessionForkConflictError` when an already
bound child uses a different `context_policy`. It no longer represents a local
binding check as an App Server transport error. The HTTP route maps this local
error and the cross-process `AppServerError` to the same `-32001` and
`contextPolicy` data shape.

Project binding conflicts remain a separate Gateway binding error and do not
expand the Session fork protocol variants.

## Harness hypothesis

If local and cross-process child-policy conflicts share stable code/data while
keeping their internal ownership separate, callers can handle both sources
without parsing text and maintainers can tell Gateway admission errors from App
Server transport errors.

## Ownership and boundaries

- `ClientPool` owns local child binding checks and the typed Gateway error.
- App Server `SessionStore` remains authoritative for durable cross-process
  conflicts.
- The thread route owns HTTP 409 adaptation and does not write Session files.
- Project binding conflicts remain outside the `contextPolicy` contract.

## Cross-repository contract

The wire contract remains unchanged: `-32001` identifies a Session child
identity or policy conflict, and policy conflicts use `data.kind` equal to
`contextPolicy` with bounded child and policy fields. Both local and
cross-process Gateway paths expose this as HTTP 409.

## Verification

- Gateway fork route tests pass: 10 tests.
- Ruff, formatting, and `git diff --check` pass for the changed files.
- The previous Rust, SDK, Gateway targeted suite, and protocol smoke test remain
  passing; this batch does not change Rust.

## Consequences

- Local retries and cross-process retries return the same machine-readable
  conflict information.
- The SDK `AppServerError` type keeps its transport meaning instead of being
  reused for a local Gateway-only failure.
- The Gateway gains one small control-plane error type without changing the
  public JSON-RPC schema.

## Remaining risks

- A child ID bound to another Project still returns a separate string detail;
  it needs its own contract if that behavior is later standardized.
- Legacy Sessions without policy metadata cannot prove their historical policy
  and remain compatibility-based.
