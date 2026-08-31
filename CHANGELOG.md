# Changelog

All notable changes to the `mini-agent-web` workspace and official Python SDK (`mini-agent`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.5.0] - 2026-08-31

### Added
- **Official Python SDK (`mini-agent`)**:
  - Standalone package in `sdk/python` with full PEP 561 compliance (`py.typed`).
  - Zero mandatory external dependencies (pure Python standard library `asyncio`, `json`, `subprocess`, `dataclasses`, `logging`).
  - Async context manager client (`MiniAgentClient` / `AsyncMiniAgentClient`) communicating over Stdio JSON-RPC 2.0.
  - Strongly-typed event dataclasses and factory parser (`events.py`, `parse_event`).
  - Protocol dataclasses for turns, threads, tool calls, checkpoints, and model token usage (`types.py`).
  - Hierarchical error classes rooted at `MiniAgentError`, including `AppServerError` with structured codes and metadata (`errors.py`).
  - Dynamic file logging with script-name auto-detection (`logs/<script_name>.log`) and support for overwrite/append modes.
  - Helper method `wait_for_turn` for automated polling until turn completion/interruption.
- **Cookbook Demos (`cookbook/python-demo/`)**:
  - `01_basic_turn.py`: Basic turn execution, reasoning extraction, and token usage inspection.
  - `02_streaming_events.py`: Deep token-by-token streaming, multi-step tool call tracking, and UTF-8 truncation handling.
  - `03_approval_handling.py`: Sensitive tool interception and terminal-based interactive approval callback.
  - `04_steering_and_interrupt.py`: Real-time instruction steering mid-flight and cooperative turn interruption.
  - `05_workflows_and_inspection.py`: WorldState system inspection, read-only Plan Mode, and settled thread checkpoints.
- **Comprehensive Documentation (`docs/`)**:
  - `docs/python-sdk-guide.md`: Official developer guide and usage manual.
  - `docs/sdk-maturity-and-protocol-coverage.md`: SDK maturity radar and JSON-RPC 2.0 protocol coverage matrix.
  - `docs/app-server-concurrency-and-deadlock-analysis.md`: Deep dive on Tokio multi-thread runtime, Actor self-deadlock, SSE keep-alive drain, and child process isolation.
  - `docs/adr/2026-08-31-python-sdk-architecture-and-app-server-integration.md`: Architecture Decision Record aligning with OpenAI Codex client separation.

### Fixed & Hardened (Backend Engine Alignment)
- **Protocol Schema**: Fixed `turn/steer` payload formatting to match App Server's `TurnSteerParams` schema (`text` parameter).
- **Concurrency & Approval Deadlock**: Switched `mini-agent-app-server` runtime to multi-threaded Tokio (`rt-multi-thread`) so synchronous `receiver.recv()` in approval workflows does not starve the JSON-RPC event loop.
- **Transport Actor Self-Deadlock**: Replaced re-entrant `connection.thread_id().await` in `transport.rs` with synchronous snapshot reading.
- **SSE Stream Hangs**: Updated OpenAI-compatible SSE drain loop to break immediately upon receiving `response.completed`, preventing 60s+ keep-alive socket hangs with DeepSeek and third-party gateways.
- **Child Process Isolation**: Isolated child shell `stdin` with `Stdio::null()` and injected non-interactive environment variables (`GIT_TERMINAL_PROMPT=0`, `GIT_PAGER=cat`, `PAGER=cat`, `CI=1`, `TERM=dumb`) to eliminate interactive pager hangs.
