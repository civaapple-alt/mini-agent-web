# Session history in Web Studio

Web Studio loads conversation history through the App Server's existing
`thread/items/list` cursor. It requests the newest 128 items when opening a
Session and fetches older pages when the user scrolls toward the top. Loaded
Studio merges pages by item identity. It keeps earlier pages on reconnect when
the refreshed page overlaps the latest page already in memory. If the pages no
longer overlap, Studio restarts from the newest page because the bounded
response cannot determine a safe cursor shift.

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
