import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findAttentionMessage,
  getToolCallIds,
  pendingApprovalCallId,
} from '../utils/attentionTargets.js';

test('tool ids include tools nested in activity groups', () => {
  const messages = [{
    role: 'assistant',
    blocks: [{
      type: 'assistantActivityGroup',
      items: [{ type: 'tool', id: 'call-1', name: 'shell' }],
    }],
  }];

  assert.deepEqual([...getToolCallIds(messages)], ['call-1']);
});

test('attention matching uses call and Turn identity instead of tool names', () => {
  const messages = [
    {
      id: 'wrong-turn',
      turnId: 'turn-old',
      role: 'assistant',
      blocks: [{ type: 'tool', id: 'call-1', name: 'shell' }],
    },
    {
      id: 'target',
      turnId: 'turn-current',
      role: 'assistant',
      blocks: [{ type: 'tool', id: 'call-2', name: 'shell' }],
    },
  ];

  assert.equal(
    findAttentionMessage(messages, { callId: 'call-2', turnId: 'turn-current' }).id,
    'target',
  );
  assert.equal(findAttentionMessage(messages, { callId: 'call-missing', turnId: 'turn-current' }), null);
});

test('approval identity keeps the provider call id', () => {
  assert.equal(
    pendingApprovalCallId({ requestId: 'req-1', data: { call_id: 'call-2' } }),
    'call-2',
  );
});
