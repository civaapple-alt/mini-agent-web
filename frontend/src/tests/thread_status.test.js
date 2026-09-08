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
      processOnline: true,
      lifecycleLabel: '运行中',
      lifecycleClass: 'running',
      processLabel: '在线',
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
      processOnline: true,
      lifecycleLabel: '历史',
      lifecycleClass: 'historical',
      processLabel: '待命',
    },
  );
});
