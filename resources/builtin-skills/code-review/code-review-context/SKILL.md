---
name: code-review-context
description: Check model-context changes for stable prefixes, bounded inputs, and safe updates.
---

# Review model-context changes

Read the target repository's AGENTS.md and its current context, prompt, and provider documentation. Trace how the changed context reaches the model request.

Use the target repository's documented context and caching policy as the
authority. Check that:

1. History updates follow the repository's intended policy. When dynamic
   context is append-only, existing conversation history is not rewritten or
   reordered; intentional replacement has clear scope and invalidation rules.
2. Runtime context changes do not cause unnecessary system-prompt or tool
   definition churn; account for intentional changes and their effect on the
   request prefix.
3. Dynamic additions follow the documented ordering and deduplication policy,
   with explicit scope and replacement behavior.
4. Every model-visible item and the combined context have enforced size bounds. Use the repository's authoritative token or byte accounting.
5. Large new items receive the extra review required by repository policy. If
   no policy exists, flag a single injected item over 1,000 tokens for manual
   review and any item over 10,000 tokens as a high-priority risk.
6. Compaction removes superseded records while retaining instructions that remain in force.
7. Where cache reuse is a design goal, cache-sensitive request prefixes remain
   stable; provider-reported cache usage is evidence, not a guaranteed hit rate.

Inspect request construction and tests, not just comments or type names. Report the affected message sequence, bound, cache-sensitive prefix, or compaction case with repository-relative paths and line numbers.

Do not assume a particular language, crate, framework, or context abstraction. Do not contact remote services or change files.
