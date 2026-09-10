import test from 'node:test';
import assert from 'node:assert/strict';
import { getSlashCommandDraft, parseAndExecuteSlashCommand } from '../utils/slashCommands.js';

test('slash command selection prepares input for commands with arguments', () => {
  assert.equal(getSlashCommandDraft('/plan'), '/plan ');
  assert.equal(getSlashCommandDraft('/goal'), '/goal ');
  assert.equal(getSlashCommandDraft('/clear'), null);
  assert.equal(getSlashCommandDraft('/status'), null);
});

test('slash command parser handles only /plan, /goal, and /clear', () => {
  let planned = false;
  let cleared = false;

  const callbacks = {
    onTogglePlanMode: () => { planned = true; },
    onClearChat: () => { cleared = true; },
  };

  assert.equal(parseAndExecuteSlashCommand('/plan', callbacks), true);
  assert.equal(planned, true);

  assert.equal(parseAndExecuteSlashCommand('/clear', callbacks), true);
  assert.equal(cleared, true);

  assert.equal(parseAndExecuteSlashCommand('/status', callbacks), false);
  assert.equal(parseAndExecuteSlashCommand('/copy', callbacks), false);
  assert.equal(parseAndExecuteSlashCommand('/steer change strategy', callbacks), false);
});

test('plan slash command accepts a task and starts it in Plan Mode', () => {
  let task = null;
  let toggled = false;
  assert.equal(parseAndExecuteSlashCommand('/plan inspect the auth flow', {
    onStartPlanTask: (value) => { task = value; },
    onTogglePlanMode: () => { toggled = true; },
  }), true);
  assert.equal(task, 'inspect the auth flow');
  assert.equal(toggled, false);
});

test('goal slash command passes its objective to the goal runtime', () => {
  let objective = null;
  assert.equal(parseAndExecuteSlashCommand('/goal ship the release', {
    onStartGoal: (value) => { objective = value; },
  }), true);
  assert.equal(objective, 'ship the release');
});
