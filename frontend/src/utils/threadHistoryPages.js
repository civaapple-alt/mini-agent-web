import { api } from '../api';

export const HISTORY_PAGE_SIZE = 128;

export function historyItemKey(entry) {
  const turnId = entry?.turnId || entry?.turn_id || '';
  const item = entry?.item || {};
  return `${turnId}:${item.type || ''}:${item.id || JSON.stringify(item)}`;
}

export function countNewItemsOnRefresh(entries, previousLatestKeys) {
  if (!(previousLatestKeys instanceof Set)) return null;
  const hasOverlap = entries.some((entry) => previousLatestKeys.has(historyItemKey(entry)));
  if (!hasOverlap) return null;
  return entries.filter((entry) => !previousLatestKeys.has(historyItemKey(entry))).length;
}

export function normalizeDescendingHistoryPage(page, cursor = 0) {
  const descending = Array.isArray(page?.data) ? page.data : [];
  const offset = Number(cursor) || 0;
  return {
    entries: [...descending].reverse().map((entry, index) => ({
      ...entry,
      historyOrder: offset + descending.length - index - 1 === 0
        ? 0
        : -(offset + descending.length - index - 1),
    })),
    nextCursor: page?.next_cursor || page?.nextCursor || null,
  };
}

export function mergeHistoryPages(existing = [], incoming = []) {
  const merged = new Map(existing.map((entry) => [historyItemKey(entry), entry]));
  for (const entry of incoming) merged.set(historyItemKey(entry), entry);
  return [...merged.values()].sort((left, right) => (
    (left.historyOrder ?? 0) - (right.historyOrder ?? 0)
  ));
}

export function shiftHistoryPage(entries = [], itemCount = 0) {
  if (!itemCount) return entries;
  return entries.map((entry) => ({
    ...entry,
    historyOrder: Number.isFinite(entry.historyOrder)
      ? entry.historyOrder - itemCount
      : entry.historyOrder,
  }));
}

export function shiftHistoryCursor(cursor, itemCount = 0) {
  if (cursor === null || cursor === undefined || cursor === '') return cursor;
  const value = Number(cursor);
  return Number.isSafeInteger(value) && value >= 0
    ? String(value + itemCount)
    : cursor;
}

export function listNewestThreadItems(threadId, projectId, options = {}) {
  return api.listThreadItems(threadId, {
    limit: HISTORY_PAGE_SIZE,
    sortDirection: 'desc',
    projectId,
    signal: options.signal,
  });
}

export function loadThreadHistoryProjections({
  readThread,
  readNewestItems,
  readContextManifest,
}) {
  const contextManifestPromise = Promise.resolve()
    .then(readContextManifest)
    .then(
      (page) => ({ page, error: null }),
      (error) => ({ page: null, error }),
    );
  return Promise.all([readThread(), readNewestItems()]).then(([thread, items]) => ({
    thread,
    items,
    contextManifestPromise,
  }));
}

export function listOlderThreadItems(threadId, projectId, cursor, options = {}) {
  return api.listThreadItems(threadId, {
    limit: HISTORY_PAGE_SIZE,
    cursor,
    sortDirection: 'desc',
    projectId,
    signal: options.signal,
  });
}
