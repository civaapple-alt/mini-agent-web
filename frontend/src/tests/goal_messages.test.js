import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendGoalMessage,
  createGoalMessage,
  createGoalVerificationMessage,
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

test('Goal verification messages expose live verifier progress and artifact paths', () => {
  const message = createGoalVerificationMessage({
    thread_id: 't-goal',
    current_milestone: 2,
    total_milestones: 3,
    verification_status: 'running',
    updated_at: 123,
  });

  assert.equal(message.messageKind, 'goal_verification');
  assert.match(message.text, /Verify 进行中/);
  assert.match(message.text, /goal\/plan\.md/);
  assert.match(message.text, /goal\/verifier_verdict\.md/);
});

test('Goal verification failure is rendered with the persisted error', () => {
  const message = createGoalVerificationMessage({
    threadId: 't-goal',
    verificationStatus: 'failed',
    lastError: 'verifier timed out',
    updatedAt: 124,
  });

  assert.match(message.text, /Verify 失败/);
  assert.match(message.text, /verifier timed out/);
});
