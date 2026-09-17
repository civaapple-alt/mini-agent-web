import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPLEMENTATION_PROMPT,
  startImplementationTurn,
} from '../utils/planWorkflow.js';

test('implementation action submits a turn after Plan Mode is disabled', async () => {
  const disablePlanMode = async () => true;
  const sent = [];

  const started = await startImplementationTurn({
    disablePlanMode,
    sendTurn: (payload) => {
      sent.push(payload);
      return true;
    },
  });

  assert.equal(started, true);
  assert.deepEqual(sent, [{
    prompt: IMPLEMENTATION_PROMPT,
    images: [],
    referencedFiles: [],
    selectedSkills: [],
  }]);
});

test('implementation action does not submit a turn when Plan Mode cannot be disabled', async () => {
  let sendCount = 0;
  const started = await startImplementationTurn({
    disablePlanMode: async () => false,
    sendTurn: () => {
      sendCount += 1;
      return true;
    },
  });

  assert.equal(started, false);
  assert.equal(sendCount, 0);
});
