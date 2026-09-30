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

The collapsed composer control shows model-window occupancy and the overall
cache-hit ratio for the most recent `model_responded` event. Expanding it shows
the Provider-reported input and cached-input token counts. A zero cached-input
count is shown as zero; missing usage or a zero input count leaves the ratio
unknown. The model context window comes from the configured model catalog and
is shown as unknown when unset.

The expanded usage view shows a segmented context-source bar and a percentage
for each category. Studio apportions the Provider-reported input-token total
by each category's serialized byte share and labels the token count as an
estimate. It does not assign cached tokens to individual sources. The overall
cache-hit ratio is `cached_input_tokens / input_tokens` from the Provider's
most recent report; it is not a conversation-wide historical average.

Provider cache behavior depends on its cache boundary and tokenization. The
append-only Session context sequence preserves earlier request prefixes when a
new source is added, but Web Studio does not promise a cache hit. The displayed
cached-token total and hit ratio use the Provider's actual report for the most
recent model request.
