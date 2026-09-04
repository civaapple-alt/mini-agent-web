# Mini Agent Full-Stack Live LLM Smoke Test Report

> **Status**: **`FAILED`** | **Duration**: `10.11s` | **Date**: `2026-09-04 14:21:20`

## 1. Execution Metadata

| Property | Value |
| :--- | :--- |
| **Started At** | 2026-09-04 14:21:20 |
| **Finished At** | 2026-09-04 14:21:31 |
| **Total Duration** | 10.11s |
| **Overall Verdict** | **FAILED** |
| **OS** | `Windows 11 (AMD64)` |
| **Python** | `3.12.4 (CPython)` |
| **Primary Model** | `deepseek-v4-flash (https://api.deepseek.com)` |
| **Verifier Model** | `deepseek-v4-pro` |
| **App Server Binary** | `D:\gh-ws\codex-ws\mini-codex\target\release\mini-agent-app-server.exe` |
| **App Server Version** | `0.7.0` |

## 2. Phase Summary Table

| Phase | Title | Status | Duration |
| :---: | :--- | :---: | :---: |
| 1 | Environment & Capability Diagnostics | `PASSED` | 0.07s |
| 2 | Live Model Turn & Reasoning Streaming | `PASSED` | 0.80s |
| 3 | Autonomous Built-in Tool Calling (read_file) | `PASSED` | 1.54s |
| 4 | Sensitive Action Approval & Rejection Flow | `FAILED` | 7.60s |

## 3. Detailed Phase Logs

### Phase 1: Environment & Capability Diagnostics (`PASSED` - 0.07s)

```text
[PASS] OPENAI_API_KEY detected: sk-0ea...2e56
[PASS] Primary Model: deepseek-v4-flash at https://api.deepseek.com
[PASS] Verifier Model: deepseek-v4-pro
[PASS] Using App Server: D:\gh-ws\codex-ws\mini-codex\target\release\mini-agent-app-server.exe
[PASS] Protocol handshake successful: mini-agent-app-server v0.7.0
[PASS] Verified App Server capabilities: approvalRequests, workflows, items
```

### Phase 2: Live Model Turn & Reasoning Streaming (`PASSED` - 0.80s)

```text
[PASS] Started thread: smoke-turn-thread
[INFO] User Prompt: 'Answer in exactly 3 English words: What color is the clear sky?'
[PASS] Assistant response captured: 'blue'
[PASS] Turn completed with status: 'completed'
```

### Phase 3: Autonomous Built-in Tool Calling (read_file) (`PASSED` - 1.54s)

```text
[INFO] User Prompt: 'Use the read_file tool to read the file 'smoke_fixture_token.txt'. Report the exact SECRET_DATA token you find.'
[PASS] Tool call detected: read_file with args {'path': 'smoke_fixture_token.txt'}
[PASS] Tool execution succeeded: exit_code=None
[PASS] Model successfully synthesized tool output into response: 'The exact SECRET_DATA token in `smoke_fixture_token.txt` is:

**`TOKEN_1788502881_ALPHA_VERIFIED`**

Full line: `SECRET_DATA: TOKEN_1788502881_ALPHA_VERIFIED`'
```

### Phase 4: Sensitive Action Approval & Rejection Flow (`FAILED` - 7.60s)

**Error**:
```
Denial test did not trigger approval request
```

```text
[INFO] Step 1: Testing Approved Execution...
[INFO] Intercepted approval request: id=approval-1, action=shell
[INFO] Submitting typed decision: approve
[PASS] Approved shell execution completed through security broker (action=shell)
[INFO] Step 2: Testing Denied Execution...
[FAIL] Phase 4 (Approval & Security Permissions) failed after 7.60s: Denial test did not trigger approval request
```

## 4. Verification Verdict

One or more smoke phases encountered an error. Please inspect the logs above.