import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api.js';
import {
  countNewItemsOnRefresh,
  HISTORY_PAGE_SIZE,
  historyItemKey,
  listOlderThreadItems,
  listNewestThreadItems,
  mergeHistoryPages,
  normalizeDescendingHistoryPage,
  shiftHistoryCursor,
  shiftHistoryPage,
} from '../utils/threadHistoryPages.js';

afterEach(() => vi.restoreAllMocks());

describe('thread history pages', () => {
  it('requests just the newest bounded page on startup', async () => {
    const response = { data: [], next_cursor: '128' };
    const request = vi.spyOn(api, 'listThreadItems').mockResolvedValue(response);

    await expect(listNewestThreadItems('thread-a', 'project-a')).resolves.toBe(response);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('thread-a', {
      limit: 128,
      sortDirection: 'desc',
      projectId: 'project-a',
      signal: undefined,
    });
  });

  it('requests an older page with the supplied cursor', async () => {
    const response = { data: [], next_cursor: null };
    const request = vi.spyOn(api, 'listThreadItems').mockResolvedValue(response);

    await expect(listOlderThreadItems('thread-a', 'project-a', '128'))
      .resolves.toBe(response);
    expect(request).toHaveBeenCalledWith('thread-a', {
      limit: HISTORY_PAGE_SIZE,
      cursor: '128',
      sortDirection: 'desc',
      projectId: 'project-a',
      signal: undefined,
    });
  });

  it('reverses descending pages and keeps a stable chronological cursor order', () => {
    const newest = normalizeDescendingHistoryPage({
      data: [
        { turnId: 'turn-3', item: { type: 'agentMessage', id: 'm3' } },
        { turnId: 'turn-2', item: { type: 'agentMessage', id: 'm2' } },
      ],
      next_cursor: '2',
    });
    const older = normalizeDescendingHistoryPage({
      data: [
        { turnId: 'turn-1b', item: { type: 'reasoning', id: 'r1' } },
        { turnId: 'turn-1', item: { type: 'userMessage', id: 'u1' } },
      ],
      next_cursor: null,
    }, '2');

    expect(newest.entries.map((entry) => [entry.item.id, entry.historyOrder])).toEqual([
      ['m2', -1],
      ['m3', 0],
    ]);
    expect(older.entries.map((entry) => [entry.item.id, entry.historyOrder])).toEqual([
      ['u1', -3],
      ['r1', -2],
    ]);
    expect(mergeHistoryPages(newest.entries, older.entries).map((entry) => entry.item.id))
      .toEqual(['u1', 'r1', 'm2', 'm3']);
  });

  it('moves loaded entries and the next cursor when new items arrive', () => {
    const existing = normalizeDescendingHistoryPage({
      data: [
        { turnId: 'turn-2', item: { type: 'agentMessage', id: 'm2' } },
        { turnId: 'turn-1', item: { type: 'agentMessage', id: 'm1' } },
      ],
      next_cursor: '2',
    }).entries;
    expect(shiftHistoryPage(existing, 1).map((entry) => entry.historyOrder)).toEqual([-2, -1]);
    expect(shiftHistoryCursor('2', 1)).toBe('3');
    expect(shiftHistoryCursor(null, 1)).toBeNull();
  });

  it('uses a shared latest-page item to rebase refreshes and resets when pages do not overlap', () => {
    const previous = normalizeDescendingHistoryPage({
      data: [
        { turnId: 'turn-2', item: { type: 'agentMessage', id: 'm2' } },
        { turnId: 'turn-1', item: { type: 'agentMessage', id: 'm1' } },
      ],
    });
    const previousKeys = new Set(previous.entries.map(historyItemKey));
    const overlappingRefresh = normalizeDescendingHistoryPage({
      data: [
        { turnId: 'turn-3', item: { type: 'agentMessage', id: 'm3' } },
        { turnId: 'turn-2', item: { type: 'agentMessage', id: 'm2' } },
      ],
    });
    const refreshWithoutOverlap = normalizeDescendingHistoryPage({
      data: [
        { turnId: 'turn-5', item: { type: 'agentMessage', id: 'm5' } },
        { turnId: 'turn-4', item: { type: 'agentMessage', id: 'm4' } },
      ],
    });

    expect(countNewItemsOnRefresh(overlappingRefresh.entries, previousKeys)).toBe(1);
    expect(countNewItemsOnRefresh(refreshWithoutOverlap.entries, previousKeys)).toBeNull();
  });
});
