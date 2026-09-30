# Web search settings and activity

Web Studio configures the Host-owned machine-wide search provider. Select
`none`, DeepSeek native search, Exa, or Kimi Basic; only one provider can be
active. This setting is separate from chat model configuration. The App Server
owns the selected provider, credentials, search execution, URL admission, and
Session result cache.

The Settings panel sends keys only when the user enters or clears one. Reads
return the selected provider and whether each key is configured. Host stores
keys locally as plaintext files with restricted Unix permissions; the SDK,
Gateway, and browser do not persist or return saved key values. Search calls
may incur provider charges.

A settings change applies when a new Thread runtime is built. An already
running Thread retains its current tool catalog. With no selected provider and
key, `web_search` is absent. When search is enabled, the Agent can pass a result
URL to `web_fetch`. The Harness owns provider adapters, URL admission, and
result bounds; this document covers the Studio and Gateway projection.

## Conversation activity

The main activity stream keeps a compact search/fetch summary visible while
tool details are collapsed. Search rows show the result count and up to three
valid HTTP(S) result links. Fetch rows deduplicate repeated reads of the same
URL, including cached continuations, and show up to four page links. Running,
waiting-for-approval, failed, and truncated-page states remain visible.

Expanded tool details continue to show the bounded result content, but hide
opaque cache handles and cursors. The handles remain in the App Server's tool
arguments/results so the Agent can continue reading the cached page. The
conversation activity does not label results by provider.

## Gateway and SDK

| Surface | Contract |
| --- | --- |
| `GET /api/web-search/settings` | Reads provider selection and configured flags; accepts optional `project_id` to select the local App Server connection. |
| `POST /api/web-search/settings` | Updates provider and optional key fields; keys are write-only. |
| `MiniAgentClient.get_web_search_settings()` | Calls `web/search/settings/read`. |
| `MiniAgentClient.update_web_search_settings()` | Calls `web/search/settings/update`, omitting credentials not supplied by the caller. |

Tests use mocked App Server responses and local fixtures. They do not call
DeepSeek, Exa, or Kimi.
