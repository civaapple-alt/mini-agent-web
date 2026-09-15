# Cookbook tool outcome contract

状态：implemented  
Date: 2026-09-15  
Batch: Cookbook and SDK contract synchronization, Batch 1  
Scope: Python Cookbook examples and SDK protocol evidence

## Decision

Live Cookbook examples read tool results from the SDK's typed event and item
projections. They display lifecycle `status` separately from tool `outcome`.
The offline protocol example covers the five known outcomes and preserves a
future outcome string without converting it to failure.

No SDK API, wire field, approval rule, retry path, or Web Studio execution
behavior changed. The examples remain independent and the live examples still
require an App Server and provider credentials.

## Harness hypothesis

If Cookbook examples consume the typed outcome contract directly, developers
will not copy the old `is_error`-to-`OK/ERROR` shortcut into Gateway or Web
Studio code. A future server outcome will remain visible to the consumer.

## Ownership and boundaries

- App Server and mini-codex Host/Capabilities own admission, approval, retry,
  execution, and the authoritative outcome.
- The Python SDK parses and preserves `ToolFinishedEvent.outcome` and
  `ThreadItem.outcome`.
- Cookbook examples only render the SDK projection. They do not approve tools,
  retry calls, or execute locally.

## Cross-repository contract

`ThreadItem.status` remains lifecycle state. `ThreadItem.outcome` remains tool
result state. Known outcomes are `completed`, `failed`, `needs_approval`,
`deferred`, and `retryable`. Unknown strings pass through unchanged.

## Verification

- `uv run python cookbook/python-demo/06_protocol_compatibility.py`: passed with
  five known and one unknown outcome fixture.
- `uv run pytest -q tests/cookbook tests/sdk`: 41 passed.
- `uv run ruff check cookbook/python-demo sdk/python tests/cookbook tests/sdk`:
  passed.
- `uv run ruff format --check cookbook/python-demo sdk/python tests/cookbook tests/sdk`:
  18 files already formatted.
- `git diff --check`: passed with only Windows line-ending warnings.
- No live provider, App Server execution, or public protocol change was used.

## Remaining risks

- Live examples are compile-checked but are not part of the default provider-free
  test path.
- Batch 2 still needs offline recovery, Session fork conflict, EOF, and
  independent execution-policy examples.
