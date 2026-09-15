# Security boundaries and hard-limit evidence

状态：implemented  
Date: 2026-09-15  
Batch: Iteration 11, cross-repository consumer contract  
Scope: mini-agent-web SDK/Gateway/Web Studio consumption of mini-codex boundary evidence

## Decision

Batch 11 keeps the security authority in mini-codex Capabilities/Host and keeps the Web
repository as a consumer. Web Studio does not implement Plan Mode authorization, WebFetch
resolver checks, retry classification, or local execution. The SDK and Gateway preserve
`ThreadItem.status` as lifecycle state and `ThreadItem.outcome` as tool-result state,
including unknown outcome strings.

The existing WebSocket reconnect path continues to reconcile with App Server authority
through `attachThread`, `runtime/status`, `thread/items/list`, history, and replay. No
second Gateway execution state machine or recovery-only public endpoint was added for the
Batch 11 hard-limit evidence.

## Harness hypothesis

If Web Studio only projects the authoritative typed result and recovery state, then adding
Plan Mode, resolver, or compaction safeguards in mini-codex cannot create a second browser
policy or cause the UI to reinterpret a lifecycle status as approval or retry state.

## Ownership and boundaries

- mini-codex Core owns loop and context byte accounting.
- mini-codex Capabilities/Host own typed admission, network address classification, side
  effects, approval, and retry semantics.
- App Server owns public event and Thread Item projection.
- The SDK preserves protocol fields; Gateway routes and reconciles transport state; Web
  Studio renders status/outcome and reconnecting state.

## Cross-repository contract

The public contract remains unchanged: `status` is lifecycle, `outcome` is tool result,
and unknown outcome values are passed through. Browser and Gateway code must not cache
authorization or infer retry/approval from text, status, or a missing event.

## Verification

- mini-codex Batch 11 evidence: Core 43 tests, Capabilities 80 tests, two CLI public
  scenarios, one App Server MCP projection test, workspace Clippy, and line-budget delta
  all passed.
- Existing Web Batch 8/9 verification remains green: SDK/Gateway tests 85 passed, Node
  tests 53 passed, Vitest 36 passed, frontend build and lint passed.
- No Web production code changed in this batch; no paid provider or browser-side security
  implementation was introduced.
- The companion boundary and scenario record is maintained in mini-codex
  `docs/harness-boundaries.md` and `docs/harness-evidence.md`.

## Remaining risks

- Web cannot prove hostile DNS, provider quality, sandbox isolation, or a future SpawnAgent
  path; those remain authoritative-runtime work.
- The browser can display recovery failure when App Server authority is unavailable, but
  must not reconstruct authority from Gateway caches.
- Batch 12 remains deferred until the current EOF, permission, and result contracts have
  longer-running evidence.
