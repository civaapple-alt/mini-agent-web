# Changelog

All notable changes to the `mini-agent-web` workspace and official Python SDK (`mini-agent`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Approval lifecycle visibility**: App Server now emits the approval
  `requested` and `resolved` notifications, and Python SDK `stream_turn()`
  surfaces both records, including when `approval_handler` is omitted.

### Documentation

- Added `AGENTS.md` and synchronized the README, SDK guide, Cookbook guide,
  ADRs, and validation notes with the 0.6.0 release surface.

## [0.6.0] - 2026-09-01

### Added

- **SDK 0.6.0 protocol alignment**: added typed context-compaction and run-lifecycle events, structured run-failure details, and the `event_type` convenience property.
- **Bounded stream routing**: `stream_turn()` now filters notifications to the requested Thread/Turn and returns cleanly when App Server reports a queued or non-submitted turn without a turn ID.
- **Explicit App Server selection**: `MINI_AGENT_APP_SERVER_PATH` is now honored when the default executable name is used.
- **Cookbook validation**: added Demo 06 and no-token tests that compile every Cookbook script and exercise the complete 0.6.0 event fixture set.

### Fixed
- **Approval Handshake (SDK)**: `_handle_approval_request` now introspects the registered approval callback's signature — 1-param dict form, 2-param `(request_id, action)` form, or 3-param extended form — and parses `bool` / `dict` / `str` decision results. This restores sensitive-tool approvals from the Web Studio UI; previously every approval raised a `TypeError` and was denied by default, surfacing as "shell 失败" on tool calls.
- **WebSocket**: registered the root `/ws/agent` endpoint so browser clients can connect, and added an automated WebSocket regression test.
- **Serializer**: `stream_turn` now safely serializes dataclasses and filters non-serializable objects instead of raising mid-stream.
- **Logging**: default log level lowered to INFO, suppressing verbose token-delta stdout logs.
- **Shutdown (Windows)**: resolved the asyncio subprocess termination deadlock on Ctrl+C; WebSockets now close cleanly on shutdown.
- **Web UI**: support sequential thinking blocks, stop the tool icon spinner after completion, and parse tool content outputs.

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
- **FastAPI Web API Gateway (`server/`)**:
  - Asynchronous gateway providing RESTful endpoints, SSE event streams (`/api/agent/stream`), and bidirectional WebSocket (`/ws/agent`).
  - Integrated `SessionManager` handling background `MiniAgentClient` lifecycles and broadcast channels.
  - Bidirectional security approval handshake enabling human-in-the-loop authorization over Web UI.
  - Endpoints covering Thread lifecycle, WorldState detection, MCP tool status/retry, Plan Mode, and Goal workflows.
- **Modern Web Studio React SPA (`frontend/`)**:
  - React 19 + Vite 6 single-page web app styled in Cursor / ChatGPT / Claude aesthetics.
  - Componentized modular architecture (`Header`, `Sidebar`, `ChatArea`, `ThinkingBlock`, `ToolCard`, `ApprovalDialog`, `InputBar`, `WorldDrawer`).
  - Real-time Markdown rendering with `remark-gfm`, syntax highlighting, and copy buttons.
  - Streaming Thinking accordion displaying model reasoning process and elapsed time.
  - Dynamic Tool Execution cards (status badges, arguments, expandable output logs).
  - Prominent interactive Security Approval dialogs for sensitive tool calls.
  - Live Steering prompt injection and Interrupt buttons.
  - Thread history sidebar with branch forking and WorldState drawer.
- **Terminal User Interface (`tui/`)**:
  - Rich-based interactive CLI terminal application (`tui_app.py`).
  - Terminal-based streaming Markdown, Thinking panels, and approval prompts.
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
