# Session context in Web Studio

Web Studio projects bounded context metadata owned by the App Server. It does
not show injected file bodies in the context panel or copy internal Context and
system-prompt messages into browser history.

## Source records

The workspace side panel reads the active Session's Context Manifest through
`GET /api/threads/{thread_id}/context-manifest`. Child Session details request
the child Thread's own manifest through the same route. Both views list bounded source
identity and name, kind, version fingerprint, applicable scope, permission
basis, injection reason, workspace/path labels, byte count, and whether the
source was reused. The manifest holds at most 512 entries and survives Session
reopen and can be read while a Turn is active. Older Sessions without source
metadata show “来源未知”. A manifest read error does not block Thread/Item
history; the side panel reports the error and uses source records already
present in the persisted Thread projection.

Manifest records contain metadata only. They never store injected source text,
credentials, prompt messages, or tool results, and the manifest is not added to
model input. Context bodies remain under the existing Session context and
prompt limits. The canonical source records are written by App Server when a
`context_injected` event is observed; Web Studio does not maintain a second
source ledger.

The conversation stream places a **本轮上下文** card at each persisted
injection boundary. It names how many sources were added, then shows each
source's purpose and workspace/path. Type, byte count, replacement, and reuse
details stay collapsed until requested. The card never shows injected text. A
normal `read_file` result remains a tool card with its ordinary tool lifecycle
and output. The Gateway reads the manifest from App Server so source history
remains available after older turn presentations leave the bounded history.

## Request usage

The collapsed composer control shows model-window occupancy and the most recent
request's cache-hit ratio. Expanding it also shows the most recent
`model_responded` input and cached-input token counts, plus the session's
cumulative cache-hit ratio when Provider cache reports are available. These
metrics keep fixed labels and are never substituted for each other. The session
ratio is token-weighted across Provider usage reports in
persisted Turn presentations that include a cached-input count:
`sum(cached_input_tokens) / sum(input_tokens for reports with cached counts)`.
The report count and usage-report count show how much of the available Provider
usage included a cache count. Reports that omit cache usage are excluded from
the ratio denominator; a reported cache count of zero contributes zero. The
ratio is unknown when no cache-bearing report has input tokens. Old Turns
without per-request totals are counted as untracked rather than treating their
latest report as a historical average.

Cache-hit rates display two decimal places. The detail popover closes on an
outside click or Escape. Its expanded state is reset when the selected project
or Thread changes.

The most recent request's zero cached-input count is shown as zero; missing
usage or a zero input count leaves its own ratio unknown. The model context
window comes from the configured model catalog and is shown as unknown when
unset.

Settled assistant replies show the most recent model request's time to
first non-empty output (TTFT) and total response time below the corresponding
user input when the App Server reports them. If Studio cannot match an input,
it keeps the timing metadata on the assistant reply. If timing data is missing,
Studio omits it; the SDK keeps the timing fields optional for compatibility.

The source breakdown is folded by default in the expanded usage view. When
opened, it shows a segmented context-source bar and a percentage for each
category. Studio apportions the Provider-reported input-token total
by each category's serialized byte share and labels the token count as an
estimate. It does not assign cached tokens to individual sources. The session
cache-hit ratio is based on Provider reports, not an estimate derived from
source byte shares.

Provider cache behavior depends on its cache boundary and tokenization. The
append-only Session context sequence preserves earlier request prefixes when a
new source is added, but Web Studio does not promise a cache hit. The displayed
cached-token counts and session ratio use the Provider's actual reports.
