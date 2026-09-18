import test from 'node:test';
import assert from 'node:assert/strict';
import { getThreadStatusPresentation } from '../utils/threadStatus.js';

test('an active Turn is running while its process is online', () => {
  assert.deepEqual(
    getThreadStatusPresentation({
      runtime_status: 'running',
      session_status: 'locked',
      last_turn_status: 'in_progress',
      turn_active: true,
      process_online: true,
    }),
    {
      turnActive: true,
      isRunning: true,
    },
  );
});

test('a locked idle process is standby, not running', () => {
  assert.deepEqual(
    getThreadStatusPresentation({
      runtime_status: 'running',
      session_status: 'locked',
      last_turn_status: 'completed',
      turn_active: false,
      process_online: true,
    }),
    {
      turnActive: false,
      isRunning: false,
    },
  );
});

test('an interrupted Turn is not shown as running', () => {
  const status = getThreadStatusPresentation({
    last_turn_status: 'interrupted',
    turn_active: false,
    process_online: false,
  });

  assert.equal(status.isRunning, false);
});
