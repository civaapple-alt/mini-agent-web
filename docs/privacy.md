# Data and privacy

`mini-agent-web` is a local SDK, Gateway, and browser client. It does not add a
separate hosted service for Session history or approval grants. The App Server
process performs model requests and tool execution under its configured
runtime.

## Data flow

The Gateway starts or connects to an App Server through the Python SDK. A turn
request, bounded attachment references, and control requests cross that local
process boundary. The compatible App Server can then send model-visible context
to its configured provider and can invoke admitted local or remote tools.

The browser never becomes the authority for a Session, a tool result, or an
approval grant. It sends an approval decision only in response to an App Server
request. Host and Capabilities validate the action identity, allowed scope,
workspace revision, and policy before any reuse. `automatic` and `trusted`
policies can resolve eligible actions without a browser card. A browser card is
therefore not a complete audit of every tool action.

## Local files

Gateway Project and UI metadata are stored below `MINI_AGENT_WEB_STATE_DIR`.
When the variable is unset, the Gateway uses its local Mini Agent Web state
directory. Thread attachments are stored below that state directory, outside
the Project workspace, and are supplied to the runtime through a read-only
Session attachment root.

App Server Session history, checkpoints, runtime sidecars, and approval
evidence remain App Server-owned data. Gateway Project removal only removes the
local registry entry. It does not delete the Project directory or canonical
Session history.

The Gateway log directory is configured by `MINI_AGENT_LOG_DIR` and defaults to
`logs`. Logs and local state can contain user prompts, filenames, tool status,
or error details. Review them before sharing a support bundle.

## Credentials and remote services

Provider credentials and MCP credentials are configuration for the App Server
runtime or a configured tool. Do not put credentials in a Project file,
attachment, browser message, or repository commit. Any content made visible to
a provider, MCP server, or remote tool is governed by that service's privacy
policy.

The default CORS allowlist contains local development origins. The Gateway bind
host defaults to `0.0.0.0`, so do not treat that CORS allowlist as a network
access-control boundary. If you expose the port beyond a trusted local network,
configure the bind host, reverse proxy, and access controls for that deployment.

## Cleanup

Stop the Gateway and any App Server that owns the Session before removing local
state. Removing Gateway state resets local Project and UI metadata. Removing
an App Server Session directory is an administrative action that removes its
history, checkpoints, attachments, Goal state, and other Session-owned data.
The Gateway has no API for deleting canonical Session history.
