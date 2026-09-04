# Mini Agent Full-Stack Live LLM Smoke Test Report

> **Status**: **`PASSED`** | **Duration**: `36.48s` | **Date**: `2026-09-04 14:24:52`

> **Web Studio**: `bb089d6 (bb089d686ec94d56970bcfa55ffbc3e718fff735)` (2026-09-04 14:23:03 +0800)

> **App Server**: `v0.7.0` @ `f65ffb1 (f65ffb118113c03c6661d9ba50afd8d87f59b7ec)` (2026-09-04 13:39:19 +0800)

## 1. Execution Metadata

| Property | Value |
| :--- | :--- |
| **Started At** | 2026-09-04 14:24:52 |
| **Finished At** | 2026-09-04 14:25:28 |
| **Total Duration** | 36.48s |
| **Overall Verdict** | **PASSED** |
| **OS** | `Windows 11 (AMD64)` |
| **Python** | `3.12.4 (CPython)` |
| **Web Studio Commit ID** | `bb089d6 (bb089d686ec94d56970bcfa55ffbc3e718fff735)` |
| **Web Studio Commit Time** | `2026-09-04 14:23:03 +0800` |
| **App Server Version** | `0.7.0` |
| **App Server Commit ID** | `f65ffb1 (f65ffb118113c03c6661d9ba50afd8d87f59b7ec)` |
| **App Server Commit Time** | `2026-09-04 13:39:19 +0800` |
| **App Server Binary** | `D:\gh-ws\codex-ws\mini-codex\target\release\mini-agent-app-server.exe` |
| **Primary Model** | `deepseek-v4-flash (https://api.deepseek.com)` |
| **Verifier Model** | `deepseek-v4-pro` |

## 2. Phase Summary Table

| Phase | Title | Status | Duration |
| :---: | :--- | :---: | :---: |
| 1 | Environment & Capability Diagnostics | `PASSED` | 0.09s |
| 2 | Live Model Turn & Reasoning Streaming | `PASSED` | 1.80s |
| 3 | Autonomous Built-in Tool Calling (read_file) | `PASSED` | 2.01s |
| 4 | Sensitive Action Approval & Rejection Flow | `PASSED` | 7.92s |
| 5 | Plan Mode & Scratch Space Isolation | `PASSED` | 22.69s |
| 6 | Autonomous Goal Runtime & Independent Verifier | `PASSED` | 0.09s |
| 7 | FastAPI Gateway REST & Live WebSocket Turn | `PASSED` | 1.76s |

## 3. Detailed Phase Logs

### Phase 1: Environment & Capability Diagnostics (`PASSED` - 0.09s)

```text
[PASS] OPENAI_API_KEY detected: sk-0ea...2e56
[PASS] Primary Model: deepseek-v4-flash at https://api.deepseek.com
[PASS] Verifier Model: deepseek-v4-pro
[PASS] Using App Server: D:\gh-ws\codex-ws\mini-codex\target\release\mini-agent-app-server.exe
[PASS] Web Studio Commit: bb089d6 (bb089d686ec94d56970bcfa55ffbc3e718fff735) @ 2026-09-04 14:23:03 +0800
[PASS] App Server: v0.7.0, commit f65ffb1 (f65ffb118113c03c6661d9ba50afd8d87f59b7ec) @ 2026-09-04 13:39:19 +0800
```

### Phase 2: Live Model Turn & Reasoning Streaming (`PASSED` - 1.80s)

```text
[PASS] Started thread: smoke-turn-thread
[INFO] User Prompt: 'Answer in exactly 3 English words: What color is the clear sky?'
[PASS] Reasoning stream captured (434 chars): The user asks: "What color is the clear sky?" Answer in exac...
[PASS] Assistant response captured: 'Sky is blue.'
[PASS] Turn completed with status: 'completed'
```

### Phase 3: Autonomous Built-in Tool Calling (read_file) (`PASSED` - 2.01s)

```text
[INFO] User Prompt: 'Use the read_file tool to read the file 'smoke_fixture_token.txt'. Report the exact SECRET_DATA token you find.'
[PASS] Tool call detected: read_file with args {'path': 'smoke_fixture_token.txt'}
[PASS] Tool execution succeeded: exit_code=None
[PASS] Model successfully synthesized tool output into response: 'The file `smoke_fixture_token.txt` contains one line:

```
SECRET_DATA: TOKEN_1788503094_ALPHA_VERIFIED
```

The exact SECRET_DATA token is **`TOKEN_1788503094_ALPHA_VERIFIED`**.'
```

### Phase 4: Sensitive Action Approval & Rejection Flow (`PASSED` - 7.92s)

```text
[INFO] Step 1: Testing Approved Execution...
[INFO] Intercepted approval request: id=approval-1, action=shell
[INFO] Submitting typed decision: approve
[PASS] Approved shell execution completed through security broker (action=shell)
[INFO] Step 2: Testing Denied Execution...
[INFO] Intercepted approval request: id=approval-2, action=shell
[INFO] Submitting typed decision: deny
[PASS] Deliberate denial was respected; agent was blocked from unauthorized execution
```

### Phase 5: Plan Mode & Scratch Space Isolation (`PASSED` - 22.69s)

```text
[PASS] Switched thread collaboration mode to 'plan'
[INFO] Planning Prompt: 'Create a concise 2-step plan to add a unit test. Do not execute any changes, only output the numbered plan.'
[PASS] Plan formulated by model (1804 chars)
[PASS] Reset thread collaboration mode back to 'default'
```

### Phase 6: Autonomous Goal Runtime & Independent Verifier (`PASSED` - 0.09s)

```text
[INFO] Setting Thread Goal: 'Verify that git is working by checking git --version'
[PASS] Goal set successfully: status=active
[PASS] Verified goal status inspection: active
[PASS] Cleared Goal runtime state cleanly
```

### Phase 7: FastAPI Gateway REST & Live WebSocket Turn (`PASSED` - 1.76s)

```text
[PASS] REST: /health -> 200 OK healthy
[PASS] REST: /api/world/state -> 200 OK
[PASS] REST: /api/workflows/state -> 200 OK
[PASS] REST: /api/settings -> access=project
[PASS] WebSocket: /ws/agent ping/pong verified
[INFO] WebSocket Turn Prompt: 'Say 'GATEWAY_OK' in uppercase.'
[PASS] WebSocket: Live streaming turn succeeded: 'GATEWAY_OK'
[PASS] SessionStore: Thread 'default' verified in canonical store
```

## 4. Verification Verdict

All 7 smoke phases completed successfully with zero protocol or runtime errors.