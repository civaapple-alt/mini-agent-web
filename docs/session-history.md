# Session history in Web Studio

Web Studio loads conversation history through the App Server's existing
`thread/items/list` cursor. It requests the newest 128 items when opening a
Session and fetches older pages when the user scrolls toward the top. Loaded
Studio merges pages by item identity. It keeps earlier pages on reconnect when
the refreshed page overlaps the latest page already in memory. If the pages no
longer overlap, Studio restarts from the newest page because the bounded
response cannot determine a safe cursor shift.

Opening a Session starts from its canonical history and runtime snapshots. If
the event replay window has already evicted older events before this page had a
cursor, Studio reconciles from the snapshot without presenting that as a
connection gap. After an established stream reconnects, a gap beyond its known
cursor is reported and reconciled from the latest canonical snapshot. A
reconnected socket alone does not restore controls: Studio keeps them blocked
until history, runtime status, pending approvals, and retained events have been
reconciled.

Recovered checkpoint messages use the same `historyOrder` positions as their
canonical ThreadItems. This preserves each input's position relative to its
Turn's reasoning and tool activity, even when the newest page uses negative
offsets. When a Turn is waiting to continue, Studio keeps its persisted stop
reason and completed step count beside the continuation action.

If a checkpoint contains a Turn's assistant/tool transcript but its ThreadItem
page contains only the input item, Studio restores the saved assistant messages
and joins tool results by call ID. Complete ThreadItem activity remains the
preferred projection, so the fallback does not duplicate recorded execution
items.

If a recovered tool call has no ThreadItem in the timeline, its reconciliation
form stays in the checkpoint card. "查看待核对活动" scrolls to and focuses that
form by call ID, then reads the selected call's bounded, redacted arguments so
the user can inspect its command before recording an outcome. The request does
not load arguments for other uncertain calls.

After an App Server restart during an unsettled Turn, Studio reads the bounded
activity projection from `turn/read` and merges it into the visible timeline.
The App Server rebuilds at most 256 items from the latest execution checkpoint
and pending tool batch: the current Turn's input, reasoning, messages, completed
tool results, and unresolved calls. This is a display projection of the
execution journal; it does not change the canonical ThreadItem page or its
cursor. Settled Turns continue to come from `thread/items/list`. The event
replay file remains metadata-only and cannot restore message bodies on its own.

While the page is open, Web Studio keeps a bounded recent event window per
Thread. Opening a child Session viewer mid-Turn can therefore show stream
activity the page already received before the viewer subscribed. Sequence
identity deduplicates buffered events against the live child event subscription.
This in-memory window does not survive a page reload; after reload, persisted
ThreadItems and the execution checkpoint remain the sources for message bodies.
`turn/events` supplies metadata for cursor recovery and cannot restore streamed
reasoning or text by itself.

Steer messages use the same Turn and assistant activity segments. The Gateway
passes the browser's stable `clientRequestId` through the SDK to
`turn/steer.requestId`. After restart, `turn/read` restores the bounded steer
request records and their `accepted`, `applied`, or `unapplied` status. An
accepted steer is restored as a separate user message until a persisted input
item proves it was applied; applied messages are matched by Turn and text so
they do not appear twice. The original reasoning and tool activity remain in
their existing item and segment positions.

`accepted` means the App Server durably recorded the request. It does not mean
the model has seen it. The UI reports “已受理，等待安全边界” until a later
checkpoint proves the steer entered model context. If stop wins first, the
status changes to “Turn 已停止，纠偏未应用”. A lost acknowledgement is
resolved by reading the same Turn; retry only with the same request ID and
payload.

Stopping has separate admission and settlement states. An accepted
`turn/interrupt` leaves the UI in “停止中” until a terminal Turn event or an
authoritative runtime/Turn read confirms settlement. If the service disconnects
or remains unreadable past the bounded wait, Studio says “结果未确认” and
offers a status refresh. A refresh that still finds an active or stopping Turn
does not clear the stop state or resend any operation.

The Core drops its pending local model future when cancellation reaches the run
loop; this does not guarantee that a remote provider stops computing. During a
cancelled tool batch, calls that never started receive a `cancelled` result for
their `callId`, while started calls keep their real result or uncertain-side-
effect reconciliation state. Recovery reads the persisted Session and Turn
checkpoint; event replay supplements lifecycle clues and never starts the Turn
again automatically.

Clicking a user message image opens a viewport-level preview above the virtualized
conversation. The image scales to the available screen width and height. Click
the image, backdrop, or minimize control, or press Escape to return to the
conversation.

The conversation timeline measures variable-height rows and mounts only the
visible range plus a small overscan window. The Turn navigation rail is
virtualized separately. Loading an older page preserves the first visible
message's screen position; selecting an unloaded Turn scrolls to and mounts its
message before focusing it.

Large tool output remains in Session sidecars and is read through the existing
bounded output handle. History pagination does not send the full stored output
through the WebSocket.
