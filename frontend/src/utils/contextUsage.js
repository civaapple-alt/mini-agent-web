export const CONTEXT_CATEGORIES = [
  ['systemPrompt', '系统提示词'],
  ['projectInstructions', '项目指令'],
  ['skills', '技能'],
  ['workspaceState', '工作区状态'],
  ['conversation', '会话内容'],
  ['tools', '工具定义'],
  ['other', '其他'],
];

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function field(value, camel, snake = camel) {
  return value?.[camel] ?? value?.[snake];
}

export function normalizeContextUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const source = value.contextUsage || value.context_usage || value;
  const usage = source.usage && typeof source.usage === 'object'
    ? source.usage
    : source;
  const rawBytes = source.contextBytes || source.context_bytes;
  const contextBytes = rawBytes && typeof rawBytes === 'object'
    ? Object.fromEntries(CONTEXT_CATEGORIES.map(([key]) => [
      key,
      finiteNonNegative(field(rawBytes, key)),
    ]))
    : null;
  const rawModelContext = field(source, 'modelContext', 'model_context');
  const selection = field(rawModelContext, 'selection') || rawModelContext || {};
  const modelContext = rawModelContext && typeof rawModelContext === 'object'
    ? {
      providerId: field(selection, 'providerId', 'provider_id') || '',
      modelId: field(selection, 'modelId', 'model_id') || '',
      contextWindowTokens: finiteNonNegative(field(
        rawModelContext,
        'contextWindowTokens',
        'context_window_tokens',
      )),
      maxOutputTokens: finiteNonNegative(field(
        rawModelContext,
        'maxOutputTokens',
        'max_output_tokens',
      )),
    }
    : null;
  const rawUsageTotals = source.usageTotals || source.usage_totals;
  const usageTotals = rawUsageTotals && typeof rawUsageTotals === 'object'
    ? {
      requestCount: finiteNonNegative(field(rawUsageTotals, 'requestCount', 'request_count')),
      inputTokens: finiteNonNegative(field(rawUsageTotals, 'inputTokens', 'input_tokens')),
      cacheReportCount: finiteNonNegative(field(rawUsageTotals, 'cacheReportCount', 'cache_report_count')),
      cacheReportedInputTokens: finiteNonNegative(field(
        rawUsageTotals,
        'cacheReportedInputTokens',
        'cache_reported_input_tokens',
      )),
      cachedInputTokens: finiteNonNegative(field(
        rawUsageTotals,
        'cachedInputTokens',
        'cached_input_tokens',
      )),
    }
    : null;

  return {
    inputTokens: usage && typeof usage === 'object'
      ? finiteNonNegative(field(usage, 'inputTokens', 'input_tokens'))
      : null,
    cachedInputTokens: usage && typeof usage === 'object'
      ? finiteNonNegative(field(usage, 'cachedInputTokens', 'cached_input_tokens'))
      : null,
    outputTokens: usage && typeof usage === 'object'
      ? finiteNonNegative(field(usage, 'outputTokens', 'output_tokens'))
      : null,
    contextBytes,
    modelContext,
    usageTotals,
  };
}

export function mergeContextInjectionRecords(current = [], incoming = []) {
  const records = new Map(
    (current || [])
      .filter((record) => record?.id)
      .map((record) => [record.id, record]),
  );
  for (const record of incoming || []) {
    if (!record?.id) continue;
    const existing = records.get(record.id);
    if (existing?.fingerprint === record.fingerprint) continue;
    records.set(record.id, record);
  }
  return [...records.values()];
}

export function estimateContextCategoryTokens(contextUsage) {
  const normalized = normalizeContextUsage(contextUsage);
  if (!normalized || normalized.inputTokens === null || !normalized.contextBytes) return null;
  const byteTotal = CONTEXT_CATEGORIES.reduce(
    (total, [key]) => total + (normalized.contextBytes[key] || 0),
    0,
  );
  if (byteTotal <= 0) return null;

  const entries = CONTEXT_CATEGORIES.map(([key, label]) => ({
    key,
    label,
    bytes: normalized.contextBytes[key] || 0,
    tokens: Math.floor(
      normalized.inputTokens * (normalized.contextBytes[key] || 0) / byteTotal,
    ),
  }));
  const assigned = entries.reduce((total, item) => total + item.tokens, 0);
  const remainder = normalized.inputTokens - assigned;
  if (remainder > 0) {
    const largest = entries.reduce(
      (best, item, index) => item.bytes > entries[best].bytes ? index : best,
      0,
    );
    entries[largest].tokens += remainder;
  }
  return entries;
}

export function contextCategoryBreakdown(contextUsage) {
  const normalized = normalizeContextUsage(contextUsage);
  if (!normalized?.contextBytes) return null;

  const totalBytes = CONTEXT_CATEGORIES.reduce(
    (total, [key]) => total + (normalized.contextBytes[key] || 0),
    0,
  );
  if (totalBytes <= 0) return null;

  const estimatedTokens = new Map(
    (estimateContextCategoryTokens(normalized) || [])
      .map((entry) => [entry.key, entry.tokens]),
  );
  return CONTEXT_CATEGORIES.flatMap(([key, label]) => {
    const bytes = normalized.contextBytes[key] || 0;
    if (bytes <= 0) return [];
    return [{
      key,
      label,
      bytes,
      share: bytes / totalBytes,
      estimatedTokens: estimatedTokens.get(key) ?? null,
    }];
  });
}

export function contextCacheHitRatio(contextUsage) {
  const normalized = normalizeContextUsage(contextUsage);
  const inputTokens = normalized?.inputTokens;
  const cachedInputTokens = normalized?.cachedInputTokens;
  if (
    inputTokens === null
    || inputTokens === undefined
    || inputTokens <= 0
    || cachedInputTokens === null
    || cachedInputTokens === undefined
    || cachedInputTokens > inputTokens
  ) {
    return null;
  }
  return cachedInputTokens / inputTokens;
}

export function aggregateContextCacheUsage(presentations) {
  const totals = {
    requestCount: 0,
    inputTokens: 0,
    cacheReportCount: 0,
    cacheReportedInputTokens: 0,
    cachedInputTokens: 0,
    trackedTurns: 0,
    untrackedTurns: 0,
  };

  for (const presentation of presentations || []) {
    const usage = normalizeContextUsage(presentation?.contextUsage);
    if (!usage) continue;
    const turnTotals = usage.usageTotals;
    if (!turnTotals) {
      if (usage.inputTokens !== null) totals.untrackedTurns += 1;
      continue;
    }

    const counters = Object.values(turnTotals);
    if (counters.some((value) => value === null)) {
      totals.untrackedTurns += 1;
      continue;
    }
    totals.trackedTurns += 1;
    totals.requestCount += turnTotals.requestCount;
    totals.inputTokens += turnTotals.inputTokens;
    totals.cacheReportCount += turnTotals.cacheReportCount;
    totals.cacheReportedInputTokens += turnTotals.cacheReportedInputTokens;
    totals.cachedInputTokens += turnTotals.cachedInputTokens;
  }

  if (totals.trackedTurns === 0 && totals.untrackedTurns === 0) return null;
  const cacheHitRatio = totals.cacheReportedInputTokens > 0
    && totals.cachedInputTokens <= totals.cacheReportedInputTokens
    ? totals.cachedInputTokens / totals.cacheReportedInputTokens
    : null;
  return { ...totals, cacheHitRatio };
}

export function formatContextPercentage(ratio) {
  if (!Number.isFinite(ratio) || ratio < 0) return '未知';
  const percentage = ratio * 100;
  return percentage > 0 && percentage < 0.05
    ? '<0.1%'
    : `${percentage.toFixed(1)}%`;
}
