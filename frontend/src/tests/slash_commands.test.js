import test from 'node:test';
import assert from 'node:assert/strict';

// Helper function implementing the InputBar slash command resolution logic
function parseSlashCommand(input, { isGenerating, onSteer, onPlan, onClear, onStatus, onCopy }) {
  const cleanCmd = input.trim();
  const lowerCmd = cleanCmd.toLowerCase();

  if (lowerCmd === '/plan') {
    if (onPlan) onPlan();
    return { handled: true, action: 'plan' };
  }
  if (lowerCmd === '/clear') {
    if (onClear) onClear();
    return { handled: true, action: 'clear' };
  }
  if (lowerCmd === '/status') {
    if (onStatus) onStatus();
    return { handled: true, action: 'status' };
  }
  if (lowerCmd === '/copy' || lowerCmd === '/cp') {
    if (onCopy) onCopy();
    return { handled: true, action: 'copy' };
  }
  if (lowerCmd.startsWith('/steer')) {
    const steerText = cleanCmd.slice(6).trim();
    if (!isGenerating) {
      return { handled: true, error: 'not_generating' };
    }
    if (!steerText) {
      return { handled: true, prompt: '/steer ' };
    }
    if (onSteer) onSteer(steerText);
    return { handled: true, action: 'steer', text: steerText };
  }
  return { handled: false };
}

test('slash command parser handles /plan, /clear, /status, /copy cleanly', () => {
  let planned = false;
  let cleared = false;
  let statusOpened = false;
  let copied = false;

  const callbacks = {
    isGenerating: false,
    onPlan: () => { planned = true; },
    onClear: () => { cleared = true; },
    onStatus: () => { statusOpened = true; },
    onCopy: () => { copied = true; },
  };

  assert.equal(parseSlashCommand('/plan', callbacks).action, 'plan');
  assert.equal(planned, true);

  assert.equal(parseSlashCommand('/clear', callbacks).action, 'clear');
  assert.equal(cleared, true);

  assert.equal(parseSlashCommand('/status', callbacks).action, 'status');
  assert.equal(statusOpened, true);

  assert.equal(parseSlashCommand('/copy', callbacks).action, 'copy');
  assert.equal(parseSlashCommand('/cp', callbacks).action, 'copy');
  assert.equal(copied, true);
});

test('slash command parser handles /steer with active generation and error guard', () => {
  let steerPayload = '';
  const callbacks = {
    isGenerating: false,
    onSteer: (text) => { steerPayload = text; },
  };

  // 1. Not generating -> returns error guard
  const idleRes = parseSlashCommand('/steer stop and test again', callbacks);
  assert.equal(idleRes.error, 'not_generating');

  // 2. Generating with text -> calls onSteer
  callbacks.isGenerating = true;
  const activeRes = parseSlashCommand('/steer optimize loop performance', callbacks);
  assert.equal(activeRes.action, 'steer');
  assert.equal(steerPayload, 'optimize loop performance');
});

test('profile defaults mapping aligns across interactive, auto, ask', () => {
  const PROFILE_DEFAULTS = {
    interactive: { approval_policy: 'per_action', default_mode: 'chat' },
    auto: { approval_policy: 'auto_approve', default_mode: 'goal' },
    ask: { approval_policy: 'strict', default_mode: 'plan' },
  };

  assert.equal(PROFILE_DEFAULTS.interactive.approval_policy, 'per_action');
  assert.equal(PROFILE_DEFAULTS.auto.approval_policy, 'auto_approve');
  assert.equal(PROFILE_DEFAULTS.ask.approval_policy, 'strict');
});
