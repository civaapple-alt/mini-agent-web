import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contextCacheHitRatio,
  contextCategoryBreakdown,
  aggregateContextCacheUsage,
  estimateContextCategoryTokens,
  formatContextPercentage,
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

test('context visualization uses byte shares and the Provider reported cache ratio', () => {
  const usage = normalizeContextUsage({
    usage: { inputTokens: 1200, cachedInputTokens: 850 },
    contextBytes: { projectInstructions: 100, tools: 300 },
  });

  assert.deepEqual(
    contextCategoryBreakdown(usage).map(({ key, share }) => [key, share]),
    [['projectInstructions', 0.25], ['tools', 0.75]],
  );
  assert.equal(contextCacheHitRatio(usage), 850 / 1200);
  assert.equal(formatContextPercentage(contextCacheHitRatio(usage)), '70.8%');
});

test('zero, missing, and impossible cache usage stay distinguishable', () => {
  assert.equal(
    contextCacheHitRatio({ usage: { inputTokens: 100, cachedInputTokens: 0 } }),
    0,
  );
  assert.equal(
    contextCacheHitRatio({ usage: { inputTokens: 100, cachedInputTokens: null } }),
    null,
  );
  assert.equal(
    contextCacheHitRatio({ usage: { inputTokens: 100, cachedInputTokens: 101 } }),
    null,
  );
});

test('session cache ratio is token-weighted across provider reports', () => {
  const usage = aggregateContextCacheUsage([
    { contextUsage: { usageTotals: {
      requestCount: 2,
      inputTokens: 400,
      cacheReportCount: 1,
      cacheReportedInputTokens: 100,
      cachedInputTokens: 80,
    } } },
    { contextUsage: { usageTotals: {
      requestCount: 1,
      inputTokens: 200,
      cacheReportCount: 1,
      cacheReportedInputTokens: 200,
      cachedInputTokens: 100,
    } } },
  ]);

  assert.deepEqual(usage, {
    requestCount: 3,
    inputTokens: 600,
    cacheReportCount: 2,
    cacheReportedInputTokens: 300,
    cachedInputTokens: 180,
    trackedTurns: 2,
    untrackedTurns: 0,
    cacheHitRatio: 0.6,
  });
});

test('session cache ratio marks legacy turns untracked and stays unknown without cache reports', () => {
  const usage = aggregateContextCacheUsage([
    { contextUsage: { usage: { inputTokens: 100, cachedInputTokens: 20 } } },
    { contextUsage: { usageTotals: {
      requestCount: 1,
      inputTokens: 100,
      cacheReportCount: 0,
      cacheReportedInputTokens: 0,
      cachedInputTokens: 0,
    } } },
  ]);

  assert.equal(usage.cacheHitRatio, null);
  assert.equal(usage.untrackedTurns, 1);
  assert.equal(usage.trackedTurns, 1);
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
