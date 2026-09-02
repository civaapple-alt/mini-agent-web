# Changelog

All notable changes to the `mini-agent-web` workspace and official Python SDK (`mini-agent`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed

- **Cookbook Demo 04 timing**: replaced fixed steering/interruption sleeps with
  event-driven turn submission and explicit handling for a turn that settles
  before the control request arrives.
- **Cookbook Demo 05 runtime binding**: reattaches the App Server's bound
  runtime Thread before exercising collaboration mode and Goal Runtime APIs.
- **Cookbook Demo 05 rerun safety**: observes Goal Runtime `turnId` notifications,
  interrupts resumed automatic turns, and clears Goal state during startup and
  shutdown so a previous run cannot block `thread/start` on the next run.
- **TUI workflow thread binding**: routes `/profile`, `/plan`, and `/goal` to
  the App Server's bound runtime Thread while preserving independently switchable
  conversation threads.
- **Plan Mode Shell guidance**: documents that the App Server permits bounded
  read-only Shell inspection in Plan Mode while continuing to lock mutations.

---

## [0.7.0] - 2026-09-02

### Added

- **Codex-aligned Thread protocol**: synchronized the Python SDK, FastAPI Gateway, Web Studio, TUI, and Cookbook with App Server 0.7.0.
- **ThreadItem projections**: exposed bounded tool-call `ThreadItem` data through `turn/event` and `turn/read`, with stable reconciliation in Studio and direct rendering in TUI.
- **Thread settings and Goal Runtime APIs**: added collaboration mode settings, `thread/goal/set|get|clear` wrappers, runtime notification forwarding, and Goal status/token/time projections.
- **Deterministic compatibility coverage**: extended SDK, Gateway, frontend, TUI, and no-provider Cookbook tests for ThreadItem and runtime notifications.

### Changed

- **Removed legacy workflow surface**: replaced manual Plan/Goal workflow methods with `thread/settings/update` and Thread Goal Runtime; no compatibility adapter is retained for the removed methods.
- **Synchronized release metadata**: updated repository, SDK, server, frontend, lockfile, and documentation version references to `0.7.0`.

### Pre-release changes included in 0.7.0

#### Added

- **Lightweight Native Toast Notification System**:
  - Replaced native browser `alert()` and `confirm()` dialogs across Sidebar, InputBar, SettingsModal, and SidePanel with smooth, non-blocking, auto-dismissing Toast notifications (`Toast.jsx`).
- **Pure Utility Modules & Direct Test Coupling**:
  - Extracted pure stream reducer (`src/utils/messageState.js`) and command parser (`src/utils/slashCommands.js`), eliminating golden-copy test drift by having both production UI and Node unit tests import the exact same implementations.
- **UI Polish, Skeleton Loading & Word Wrap**:
  - Added CSS rules for `.wrap-content` and `.nowrap-content` in `ChatArea.css`, enabling active toggling of word wrapping.
  - Implemented `@keyframes pulse` animated skeleton loading screen during thread history retrieval.
  - Added global `Escape` key handling to close modals, SidePanel drawers, and popovers.
- **Tauri 2.0 Desktop Application Proposal**:
  - Drafted ADR proposal for Mini Agent Native Desktop Application (`docs/adr/proposed/2026-09-02-tauri-desktop-app-and-app-server-integration.md`).
- **Client Architecture & Performance Analysis Doc**:
  - Published multi-dimensional comparison analyzing Rust REPL, Python TUI, and Web Studio (`docs/client-architectures-and-performance-comparison.md`).

#### Fixed

- **Turn Mode Protocol Contract Compliance (R1)**:
  - Removed UI-specific `default_mode` (`chat` / `plan` / `goal`) from WebSocket `turn` action payload to strictly preserve standard `start` / `continue` / `steer` / `follow_up` wire protocol.
  - Added server-side validation in `server/routes/agent.py` ensuring non-standard mode strings automatically sanitize to `"start"`.
- **WebSocket Ready-State Guard & Zero Message Loss (A1)**:
  - Added `.isOpen()` ready-state check in `handleSendMessage` before message dispatch; prevents silent message drops and rolling back optimistic bubbles when reconnecting.
- **Cross-Thread Stream Event Isolation (A2)**:
  - Enforced `shouldAcceptEventForThread` filtering, rejecting foreign thread stream deltas while allowing thread lifecycle finish notifications.
- **Profile System Alignment (A3)**:
  - Aligned client profile values to `interactive` / `auto` / `ask` across Settings, InputBar, and server schemas.
- **Chinese IME Composition Enter Guard (A4)**:
  - Added `e.nativeEvent.isComposing || e.keyCode === 229` guard in InputBar to prevent accidental sends during IME candidate selection.
- **Native `/steer` Command Execution (A5)**:
  - Connected `/steer <instruction>` directly to server steering API with active generation runtime checks.

#### Documentation

- Synchronized `README.md`, `docs/README.md`, `frontend/README.md`, and indexed new comparison docs and proposed ADRs.

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
