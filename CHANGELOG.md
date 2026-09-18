# Changelog

All notable changes to the `mini-agent-web` workspace and official Python SDK (`mini-agent`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

- Hide synthetic context-compaction handoff summaries from the user input
  history and Session Turn rail while preserving the summary for the next model
  context and the structured compaction card.
- Add cross-Turn local background Shell task projection to the SDK, Gateway, and
  Web Studio runtime panel. Child Sessions can read the parent task list but
  cannot control it; remote waits such as GitHub Actions use the scheduled marker
  described below rather than a local Shell task.
- Add bounded scheduled wake-up task projection to the SDK, Gateway, and runtime
  panel. A ready marker lets a later model Turn perform one remote status query;
  it does not run Shell, auto-resume the model, or cancel the remote operation.

- Redact free-form approval arguments from SDK and Gateway logs. Approval
  records now keep the tool name, bounded `apply_patch` counts, and request ID
  without printing complete Shell commands or paths.
- Keep the Session Turn rail visible as an independent sticky navigation column
  instead of rendering each node inside an individual user message row.
- Make the approval dock show structured `apply_patch` change counts, including
  deletions, and expandable bounded target paths before the operation runs.
- Keep Project-associated roots separate from Gateway-owned Session attachment
  roots by passing attachments through `MINI_AGENT_SESSION_READ_ROOTS` as a
  read-only capability. Prompt Context now reports the bounded attachment-root
  count without treating Session files as Workspace roots.
- Simplify the Workspace system-injection view: show a compact runtime summary
  by default and keep the full prompt context behind an explicit expand action
  with a copy control.
- Render the expanded system-injection context as indented, line-numbered XML
  with highlighted tags, attributes, and values for easier inspection.
- Keep selected Skill names in removable composer chips and remove the
  duplicate `$skill` token from the visible prompt while preserving structured
  `selectedSkills` submission.
- Make Child scheduling intent per delegation: project/global settings retain only
  `max_concurrent_children`, while Main Thread `delegate_task` requests choose
  `parallel` or `sequential` with optional group and sequence metadata.
- Bundle the ChatGPT-compatible `pstack` skills with WebStudio and synchronize
  them idempotently into the Mini Agent per-user builtin skill directory.
- Add project-scoped builtin skill group settings, the `/api/skills` catalog,
  `+` workflow activation, namespaced `$skill` completion/chips, and
  replayable `skill_group_activated`, `skills_loaded`/
  `skills_load_failed` stream events.
- Expand the Skill panel with pstack's per-Skill descriptions, canonical names,
  aliases, and explicit-vs-on-demand activation labels. The panel now warns
  when an enabled pstack runtime returns no group catalog, and all composer
  popups close when the user clicks outside them.
- Add a top-level `计划查看` tab next to the runtime and workspace views. The
  plan artifact now has a full-height Markdown reader and file switcher, while
  Plan Mode controls remain in the plan surface and Thread Goal controls are
  kept separate; the status bar opens the dedicated plan view directly.
- Split the drawer's plan controls into focused top-level `计划` and `目标` tabs,
  move Builtin Tools permissions into the Workspace subtabs, and hide README
  artifacts from the plan file reader.
- Simplify the Plan tab to a mode status/toggle plus a full-width `plan.md`
  reader, and add a stacked goal-file selector with a full-width reader below
  the Thread Goal controls.
- Fix the Plan review `开始实施` action so it disables Plan Mode and immediately
  submits the next implementation Turn using the current plan.
- Fix Thread input history to merge bounded durable user-item projections with
  checkpoint messages, follow history cursors, and preserve persisted input
  timestamps. Simplify the history rows, hide Gateway attachment context from
  displayed prompts, and show safe image-count metadata without exposing raw
  image bytes or filesystem paths.
- Add independent Child Session lifecycle projection with persisted operation
  status, cooperative cancel, bounded retry, delegated child observation, and a
  Session notebook read endpoint. Gateway remains an orchestration layer and
  does not create a second history or scheduler authority.
- Add bounded pasted-text attachments for long diagnostics and logs. Web Studio
  keeps short pastes in the composer, stages large/log-shaped pastes as
  removable `pasted-text.txt` attachments, and lets the Gateway store them in
  the isolated Project/Thread attachment directory for on-demand `read_file`
  access without expanding the message bubble.
- Unify the composer plus menu around file selection, Goal, and Plan Mode. Images
  use the file entry, while copied or dropped folders are recorded as physical
  read-only path references instead of being copied or expanded into relative
  paths. Goal and Plan chips activate only when their task is submitted or
  dequeued, and file/path metadata remains attached to the queued message.
- Add the first explicit child-runtime control seam. Web Studio can derive an
  exact child Session from the parent's latest settled checkpoint while the
  parent Turn is active, start one Turn in an independent App Server client,
  and list child lineage/status without introducing a Core scheduler.

## [0.8.0] - 2026-09-15

### Fixed

- **Stopping and App Server EOF recovery:** keep transport cancellation and EOF
  separate from Turn settlement. The Gateway no longer invents terminal
  `turn_finished` events or marks a Turn failed on process EOF, and a persisted
  child fork remains attachable if its client starts late. Web Studio reconnects
  through the existing attach, runtime status, history, item, and event replay
  reads without creating a second execution state machine.

- **Session fork conflict contract**: persist fork policy and compaction metadata
  in the App Server child Session, return the durable result on an identical
  retry, and expose child-lineage or policy conflicts as structured JSON-RPC
  errors. The Gateway maps the conflict code to HTTP 409 while preserving the
  error data for clients.

- **Large-session restart recovery**: keep Gateway Session catalog visibility
  aligned with the App Server's 32 MiB SessionStore bound, configure the SDK
  stdout reader for bounded checkpoint responses, and recover a previous
  history when a crash left the thread index pointing at a new empty Session.
  Reader failures now reap the dead App Server process so later stop or resume
  requests do not wait on a closed pipe until the generic request timeout.

- **Low-interruption trusted execution**: ordinary validated workspace actions
  and Shell commands no longer open a Web Studio approval prompt under the
  `trusted` policy; recursive or forced deletion, destructive Git and system
  commands, MCP/external actions, and Security Deny rules remain protected.

- **Workspace attachment isolation**: store Web Studio image uploads in the
  Gateway state directory, scoped by Project and Thread, and pass only the
  current Thread's attachment directory to the runtime as a read-only root;
  uploads no longer create `.mini-agent/attachments` inside the Project.

- **Partial `read_file` result visibility**: preserve the protocol's `content`
  field when reconciling legacy tool-finished events, show requested line ranges
  in the tool summary, and auto-expand bounded completed `read_file` results so
  paginated content and `next_offset` are visible in the message stream.

- **Long reasoning visibility**: keep the bounded ThinkingBlock viewport
  following newly streamed reasoning until the user scrolls upward; returning
  to the bottom resumes following the latest content.

- **Approval-aware interruption settlement**: stopping a Turn while a tool
  approval is pending now resolves the approval as an explicit denial before
  releasing the App Server wait. The approval controls are visibly locked, the
  active Turn identity remains until its authoritative terminal event, and a
  stop/approval race cannot publish a contradictory result.

- **Approval result visibility**: keep each approval request and resolution
  attached to its matching tool card, so allow, deny, expiry, interruption, and
  peer-window handling remain visible in the message stream after the approval
  dock closes. Same-name tool calls no longer all appear to be awaiting approval.

- **Reasoning segment reconciliation**: assign one stable identity to each
  model-response reasoning segment and make streaming, lifecycle, replay, and
  ThreadItem projections idempotent, so a later reasoning segment is not
  appended to an earlier ThinkingBlock and rendered twice.

- **DeepSeek model naming**: align Web Studio examples with the current
  unified `deepseek-flash` model entrypoint.

- **Provider web search visibility**: keep the enabled server-side
  `web_search` capability distinct from Host function tools and document the
  supported DeepSeek Responses model identifier, so a user-level
  `MINI_AGENT_WEB_SEARCH=true` setting is not silently confused with the
  `web_fetch` extension.

- **Web `.env` discovery**: include the Web workspace `.env` when the Gateway
  starts an App Server for a Project located outside the Web repository, while
  preserving Project-over-Web-over-user precedence.

- **Reasoning/output ordering**: prevent a late reasoning stream from being
  rendered after the assistant's final answer in Web Studio.

- **Multi-browser approval synchronization**: an accepted approval decision is
  immediately broadcast to all same-Project Studio clients; stale peer approval
  docks close authoritatively, duplicate or late responses show a conflict/expiry
  warning, and a disconnected WebSocket falls back to the HTTP approval endpoint.

- **Concurrent approval identity and queueing**: approval waits now use the
  scoped tool `call_id` when provider `requestId` values collide; Gateway
  routing rejects ambiguous request-id-only responses, while Web Studio queues
  multiple approvals one at a time and preserves each result in the transcript.

- **Approval-safe Turn interruption and Plan lifecycle**: stopping a Turn now
  invalidates its pending and late approval requests before cancelling the local
  stream; a failed remote interrupt no longer masquerades as a settled Turn; the
  Studio keeps a visible stopping state until authoritative settlement, and
  Thread settings reject Plan Mode changes while a Turn or approval is active.

- **Multi-session interruption and failure isolation**: browser/WebSocket
  disconnects no longer cancel Gateway-owned Turn streams; App Server EOF now
  settles waiting SDK consumers; stale stream cleanup and concurrent Turn errors
  cannot clear a newer active Turn; Gateway shutdown cancels owned streams before
  stopping per-session clients.

- **Live execution policy changes**: changing the access or approval policy no
  longer restarts the active project runtime and interrupts an in-flight Turn;
  Web Studio asks users to wait for the current Turn to settle before changing
  policy.

- **Mini Agent branding**: replace user-visible Codex Studio labels in Web
  Studio and generated project README content with the Mini Agent brand while
  retaining Codex terminology only for internal CSS identifiers and technical
  compatibility references.

- **Web Studio slash commands**: remove the stale `/steer` runtime hint and
  support `/plan <task>` by enabling Plan Mode before submitting the task;
  selecting `/plan` now also leaves a trailing space for direct task entry.

### Added

- **Structured tool outcomes:** expose `ToolOutcome` through the Python SDK,
  Gateway, TUI, and Web Studio ThreadItem projections. Web Studio renders
  `completed`, `failed`, `needs_approval`, `deferred`, and `retryable` outcomes
  separately from lifecycle `status`, while preserving unknown future strings.

- **Cookbook protocol and recovery examples:** update the live Python examples
  to consume typed tool outcomes and add provider-free coverage for outcome
  compatibility, EOF recovery, runtime projection, Session fork results, and
  structured fork conflicts.

- **Approval action evidence**: record request and resolution metadata in the
  per-Thread `approval-evidence.jsonl` sidecar, including a `session_item_id`
  join key so risk review can recover the bounded command from the co-located
  Session log without duplicating it in the trace.

- **Web Studio UI simplification**: consolidate Plan, Goal, Runtime, connection,
  execution settings, and scoped Turn identity into one status rail with a
  three-level details drawer; keep the composer focused on task input and move
  access, approval, and continuation controls into the run-settings popover.
  Add mobile navigation, Escape-close drawers, semantic Light/Dark theme tokens,
  and explicit cancellation visibility for approval-pending Turns.

- **Session identity visibility**: show the canonical SessionStore `session_id`
  beside the display title in the current-session header and project session tree;
  keep the full value available through the hover label and include it in session
  search without changing logical Thread routing.

- **Independent Session branches**: make Web Studio's fork operation create a new
  persisted Session from the latest settled checkpoint, copy that checkpoint exactly
  by default, and start a separate App Server client. Explicit `contextPolicy=compact`
  can compact the child before persistence. Parent and child Threads no longer share a
  process or Session lock, and the returned canonical `session_id` is shown in the
  Studio catalog.

- **User input trace and Thread history**: add a hover/focus trace card to each
  user input, showing its Project/Thread/Turn scope, captured execution
  settings, and attachment summary. Inputs can be placed back into the
  composer for adjustment, and the details drawer now provides the loaded
  current Thread input history. Historical messages explicitly show when
  submission-time settings or attachment details were not persisted.

- **Scoped execution settings and background approvals**: project-level access and
  approval policy changes now fan out to every idle Client in that project; pending
  approval requests carry Project/Thread/Turn identity and are restored when Studio
  switches back to the waiting session.

- **Web Studio 多项目多会话并发与实时切换**：项目切换不再停止其他项目的运行时；
  侧栏按最新会话 catalog 显示运行中、已完成、已中断等状态，切回运行中的会话时
  通过有界事件回放补齐快照后的流，并对外部锁定会话提供只读查看。

- **Documentation synchronization**: document project-qualified routing, request
  epoch cancellation, atomic Session projection resets, the separate Turn/process
  status model, persisted Plan review confirmation, grouped Compaction details,
  and Plan/Shell policy boundaries in the server, frontend, limits, and
  troubleshooting guides.

- **Session projection race guards**: add request cancellation and epoch checks
  to the Web Studio thread/project/settings surfaces, reset all Turn and
  workflow projections atomically for new, forked, closed, and switched
  Sessions, and keep Plan review confirmation recoverable after reload.

- **Project-scoped runtime routing**: bind WebSocket subscriptions to their
  current project, filter gateway broadcasts before delivery, and include
  Thread/Turn/Project identifiers on turn-control errors.

- **Crash-safe Session status**: an unsettled record without a live SessionStore
  lock is now shown as recoverable rather than an actively running Turn; legacy
  history hydration never attaches an unmatched item to the first assistant
  message.

- **Plan implementation confirmation**: after a completed Plan Mode turn, Web
  Studio now asks whether to continue planning or start implementation; choosing
  implementation automatically switches the Thread back to the default mode.

- **Goal verifier observability and recovery**: expose verifier lifecycle updates
  in the Web Studio console and Goal detail, keep session-owned `goal/plan.md`
  and `goal/verifier_verdict.md` readable while a Goal is running, and retain
  bounded workflow state when a SessionStore checkpoint exceeds the gateway
  record limit.

- **Decoupled Approval Policy & Multi-Scope Action Grants**:
  - Added the explicit `trusted` approval policy across SDK, Server (`/world/execution`), and Web Studio. It directly admits only fully validated non-destructive workspace patches; high-risk, destructive, Shell, and MCP actions still require approval.
  - Kept `automatic` as bounded low-risk admission. Auto Copilot is now an explicit Web Studio preset that combines `trusted` with the separate `continuous` Thread continuation mode; it is not inferred from access scope or approval policy.
  - Implemented session-level (`current_session`) and project-level (`current_project`) dynamic approval grant caches in `SessionManager`, resolving the issue where previously granted actions re-intercepted within the same session.
  - Upgraded the Composer Approval Dock to offer fine-grained choices: Allow Once, Remember for Session, and Remember for Project. It is the single actionable approval surface; tool cards only project the pending status.

- **Web Studio Multi-Layer Frontend Quality Assurance & Error Boundary**:
  - Configured ESLint 9 with `react/jsx-no-undef: 'error'` and `no-undef: 'error'` in `frontend/eslint.config.js`, statically intercepting undeclared identifiers and unimported JSX components in sub-second builds.
  - Added React `ErrorBoundary` with compact retry fallbacks around `ToolCard` in `MessageItem.jsx` and top-level views (`ChatArea`, `SidePanel`) in `App.jsx`, preventing component render failures from crashing the application into a blank screen.
  - Integrated `vitest` + `@testing-library/react` + `happy-dom` into `npm test`, covering `ToolCard` state projections (completed, running, failed, security approval actions) and `ErrorBoundary` resilience.
  - Isolated test session state cleanup in `tests/conftest.py`, avoiding stale session lock collisions across test runs in synthetic Windows profiles.

- **Experimental TUI boundary**: reduced the terminal client to a focused Python
  SDK/App Server verification surface. Access and approval changes now call the
  App Server, Plan/Goal controls use the selected Thread, and local shell, Git,
  file-search, workflow, and clipboard bypass commands are no longer exposed.
- **Actionable runtime-stop output**: the TUI renders runtime protection as an
  actionable result instead of the opaque `Turn Settled (Status: step_limit)`
  telemetry line.

- **Project execution control plane**: aligned SDK, Gateway, Studio, and TUI on
  independent Project access (`project` / `full_machine`) and approval lifetime
  (`per_action` / `current_session` / `current_project`). `full_machine` is
  machine-wide path access, not global allow-all; Auto Copilot is an explicit
  run preset, not a hidden access/policy composition.
- **Canonical Project workspace binding**: passes the active primary directory,
  editable associated roots, and reference-only roots into the App Server runtime;
  Web state no longer persists duplicate thread checkpoints or approval grants.

- **Builtin Tools Selector & Control Plane**: exposed bounded Builtin selection
  with a small default set (`read_file`, `apply_patch`, `shell`, `read_image`) and
  explicit `web_fetch` extension in Web Studio SidePanel and Thread settings,
  enabling dynamic per-thread tool capability restriction aligned with App Server
  0.7.0. The removed `write_file` and `edit_file` paths are not exposed.
- **Workflow state fidelity**: preserve the App Server's active `builtinTools`
  projection and explicit empty selection through SDK settings results and the
  Gateway's read-only aggregate instead of issuing a legacy state RPC.
- **Full ThreadItem Lifecycle Stream Reducer**: extended `messageState.js` with
  `contextCompaction` settlement badges and `reasoning` synchronization,
  rendering structured compaction indicators in Web Studio while preserving
  deterministic `toolCall` merging.
- **Canonical Thread resource routing**: moved Gateway Settings and Goal writes
  to `/api/threads/{thread_id}/settings` and `/api/threads/{thread_id}/goal`,
  matching the App Server's Thread-owned control plane.
- **Canonical ThreadItem consumption**: synchronized SDK, Gateway, Studio, and
  TUI with `item/started`, `item/completed`, and cursor-bounded
  `thread/items/list`; workflow state remains a read-only aggregate projection.
- **Documentation & Agent Notes Reorganization**:
  - Reclassified architectural decision records (ADRs), proposals, and deep dives into the structured `.agents/notes/` tree (`implemented/` and `proposed/`), indexed by `.agents/notes/README.md`.
  - Streamlined `docs/` to retain strictly essential operational project documentation: `limits.md`, `privacy.md`, `releasing.md`, and `troubleshooting.md`; moved the Python SDK guide to `sdk/python/python-sdk-guide.md` alongside its package.

### Changed

- **Sidebar runtime semantics:** distinguish an active unsettled Turn from an
  online SessionStore process; Web Studio shows “运行中” only for the former
  and labels an idle locked process as “待命”.

- **Project-qualified requests and session epochs:** every Studio REST and
  WebSocket action carries its `project_id`; session history, workflow/runtime
  reloads, SidePanel artifact reads, and @-file suggestions cancel stale work
  when the selected Session or Project changes.

- **Atomic Session reload:** switching Session clears the chat, Plan, Goal,
  Runtime, approval, and pending-turn projections before reattaching and
  reloading the selected project-qualified state.

### Fixed

- **History Turn ownership:** hydrate checkpoint messages by matching durable
  ThreadItems and tool call IDs to their explicit `turnId`, avoiding positional
  assistant-bubble mapping when a turn has multiple response segments.
- **Realtime Compaction identity:** preserve one independent item identity
  across Compaction start/finish events so adjacent live items can be grouped
  without collisions.

- **Compaction history presentation:** preserve the compaction `turn_id` through
  the Gateway projection and fold adjacent compactions into an expandable
  “上下文压缩 ×N” card with per-item Turn and ID details.

- **Project-scoped Thread attach**: when `/api/threads/{thread_id}/attach` receives
  an explicit Project ID or name, canonical Session lookup and resumed client
  binding now use that Project instead of falling back to an arbitrary matching
  Thread from another Project. A same-ID live binding conflict on attach or start
  returns `409` instead of silently reusing the wrong workspace.

- **Monotonic control-plane revision projection**: exposed App Server
  `stateRevision` through the Python SDK and Gateway workflow/settings responses;
  SDK notification caches and Web Studio settings projections now reject stale
  revisions per Thread while accepting repeated revisions. This keeps the
  canonical App Server state authoritative across the SDK → Gateway → Studio
  path without introducing a second state store.
- **Goal and recovery revision projection**: Goal set/get/clear results and
  `thread/goal/updated|cleared` notifications now carry the same App Server
  `stateRevision` used by Thread settings. Web Studio and its SidePanel apply
  Goal state monotonically, stop history reads from overwriting control-plane
  state, and rebuild the per-Thread cursor from a canonical workflow read after
  a WebSocket reconnect.
- **Runtime generation recovery signal**: Gateway restarts now broadcast a bounded
  `gateway/runtime/restarted` generation notification; Web Studio invalidates its
  per-Thread revision cursor and reloads canonical workflow state even when the
  browser WebSocket remains connected.

- **Project-safe Thread fork**: fork requests may identify the source Project,
  and the Gateway now carries the source binding onto the branched Thread;
  conflicting live IDs fail with `409` instead of silently moving a fork into
  the current Project workspace.

- **Serialized Thread client attach**: concurrent Gateway attach/start requests
  for the same Thread now share one creation critical section, preventing two
  App Server clients from racing to claim the same canonical Session lock; fork
  and concurrent attach now share that critical section so a child cannot be
  observed before its canonical binding is installed.

- **Canonical Thread continuation projection**: moved `manual` / `continuous`
  persistence to the App Server SessionStore `thread_settings.json` sidecar;
  SessionCatalog reads the bounded projection and Gateway no longer stores a
  duplicate continuation cache or writes Thread settings metadata.

- **Bounded automatic shell inspection**: automatic policy now admits only
  explicitly read-only shell commands whose referenced paths remain inside the
  active workspace or configured read roots; writes, dynamic paths, high-risk
  commands, and outside paths still require explicit approval.

- **Decoupled State Persistence Architecture**:
  - Replaced the single monolithic `state.json` with fine-grained decoupled files: `settings.json` for global preferences, `projects.json` for project workspace registries, and `projects/<project_id>/threads.json` for per-project thread metadata.
  - Introduced atomic writes via temporary files and `os.replace` to prevent corrupted writes or race conditions under concurrency.
  - Removed legacy `state.json` migration and backward-compatibility shims to keep persistence logic clean, lean, and directly bound to the decoupled files.
- **Default Reasoning Effort Alignment**: Set the system-wide default `reasoning_effort` to `high` across `SessionManager` runtime defaults, WebSocket turn stream fallback routing, and Web Studio frontend initial state / settings reset, ensuring deep reasoning depth by default for complex coding agent workflows.

### Fixed

- **Reasoning lifecycle display**: settle the preceding reasoning card when a
  dedicated tool or context-compaction item starts, so sequential model steps
  in one Turn do not appear to be running simultaneously.

- **Restored conversation replay:** preserve persisted assistant reasoning and
  intermediate model responses, and associate restored tool cards with the
  assistant response that requested each call.

- **Plan/Shell workflow controls:** keep source-file mutations read-only in Plan
  Mode while routing Shell commands through the selected approval policy; the
  slash selection fills `/plan` into the composer before execution, restored
  sessions expose their Session-owned `plan/plan.md` artifact, and the menu now
  only exposes `/plan`, `/goal`, and `/clear`; `/clear` explicitly clears the
  current view without deleting Session history.

- **Shell history projection:** render canonical SessionStore tool settlement
  output and status fields, and consume the bounded persisted command projection
  so completed Shell cards no longer appear empty after a session switch.

- **Goal-owned continuation restoration**: defer the canonical SessionStore
  `continuous` preference while an active Goal owns the loop, restore it after
  Goal settlement, and avoid overwriting it when an unrelated Thread setting
  changes.

- **Authoritative turn outcome and failure diagnostics**: SDK streaming now
  waits for the durable `turn_finished` after `run_failed`; Web Studio
  distinguishes run diagnostics from terminal settlement and displays bounded
  provider/context errors instead of a generic incomplete message. Interrupt
  and steering requests now carry and log their UI source.
- **Duplicate Web Studio Approval Controls**: Removed the second actionable approval strip from `ToolCard`; each pending approval now has one canonical action area in the fixed Composer Approval Dock.
- **Approval/Steering Terminal State**: Kept approval responses readable while steering is pending, flushed queued App Server responses when stdin closes during initialization, and marked gateway stream failures as terminal so Web Studio cannot remain stuck in `运行中` after a failed turn.
- **Goal Composer and Runtime Boundaries**: Selecting `/goal` now prepares the
  composer for the objective instead of executing an empty command; autonomous
  Goal prompts render as a concise, deduplicated Goal message in Studio. Goal
  pause is now a status-only mutation admitted during an active turn, and
  Session-owned `goal/plan.md` guidance explicitly requires `Update File` while
  keeping `prompt_context.json` and absolute Session paths internal.

- **Project Duplication & Thread Affinity Preservation on Restart**:
  - Prevented redundant project creation in `SessionManager._load_state()` when the active workspace path is already bound to a registered project with a distinct custom ID or display name.
  - Preserved explicit user project assignments in `/api/threads` enriched items so that catalog session projections do not overwrite `meta.project`.
  - Injected `MINI_AGENT_WEB_STATE_DIR` into pytest harness fixtures in `tests/conftest.py` to prevent test runs from polluting user-level state files.
- **Web Studio Project Management & Hover Floating Interactions**:
  - Imported missing `FolderPlus` and `SquarePen` icons in `Sidebar.jsx`, preventing React runtime crashes on project creation, folder management, and details popover rendering.
  - Fixed project creation path passthrough to bind the primary directory path selected by the user instead of defaulting to null.
  - Re-anchored project details popover directly below the folder item, eliminating sidebar overflow clipping and mouseleave dismissal.
  - Fixed "scroll to bottom" button in `ChatArea` where flex stretch and negative translation caused it to appear as an oversized green horizontal bar when scrolling up.
  - Fixed tool card naming in `ToolCard.jsx` and `messageState.js` to correctly extract concrete tool names (e.g. `read_file`, `apply_patch`, `shell`) instead of falling back to generic "tool" with low-contrast text.
  - Added click propagation guards on project action buttons, click-outside auto-dismiss for the header summary popover, and blur auto-save on thread title rename.
  - Introduced universal CSS floating tooltips (`[data-tooltip]`) with instant hover and multi-theme support.
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
- **TUI model failure diagnostics**: after `run_failed`, reads the settled
  `turn/read.error` projection and displays bounded Provider/model details instead
  of exposing only the generic `model` classification.

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
  - Drafted ADR proposal for Mini Agent Native Desktop Application (`.agents/notes/proposed/architecture/2026-09-02-tauri-desktop-app-and-app-server-integration.md`).
- **Client Architecture & Performance Analysis Doc**:
  - Published multi-dimensional comparison analyzing Rust REPL, Python TUI, and Web Studio (`.agents/notes/implemented/architecture/2026-09-02-client-architectures-and-performance-comparison.md`).

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
- **Comprehensive Documentation & Notes**:
  - `sdk/python/python-sdk-guide.md`: Official developer guide and usage manual.
  - `.agents/notes/implemented/testing/2026-08-31-sdk-maturity-and-protocol-coverage.md`: SDK maturity radar and JSON-RPC 2.0 protocol coverage matrix.
  - `.agents/notes/implemented/bug-fix/2026-08-31-app-server-concurrency-and-deadlock-analysis.md`: Deep dive on Tokio multi-thread runtime, Actor self-deadlock, SSE keep-alive drain, and child process isolation.
  - `.agents/notes/implemented/architecture/2026-08-31-python-sdk-architecture-and-app-server-integration.md`: Architecture Decision Record aligning with OpenAI Codex client separation.

### Fixed & Hardened (Backend Engine Alignment)
- **Protocol Schema**: Fixed `turn/steer` payload formatting to match App Server's `TurnSteerParams` schema (`text` parameter).
- **Concurrency & Approval Deadlock**: Switched `mini-agent-app-server` runtime to multi-threaded Tokio (`rt-multi-thread`) so synchronous `receiver.recv()` in approval workflows does not starve the JSON-RPC event loop.
- **Transport Actor Self-Deadlock**: Replaced re-entrant `connection.thread_id().await` in `transport.rs` with synchronous snapshot reading.
- **SSE Stream Hangs**: Updated OpenAI-compatible SSE drain loop to break immediately upon receiving `response.completed`, preventing 60s+ keep-alive socket hangs with DeepSeek and third-party gateways.
- **Child Process Isolation**: Isolated child shell `stdin` with `Stdio::null()` and injected non-interactive environment variables (`GIT_TERMINAL_PROMPT=0`, `GIT_PAGER=cat`, `PAGER=cat`, `CI=1`, `TERM=dumb`) to eliminate interactive pager hangs.
