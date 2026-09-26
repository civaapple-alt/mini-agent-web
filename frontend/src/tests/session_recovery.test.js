import test from 'node:test';
import assert from 'node:assert/strict';
import { isRuntimeSettled, projectReplayPage } from '../utils/sessionRecovery.js';

test('idle runtime status settles stale local turn state without a turn id', () => {
  assert.equal(isRuntimeSettled({ phase: 'idle', turn_id: null }), true);
  assert.equal(isRuntimeSettled({ phase: 'completed', turn_id: 'turn-1' }), true);
  assert.equal(isRuntimeSettled({ phase: 'failed', turn_id: null }), true);
  assert.equal(isRuntimeSettled({ phase: 'running', turn_id: 'turn-2' }), false);
});

test('an incomplete event suffix is discarded after snapshot recovery', () => {
  const replay = projectReplayPage({
    has_gap: true,
    next_cursor: 128,
    data: [
      { sequence: 127, event: { type: 'turn_started' } },
      { sequence: 128, event: { type: 'item_delta' } },
    ],
  });

  assert.deepEqual(replay, { hasGap: true, cursor: 128, events: [] });
});

test('a gap with no retained suffix advances to just before the oldest event', () => {
  const replay = projectReplayPage({
    has_gap: true,
    oldest_sequence: 42,
    data: [],
  });

  assert.deepEqual(replay, { hasGap: true, cursor: 41, events: [] });
});

test('a complete replay page is applied and keeps its newest cursor', () => {
  const events = [
    { sequence: 4, event: { type: 'turn_started' } },
    { sequence: 5, event: { type: 'turn_finished' } },
  ];
  const replay = projectReplayPage({ hasGap: false, nextCursor: 5, data: events });

  assert.deepEqual(replay, { hasGap: false, cursor: 5, events });
});
