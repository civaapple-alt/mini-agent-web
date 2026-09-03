import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAndExecuteSlashCommand } from '../utils/slashCommands.js';

test('slash command parser handles /plan, /clear, /status, /copy cleanly', () => {
  let planned = false;
  let cleared = false;
  let statusOpened = false;
  let copied = false;

  const callbacks = {
    isGenerating: false,
    onTogglePlanMode: () => { planned = true; },
    onClearChat: () => { cleared = true; },
    onOpenStatus: () => { statusOpened = true; },
    onCopyLastResponse: () => { copied = true; },
  };

  assert.equal(parseAndExecuteSlashCommand('/plan', callbacks), true);
  assert.equal(planned, true);

  assert.equal(parseAndExecuteSlashCommand('/clear', callbacks), true);
  assert.equal(cleared, true);

  assert.equal(parseAndExecuteSlashCommand('/status', callbacks), true);
  assert.equal(statusOpened, true);

  assert.equal(parseAndExecuteSlashCommand('/copy', callbacks), true);
  assert.equal(copied, true);

  copied = false;
  assert.equal(parseAndExecuteSlashCommand('/cp', callbacks), true);
  assert.equal(copied, true);
});

test('slash command parser handles /steer with active generation and error guard', () => {
  let steeredText = null;
  let toastMsg = null;

  const callbacks = {
    isGenerating: false,
    onSteerMessage: (t) => { steeredText = t; },
    onToast: (msg) => { toastMsg = msg; },
  };

  // 1. Not generating should trigger error toast
  const handledWhenIdle = parseAndExecuteSlashCommand('/steer change strategy', callbacks);
  assert.equal(handledWhenIdle, true);
  assert.equal(steeredText, null);
  assert.match(toastMsg, /无法纠偏/);

  // 2. Generating with instruction steers properly
  callbacks.isGenerating = true;
  const handledWhenActive = parseAndExecuteSlashCommand('/steer focus on unit tests', callbacks);
  assert.equal(handledWhenActive, true);
  assert.equal(steeredText, 'focus on unit tests');

  // 3. Generating with empty steer leaves prompt
  const handledEmpty = parseAndExecuteSlashCommand('/steer', callbacks);
  assert.equal(handledEmpty, false);
});

test('goal slash command passes its objective to the goal runtime', () => {
  let objective = null;
  assert.equal(parseAndExecuteSlashCommand('/goal ship the release', {
    onStartGoal: (value) => { objective = value; },
  }), true);
  assert.equal(objective, 'ship the release');
});
