# Session history in Web Studio

Web Studio loads conversation history through the App Server's existing
`thread/items/list` cursor. It requests the newest 128 items when opening a
Session and fetches older pages when the user scrolls toward the top. Loaded
Studio merges pages by item identity. It keeps earlier pages on reconnect when
the refreshed page overlaps the latest page already in memory. If the pages no
longer overlap, Studio restarts from the newest page because the bounded
response cannot determine a safe cursor shift.

The conversation timeline measures variable-height rows and mounts only the
visible range plus a small overscan window. The Turn navigation rail is
virtualized separately. Loading an older page preserves the first visible
message's screen position; selecting an unloaded Turn scrolls to and mounts its
message before focusing it.

Large tool output remains in Session sidecars and is read through the existing
bounded output handle. History pagination does not send the full stored output
through the WebSocket.
