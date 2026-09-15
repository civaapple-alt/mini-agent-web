# Legacy tool typed migration

状态：implemented  
Date: 2026-09-15  
Batch: Iteration 10, typed admission and execution for built-in file and URL tools  
Scope: mini-codex Capabilities/Host boundary and the unchanged SDK/Gateway/Web consumer contract

## Decision

`ReadFile`, `ReadImage`, and `WebFetch` no longer rely on the default `Legacy`
admission. Workspace and configured extension-root reads are `Allowed`; existing
files outside those roots produce `ApprovalRequired`. `ReadImage` keeps its
local-read, outside-workspace approval, and magic-byte checks. The old direct
`ReadFile.execute` entry point preserves its path-denial compatibility behavior;
the Host typed path uses `execute_after_admission`.

`WebFetch` validates URL syntax, DNS address class, and credentials during
admission. Loopback is an explicit allowed local target, while public URLs cross
the Host approval boundary. Execution maps local `FetchError::{Failed,
Retryable}` to structured outcomes: transient transport failures are retryable,
while URL security, size, encoding, and redirect-policy failures remain failed.
No Host-wide error-text classifier was restored.

## Harness hypothesis

If every built-in tool performs bounded typed admission before side effects and
returns a typed execution outcome afterward, local paths, outside-workspace
paths, Plan Mode, timeouts, and external network failures will keep stable
semantics across the Core/Host chain; diagnostic wording will not change loop
control or trigger a second approval.

## Ownership and boundaries

- Capabilities `ToolHandler` parses arguments and owns typed admission.
- Host `ToolOrchestrator` owns approval ordering and consumes admission without
  classifying error text.
- Capabilities `ToolRuntime` owns side effects and local outcome classification.
- Core/App Server keep the existing `ToolExecutionOutcome` and Item projection.
- SDK, Gateway, and Web Studio consume the public result and never copy path
  authorization or decide retry/approval.

## Cross-repository contract

The public wire shape is unchanged: `ThreadItem.status` remains lifecycle state
and `ThreadItem.outcome` remains tool-result state. `Allowed`,
`ApprovalRequired`, `Deferred`, `Completed`, `Failed`, and `Retryable` remain
internal typed boundary semantics that App Server projects without a second
Legacy protocol. Python SDK, Gateway, and Web Studio continue to pass through
the public fields.

## Verification

- `cargo fmt --all`: passed.
- `cargo test -p mini-agent-capabilities --lib`: 79 passed.
- `cargo test -p mini-agent-host --lib`: 34 passed.
- `cargo test -p mini-agent-app-server --lib`: 57 passed.
- Capabilities, Host, and App Server `cargo clippy --all-targets -- -D warnings`: passed.
- `python scripts/line_budget.py --base 8e45501 --check-delta --json`: no violations; runtime `+0`, release `+166`, control plane `+61`, green.
- `git diff --check`: passed.

## Consequences

- Built-in tools now have an explicit admission owner, and the Host no longer needs a Legacy default for them.
- WebFetch can report transient network failures as `retryable` without making security denials retryable.
- The compatibility `execute` path and public protocol remain available; no automatic retry, approval cache, or second loop was added.

## Remaining risks

- No real public network, provider, or paid API call was made; resolver and redirect security fixtures belong to Batch 11.
- `ToolError` remains a compatibility string carrier; structured semantics are produced at the local ToolRuntime/Host boundary.
- Batch 11 still needs complete Plan Mode coverage for Shell, SpawnAgent, and MCP, context-compaction hard-limit evidence, and Harness Scenario/Eval coverage.
