# Session fork retry idempotency

## Conclusion

The Gateway treats a repeated fork request as the same operation when it keeps the
same source Thread and child Thread identity. Once a child client is already bound,
the Gateway returns the persisted fork metadata and does not start another client.
The App Server and SessionStore remain the source of truth for the child Session.

## Boundary

The Gateway does not create its own Session idempotency cache. It relies on the
App Server's `session/fork` contract and only keeps the derived child client and
Project binding needed to route live requests. A child startup failure leaves the
durable Session available for a later attach/retry.

An existing child Thread bound to a different Project is still rejected. A child
Thread reused for a different parent checkpoint is rejected by SessionStore and is
surfaced as a conflict rather than silently rebinding the UI state.

## Verification

- The Gateway fork API test submits the same request twice and asserts one
  `fork_session` call, one child client creation, and the same child Session ID.
- Gateway regression tests pass: 56 tests in the focused goals/items and
  SessionManager suites.
- Ruff passes for the changed Gateway and test files.

## Remaining risk

The current wire result does not persist `contextPolicy` and compaction metadata in
the Session header. Callers must retry the same request semantics; conflicting
policy reuse is reserved for the next cross-repository contract batch.
