import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateContextCategoryTokens,
  mergeContextInjectionRecords,
  normalizeContextUsage,
} from '../utils/contextUsage.js';

test('missing provider usage and context window stay unknown', () => {
  assert.equal(normalizeContextUsage({ contextBytes: { tools: 100 } }).inputTokens, null);
  assert.equal(normalizeContextUsage(null), null);
});

test('provider-reported zero cache remains distinct from missing usage', () => {
  const usage = normalizeContextUsage({
    usage: { input_tokens: 1200, cached_input_tokens: 0, output_tokens: 12 },
    context_bytes: { tools: 100 },
  });

  assert.equal(usage.inputTokens, 1200);
  assert.equal(usage.cachedInputTokens, 0);
});

test('provider usage with no cache field remains unknown', () => {
  const usage = normalizeContextUsage({
    usage: { input_tokens: 1200, output_tokens: 12, cached_input_tokens: null },
  });

  assert.equal(usage.inputTokens, 1200);
  assert.equal(usage.cachedInputTokens, null);
});

test('provider cache count is shown as the reported total', () => {
  const usage = normalizeContextUsage({
    usage: { inputTokens: 1200, cachedInputTokens: 850 },
    contextBytes: { systemPrompt: 100, projectInstructions: 300, tools: 100 },
  });

  assert.equal(usage.cachedInputTokens, 850);
  assert.deepEqual(
    estimateContextCategoryTokens(usage).map(({ key, tokens }) => [key, tokens]),
    [
      ['systemPrompt', 240],
      ['projectInstructions', 720],
      ['skills', 0],
      ['workspaceState', 0],
      ['conversation', 0],
      ['tools', 240],
      ['other', 0],
    ],
  );
});

test('source records update by identity without duplicating the visible source', () => {
  const first = {
    id: 'agents-main',
    fingerprint: 'old',
    source: 'AGENTS.md',
  };
  const next = {
    ...first,
    fingerprint: 'new',
    supersedes: 'old',
  };

  assert.deepEqual(
    mergeContextInjectionRecords([first], [next, next]),
    [next],
  );
});
