# Session fork context policy contract

Status: implemented
Date: 2026-09-15
Batch: Iteration 3, durable fork result metadata

## Decision

`ClientPool` keeps the requested `context_policy` in the derived child-thread
metadata and checks it before reusing an already bound child client. A retry with
the same source Thread, child Thread ID, and policy returns the existing child
metadata. A retry with another policy is a conflict and does not rebind the
child.

The Gateway still treats the App Server Session header as the durable authority.
Its metadata is routing state needed to avoid duplicate child processes, not a
second Session store or an authorization cache.

## Harness hypothesis

If the Gateway preserves the fork policy across its retry path and the App Server
persists the policy and compaction result in the child Session header, a retry can
return the original result without a second model preparation or child process.
Policy changes under the same child identity must be rejected explicitly.

## Ownership and boundaries

- App Server/SessionStore owns durable fork identity, lineage, policy, and result
  metadata.
- Gateway `ClientPool` owns project binding and the live child-client lifecycle.
- The REST route maps `RuntimeError` policy conflicts to HTTP `409`.
- The Gateway does not scan or write `session.jsonl` and does not infer missing
  historical compaction metadata.

## Cross-repository contract

The Rust side persists bounded `context_policy`, before/after context bytes,
`compacted`, and `method` fields in the child Session header. It preflights a
matching fork before Core context preparation and returns the persisted result.
The Web side forwards the request policy, stores it with the bound child metadata,
reuses an exact match, and rejects a mismatch with `409`.

## Verification

- Focused Gateway tests cover one child creation for repeated requests and `409`
  for a different policy.
- `uv run pytest -q tests/gateway/test_gateway_goals_and_items.py tests/gateway/test_session_manager.py`
  passes 56 tests; it retains two existing Windows asyncio resource-destructor
  warnings.
- `uv run ruff check server/control/client_pool.py tests/gateway/test_gateway_goals_and_items.py`
  passes.
- Rust Capabilities (77) and App Server (57) tests pass; affected-package clippy
  and formatting pass.
- `python scripts/line_budget.py --base 4ecd041 --check-delta --json` reports no
  violations: runtime `+96`, release Rust `+248`, control plane `+247`.

## Remaining risks

- Old Gateway metadata without `context_policy` cannot prove which policy created
  the child; the Gateway preserves compatibility instead of guessing.
- A cross-process Rust policy conflict is currently a checkpoint error rather than
  a dedicated public conflict code; a later protocol batch should align that error
  with the Gateway `409` behavior.
