# Session context in Web Studio

Web Studio projects bounded context metadata owned by the App Server. It does
not show injected file bodies in the context panel or copy internal Context and
system-prompt messages into browser history.

## Source records

The context panel in the workspace side panel lists the current injected source
inventory: source kind and name, workspace label, relative path, scope, byte
size, and the fingerprint a newer version supersedes. Older Sessions without
source metadata show “来源未知”.

The conversation stream places a **Host 注入** card at each persisted injection
boundary. The card shows the same metadata only. A normal `read_file` result
remains a tool card with its ordinary tool lifecycle and output. The Gateway
projects the current source inventory from the latest Session checkpoint so it
remains available after older turn presentations leave the bounded history.

## Request usage

The collapsed composer control shows model-window occupancy and the session's
cumulative cache-hit ratio when Provider cache reports are available. Expanding
it also shows the most recent `model_responded` input and cached-input token
counts. The session ratio is token-weighted across Provider usage reports in
persisted Turn presentations that include a cached-input count:
`sum(cached_input_tokens) / sum(input_tokens for reports with cached counts)`.
The report count and usage-report count show how much of the available Provider
usage included a cache count. Reports that omit cache usage are excluded from
the ratio denominator; a reported cache count of zero contributes zero. The
ratio is unknown when no cache-bearing report has input tokens. Old Turns
without per-request totals are counted as untracked rather than treating their
latest report as a historical average.

The detail popover closes on an outside click or Escape. Its expanded state is
reset when the selected project or Thread changes.

The most recent request's zero cached-input count is shown as zero; missing
usage or a zero input count leaves its own ratio unknown. The model context
window comes from the configured model catalog and is shown as unknown when
unset.

Settled assistant replies also show the most recent model request's time to
first non-empty output (TTFT) and total response time when the App Server
reports them. Older Turns and requests without timing data show `—`; the SDK
keeps the timing fields optional for compatibility.

The expanded usage view shows a segmented context-source bar and a percentage
for each category. Studio apportions the Provider-reported input-token total
by each category's serialized byte share and labels the token count as an
estimate. It does not assign cached tokens to individual sources. The session
cache-hit ratio is based on Provider reports, not an estimate derived from
source byte shares.

Provider cache behavior depends on its cache boundary and tokenization. The
append-only Session context sequence preserves earlier request prefixes when a
new source is added, but Web Studio does not promise a cache hit. The displayed
cached-token counts and session ratio use the Provider's actual reports.
