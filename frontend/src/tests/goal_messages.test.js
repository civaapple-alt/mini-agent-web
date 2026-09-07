import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendGoalMessage,
  createGoalMessage,
  extractGoalObjective,
} from '../utils/goalMessages.js';

test('goal turn prompts are projected to a concise objective', () => {
  const prompt = [
    'Autonomous Goal Mode is active. Execute the objective now.',
    '',
    'Objective:',
    '完成权限审批链路',
  ].join('\n');

  assert.equal(extractGoalObjective(prompt), '完成权限审批链路');
  assert.equal(extractGoalObjective('普通用户消息'), '');
});

test('goal messages are deduplicated by objective', () => {
  const first = appendGoalMessage([], { objective: '完成权限审批链路' });
  const second = appendGoalMessage(first, { objective: '完成权限审批链路' });

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(second[0].text, '/goal 完成权限审批链路');
  assert.equal(createGoalMessage(' x ').isGoal, true);
});
