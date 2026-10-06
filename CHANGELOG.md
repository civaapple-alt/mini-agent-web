# Changelog

All notable changes to the `mini-agent-web` workspace will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changes

- Add a prioritized pending-action summary to StatusRail and jump to the exact
  question, approval, or uncertain tool call in the virtualized timeline. Keep
  approval and reconciliation controls beside their activities, retain
  fallbacks for unmatched items, and disable submissions while state is
  reconnecting, read-only, or stopping.
- Keep tool activity pending until the runtime reports its result after a stop
  request, preserve Session-log duration over local timer estimates after
  replay, and label the initial WebSocket handshake as connecting.
- Simplify the context usage popover, fold source estimates by default, keep
  recent-request and session cache-hit rates separately labeled, and show hit
  rates to two decimal places.
- Preserve assistant segment boundaries and intermediate narration after history replay; fold
  thinking and tool activity within each segment instead of merging an entire Turn.
- Restore processed time from the Session journal's Turn start/settled timestamps, and omit
  estimates derived from item commit timestamps.
- Open pasted text attachments in a scrollable preview, loading historical content on demand
  from the current Thread's bounded Gateway attachment store.
- Render enlarged message images in a viewport-level preview above the
  virtualized conversation, and constrain the image to the available viewport
  height and width.
- Simplify the active user-question card palette, keep recommended options
  visually neutral, and show a loading indicator only on the option currently
  being submitted instead of checkmarks on every option.
- Restore project access scope and approval policy from the persisted project
  snapshot when opening a Thread, including an empty Thread, so a page refresh
  does not make saved execution settings appear to revert.
- Set the GLM Coding Plan provider preset to its Responses Base URL, provide a
  one-click correction for the old Chat Completions URL, and match GLM 5.3
  reasoning parameters to the Responses API.
- Pair the latest provider input usage with the model context profile saved for
  that request. Show input usage against the full context window, separately
  report the budget after output reserve, and flag either limit. Keep the
  percentage visible above 100%.
- Add a separate Kimi Code provider preset for the Coding API, suggest `k3-256k`
  for that endpoint, and map Kimi reasoning levels to `reasoning.effort`.
- Show TTFT and response latency below the matching user prompt, and add space
  between the processed-duration label and the following execution block.
- Remove automatic hover popovers for tool arguments; open a tool's full
  parameters and output together through “查看详情”.
- Keep the project sidebar's medium-width icon rail compact, and restore the
  full navigation when it opens as a mobile drawer.
- Guide tool recovery by asking for the verified execution state first, showing
  only the matching fields, and distinguish successful, failed, and confirmed
  not-executed calls. Keep audit evidence separate from the tool output sent to
  the Agent, and clear the output when the selected outcome changes. Read the
  latest Turn recovery state after reconciliation and terminal events, and
  report a saved decision separately from a failed status refresh.
- Keep the Gateway, Web Studio, and experimental TUI in this repository while
  consuming the Harness-owned Python SDK package. SDK source, tests, docs, and
  generic App Server examples now live in `mini-agent-harness`.

## [1.0.0] - 2026-10-04

### Breaking Changes

- App Server protocol and Session journal V2 reject V1 clients during
  negotiation and reject V1 Session files without automatic migration. Back up
  `~/.mini-agent/sessions/` with the previous release before upgrading;
  see the Harness [App Server migration guide](https://github.com/civaapple-alt/mini-agent-harness/blob/main/docs/app-server.md).

### Changes

- Preserve the stop reason and completed step count for resumable Turns, and
  preserve the canonical order of recovered inputs and Turn activity.
- Restore assistant reasoning, tool calls, and saved tool results from a
  checkpoint when its ThreadItem history contains only the input item.
- Make full-size message image previews easy to dismiss with a minimize control,
  image or backdrop click, or Escape.
- Keep large saved model responses available to bounded Gateway history previews,
  raise the Session catalog file cap to 256 MiB, and allow bounded 128 MiB
  model-response events through the SDK's 129 MiB stdio line limit.
- Keep conversation history available when Context Manifest reads fail and
  display the source-metadata error separately; read manifests during active Turns.
- Make turn context injection cards easier to scan by naming the current Turn,
  showing each source's purpose first, and collapsing technical metadata.
- Simplify Web Search settings by removing repeated key guidance and placing an
  independent test action in each provider card. Use one shared query and the
  selected provider's saved Host key without changing the default provider.
- Keep the Runtime Settings panel open after changing the execution scope,
  approval policy, or continuation mode so users can adjust multiple settings
  without reopening the panel.
- Add manual recovery controls in Studio for tool calls whose side effects are
  uncertain. Require a bounded operator result or confirmation that the call
  did not run, and keep recovery tied to the original Turn and checkpoint.

- Project optional `model_timing` values from `model_responded` through the
  Python SDK and Gateway, persist the latest timing in Turn presentations, and
  show TTFT and response latency on settled assistant replies. Older Sessions
  remain readable; Studio omits timing metadata when it is absent.
- Load Web Studio conversation history from the newest cursor page, fetch older
  items on upward scroll, and virtualize variable-height conversation and Turn
  navigation rows while preserving scroll anchors and targeted Turn navigation.
- Add capability-negotiated `ask_user` interactions to Web Studio. Present one
  question at a time with recommended options, free-text answers, and skip;
  persist answers through App Server and restore pending questions after a
  refresh or execution recovery. Keep completed question cards collapsed by
  default. Surface a background child Session's pending question in its parent
  Session list and task panel, and open the child Session for its answer. Show
  `ask_user` in Workspace's Builtin Tools list and let each Thread control its
  model-visible availability.
- Add a top-right quick-open menu for the current Project workspace. Route
  launches through the local Gateway using registered Project paths and fixed
  Finder, Windows File Explorer, VS Code, IntelliJ IDEA, and terminal targets on macOS,
  Windows, and Linux.
- Package an opt-in `code-review` Skill group with a local-only coordinator
  and four focused checks for compatibility, change size, model context, and
  test coverage.
- Make composer Stop interrupt only the active Turn so users can send a new
  instruction after it settles; keep whole-Session freeze as an explicit
  child-task control.
- Add machine-wide Web Search settings for DeepSeek native search, Exa, Kimi
  Basic, or disabled. Keep credentials write-only and stored by Host; forward
  settings through JSON-RPC, the Python SDK, and Gateway without echoing keys.
- Align saved Web Search API Key status, placeholder, and helper text with model
  provider settings while keeping the credentials independent. Add a bounded
  test search that returns up to three results from the saved configuration.
- Show the Host-reported initial `web_fetch` selection in Workspace tools when
  a configured search provider enables page reading for a new Thread.
- Show search-result and fetched-page links in collapsed conversation activity.
  Deduplicate cached page continuations and hide opaque handles and cursors in
  tool details.
- Open links in session Markdown replies and workspace Markdown previews in a
  separate browser tab while preserving the current Web Studio session.
- Show persisted Host context injections as metadata-only transcript cards and
  a visual source-share breakdown in the workspace panel. Show model-window
  occupancy and the session-wide, Provider-reported weighted cache-hit ratio on
  the collapsed composer control; keep latest-request token counts available in
  its details, close that popover on outside click or Escape, reset it on Session
  changes, and label source splits as estimates.
- Refresh the effective Skill catalog from the App Server after each settled
  Turn and when loading the Skill panel, so newly installed Skills can be
  selected without restarting the Project runtime. Keep selected Skill bodies
  in a bounded context slot and leave the stable system prompt unchanged.
- Route project-scoped Skill queries through the requested Thread's App Server
  client so the Skills panel can load for non-default Threads.
- Make `read_thread()` checkpoints directly resumable and let an omitted
  `start_thread()` ID attach to the App Server's active Session Thread.
- Keep whole-Session resume work alive when the browser disconnects, recover a
  persisted `resuming` state when the child-task panel reloads, and expose an
  explicit retry action after a failed attempt.
- Send per-turn reasoning effort in the App Server input, reject unsupported
  `turn/start` modes in the SDK, and propagate terminal `turn/read` errors.
- Preserve client/provider and world execution settings across process restarts,
  resume durable App Server Sessions, and select the restored Session Thread in TUI.
- Match App Server `.env` search paths, keep stream queues bounded with an
  explicit replay signal on overflow, and retain Thread origin metadata.
- Implement `search_notebook()` as bounded local filtering over `read_notebook()`
  instead of calling an unimplemented protocol method.
- Reconcile live assistant text and reasoning from completed App Server items,
  and present repeated model calls in one Turn as a single expandable execution
  overview while keeping the final answer visible.
- Keep the initial missing-model status available to assistive technology without
  adding a second row to the composer controls.
- Only close the model editor on a backdrop click that starts and ends outside
  the dialog, so dragging to select text does not ask to discard the model.
- Move provider, credential, and default-model setup to the Web Studio model
  settings page, with project defaults in Project settings and a first-run
  “先配置模型” entry beside the composer. Put bounded connection tests beside
  each saved model. Remove obsolete host,
  port, and default-mode keys from persisted Web settings, and stop reading
  legacy provider variables.
- Parse Turn and Thread execution-recovery metadata into the public
  `ExecutionRecoveryInfo` type. Preserve unknown fields and statuses, and expose
  an advisory action without resuming a Turn or retrying a tool.
- Verify App Server restart, Gateway reattachment, WebSocket disconnect, event
  gaps, and unknown events with deterministic tests that do not call a model
  provider.
- Clarify parent/child handoffs: delegate with a natural-language goal and
  expected result, report only meaningful progress or blockers, and review a
  child's current result before deciding whether to follow up in the same
  Session or summarize it.
- Show a bounded final-result preview in completed child task rows and point the
  existing child Session action to the full result.
- Mark Sessions that need attention with a small notification icon in the
  existing sidebar list. Selecting the row still opens the same Session view.
- Keep Context-only checkpoint refreshes from making older Sessions appear
  recently active in the Studio sidebar.
- Add a project-menu Session Doctor. It inspects Session logs through the App
  Server maintenance command and offers a confirmed, backed-up repair for an
  incomplete final record.

- Clarify runtime checkpoint diagnostics: distinguish the last settled Session
  checkpoint from the active Turn's execution recovery checkpoint, phase,
  recent progress, and executor heartbeat. Keep the latest workflow event tied
  to its Turn and timestamp. Allow `turn/read` to inspect the active Turn while
  execution is running.
- Persist bounded execution checkpoints and tool-call outcomes for Main and
  Child Turns. Resume the same logical Turn only after an explicit user action;
  show unknown tool outcomes as requiring reconciliation.
- Keep the current conversation visible while runtime recovery reloads its
  canonical history. A failed snapshot request no longer clears messages already
  displayed in the selected Session.
- Show a live elapsed duration on running child task rows and show the processed
  duration at the start of each main conversation Turn. Freeze both displays
  when their execution settles; estimate historical Turn duration from durable
  activity timestamps when runtime duration is unavailable. Show a sub-second
  Turn as `不足1秒` instead of rounding its label down to `0秒`. Freeze the
  main Turn's measured duration from its live lifecycle so coarse persisted
  timestamps cannot reset it after completion.
- Improve child Session detail readability: show each thinking/tool activity in
  execution order with the same active/final segment visibility and settled
  activity summaries as the main conversation. Bound long task prompts to a
  scrollable bubble, and keep a result-only final reply at the end of the
  transcript instead of duplicating it in the status card.
- Bound WebSocket notification delivery so a slow browser cannot stall the
  App Server stdout reader. Disconnect slow consumers and let them recover from
  the bounded event replay path. Treat an individual `turn/read` RPC timeout as
  a transient observation failure; keep waiting for the same child Turn instead
  of clearing its active registration or prematurely draining the child queue.
- Stream child Session runtime events directly into the read-only detail view.
  Subscribe by project and child Thread identity, replay the bounded event cache
  on open and refresh, deduplicate by sequence, and continue using settled
  ThreadItems for refresh and recovery. Keep inherited parent checkpoint content
  out of the child transcript and show when the replay cache has a gap. Clear the
  gap notice after ThreadItems contain assistant activity for the settled Turn.
- Make main-thread Stop freeze the parent Session and all active child work.
  Persist freeze/resume state in App Server, preserve queued children, block
  automatic wakeups while frozen, and resume parent-frozen children only after
  explicit Continue. Track whether child reports are pending main-thread read
  or have been received, and retain the source of individual child controls.
- Simplify the Child Agents panel into compact status rows with a color-coded
  count summary, visible phase/progress, and elapsed time. Keep stop as the only
  quick action with confirmation; reveal lifecycle details and other controls
  on demand.
- Scope delegated child Thread identities to their creating parent Session using
  a canonical capability-generated ID; repeated display titles and parent-local
  keys no longer collide across Sessions. Persist bounded call arguments before
  pairing them with successful tool results, keep maximum prompts out of tool
  output, and reject an existing Thread owned by a different parent.
- On event replay gaps, recover from canonical history and the latest runtime
  status without replaying an incomplete retained suffix. Settled snapshots now
  settle stale thinking/text blocks, and elapsed-time counters stop at the
  streaming-to-settled transition.
- Keep queued child attempts queued when a previous attempt's runtime snapshot is
  still terminal. Recovery reattaches or interrupts only a matching active Turn;
  stale active projections are marked for attention and no longer reserve a
  concurrency slot or expose controls that cannot reach that Turn.
- Reconcile child task reads with settled Turns when a terminal operation snapshot
  is missing. Recover the bounded final assistant result in `task_read`, and make
  clear that an empty `reports` list means no explicit progress report was sent.
- Keep child-task steering within its active Turn and run delegated Turns with
  the continuous main-thread loop profile. Expose the exact attempt Turn outcome
  separately from the latest child Session Turn, and retain step-limit and
  runtime errors on the operation.
- Let a persisted settled Turn override stale `pausing` / `cancelling` child state
  after restart, and keep expected stale-PID probes out of Gateway warning logs.
- Keep the completed-task expansion and loaded page count when opening a child
  detail and returning to the list. Include ended tasks in the panel count summary.
- Clarify that resending a failed Turn starts a new provider request, not a
  continuation of the disconnected stream. Preserve its file attachments and
  workflow selection in the resend action.
- Persist the full child operation intent before both immediate and queued starts.
  Cancel a queued operation when App Server rejects its start, retain the reason,
  and notify the parent instead of leaving the task queued without an explanation.
  Drain the queue after `task_control.update_queued` changes a task prompt.
- Open Web Studio at `/` as a blank session-creation page instead of restoring
  the last browser-selected Thread. Use pathname links in the form
  `/threads/{thread_id}?project_id={project_id}`; project scope distinguishes
  identical Thread IDs across projects. Legacy `?thread=` links are normalized
  to the pathname route; Session IDs are not route identifiers.
- Reorganize preferences and model settings into a grouped settings sidebar with a dedicated details pane, including a compact horizontal navigation layout on narrow screens.
- Add local Responses provider and model management, separate global primary
  and Goal Verifier defaults, project defaults, and per-Thread model and
  reasoning selection in the composer.
- Clear stale turn results when an execution segment starts and show incomplete-turn banners only after the active Turn settles. Tone down steer messages with neutral bubble colors and a muted label.
- Keep the current execution segment expanded while it runs; fold earlier settled activity, including failed tool calls, when a later segment starts. Add failure counts and tool types to activity summaries while keeping approvals, delegation, and the final reply separate.
- Identify the live assistant execution segment by the active Turn identity instead of message-list position or the current sampling flag. Keep it expanded between model samples and after its tools settle; show the final answer controls only after the Turn settles.
- Keep Session Turn hover details visible outside the rail's scroll clipping area, and remove the unintended glow around the current marker.
- Hide the Session Turn rail when the chat pane is too narrow to keep it clear of the message stream.
- Restore restarted Sessions from ordered items so assistant execution segments keep separate summaries and steer inputs keep separate message bubbles. Recover a missing input item from the persisted `turn_started.prompt`, and keep one Turn rail node when a Turn has multiple inputs.
- Restore earlier assistant replies from durable ThreadItems when checkpoint compaction omits their Turns; preserve item order and avoid duplicating Turns already present in the checkpoint.
- Make the `有新活动 · 查看当前 Turn` action scroll to the last assistant message in the current Turn. Fall back to the Turn input when no assistant activity exists.
- Under the `trusted` policy, admit public `web_fetch` requests after URL
  validation without an approval prompt. Keep approval for destructive
  operations and update the execution setting description.
- Let child agents report bounded progress, let the parent steer or cancel
  queued/running work, retry failures, cancel a sequential group, and add new
  tasks. Persist reports with child operation identity and cursor; coalesce
  parent wakeups without steering an active parent Turn. Start one continuation
  after the parent becomes idle and mark it with `turnSource: "child_wakeup"`.
  Bound pending wakeups to 64 distinct child states and each continuation to 16 child
  updates, serialize user starts with automatic wakeups, and avoid duplicate
  steer confirmations for internal child updates.
  Keep the message stream, Child Agents panel, and project-session filter on
  the same child lifecycle projection.
- Keep the Plan viewer on the current Session's `plan/plan.md`; refresh its file list and
  content after a Turn settles.
- Dock the runtime details panel beside the main conversation on wide windows, remember the layout choice, and use a modal overlay on narrow windows. Drag the tab strip horizontally to reach hidden tabs, and resize the docked panel with a keyboard-accessible divider whose width is remembered. Show child-agent attention states first, group lifecycle stages by attempt, and expose phase, sequence position, recovery state, and report attempt.
- Show delegated children as a per-Turn batch in the message stream with each
  task's lifecycle, keep the Runtime child list authoritative, and add a
  top-level Child Agents drawer page with in-page list and detail navigation.
  Show only child-local persisted activity in each read-only transcript; keep
  the inherited parent checkpoint as model context and source metadata.
  Refresh active child history and page older activity.
  Preserve multiline prompts for queued children so work beyond the active
  concurrency limit stays queued and starts when a slot opens. Keep the visible
  transcript position while paging older child activity, use one scroll region
  in the drawer, and keep command previews inside the drawer boundary.
  Resolve every child fork and client binding through its parent's canonical
  Project identity, and hide delegated child Sessions from the project session
  tree while preserving ordinary forks.
- Let a parent assign review feedback to a successfully completed child Session
  as a new Turn on that same Session. Route assignments to a live child as an
  idempotent steer, persist follow-up work when concurrency is full, and show
  initial, retry, and follow-up rounds in one stable child card.
- Add parent-side paginated `task_list` and operation/attempt-bound child control
  for update, steer, stop, pause/resume, retry, and follow-up scheduling. Keep one
  pending follow-up per child operation, preserve it as blocked across failure,
  and restore pause/stop transitions after Gateway restart. Give the Web Studio
  child panel the same control service with server-confirmed feedback.
- Recover a durable follow-up after a lost `child/task` response by matching
  its operation, attempt, and `control_request_id`. Retry transient queue start
  failures with coalesced backoff and reconcile queued work after restart.
- Report uncertain steer reservations as `steer_pending` with the server reason.
  Do not automatically resend the same request ID; refresh authoritative child
  and Turn state before deciding on another control action.
- Sort each project's session list by the canonical Session activity time and
  show a relative age under each session title.
- Keep the message stream at its normal centered width when the Session Turn rail is visible.
- Parse `+ <group> task` as a workflow shorthand only at the start of a message,
  so ordinary prose such as `+ Enter` no longer blocks submission as an unknown
  plugin group.
- Restore new Sessions from their bounded Turn presentation projection instead
  of merging assistant segments. Workflow selection, skill-group activation,
  and skill-load milestones retain their original boundaries and placement
  after a Web Studio or App Server restart.
- Reduce the message-stream gap between consecutive compact activity summaries.
- Show a durable in-stream checkpoint notice when manual continuation reaches a
  Turn step limit, even when the Session Turn rail is visible. Anchor the rail
  and return-to-bottom control to the chat viewport; long histories scroll
  inside the rail, so new messages do not move either control.
- Hide synthetic context-compaction handoff summaries from the user input
  history and Session Turn rail while preserving the summary for the next model
  context and the structured compaction card.
- Load the complete current Thread input history into the Session Turn rail by
  paging the canonical SessionStore item projection instead of stopping at the
  most recent 256 items. Each response remains bounded to one 128-item page.
- Restore the visible order of projected historical messages from the durable Turn
  sequence, so an input recovered after compaction navigates to its actual
  position instead of being appended below newer Turns.
- Replace the wide Session Turn column with a narrow vertical marker rail whose
  input and Turn result appear only in a hover/focus popover. Remove repeated
  inline historical Turn summary cards so the message stream keeps one clear
  top-to-bottom reading path.
- Keep the rail beside the left navigation in a centered sticky marker column,
  with a wider active marker and no connecting vertical line. The message
  stream keeps its centered reading width instead of being pushed to the right.
- Remove duplicate navigation surfaces from the message stream and runtime
  details: user messages no longer render an input-trace card, the runtime
  drawer no longer has a separate `输入历史` tab, and the status rail no longer
  repeats the second-row `详情` action. The Session Turn rail is the single
  input-history entry point.
- Remove the repeated assistant avatar marker from the message stream; agent
  identity remains available in the surrounding session chrome and tool details.
- Fix Windows development-mode startup by forcing Uvicorn reload subprocesses
  to use a Proactor event loop, which supports the SDK child-process path.
- Add cross-Turn local background Shell task projection to the SDK, Gateway, and
  Web Studio runtime panel. Child Sessions can read the parent task list but
  cannot control it; remote waits such as GitHub Actions use the scheduled marker
  described below rather than a local Shell task.
- Add bounded scheduled delay-marker projection to the SDK, Gateway, and runtime
  panel. A ready marker records when a later, explicitly started Turn can query
  remote status; it does not wake a Thread, run Shell, or cancel remote work.

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
