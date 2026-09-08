import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readRuntimeGeneration,
  readStateRevision,
  shouldApplyRuntimeGeneration,
  shouldApplyStateRevision,
} from '../utils/revisionState.js';

test('revision projection accepts forward and repeated state, rejects stale state', () => {
  assert.equal(readStateRevision({ stateRevision: 7 }), 7);
  assert.equal(readStateRevision({ state_revision: 8 }), 8);
  assert.equal(readStateRevision({ stateRevision: 'bad' }), null);
  assert.equal(shouldApplyStateRevision(4, 5), true);
  assert.equal(shouldApplyStateRevision(5, 5), true);
  assert.equal(shouldApplyStateRevision(5, 4), false);
  assert.equal(shouldApplyStateRevision(undefined, null), true);
  assert.equal(shouldApplyStateRevision(5, null), false);
});

test('runtime restart projection accepts only a newer generation', () => {
  assert.equal(readRuntimeGeneration({ runtimeGeneration: 3 }), 3);
  assert.equal(readRuntimeGeneration({ runtime_generation: 4 }), 4);
  assert.equal(readRuntimeGeneration({ runtimeGeneration: 0 }), null);
  assert.equal(shouldApplyRuntimeGeneration(2, 3), true);
  assert.equal(shouldApplyRuntimeGeneration(3, 3), false);
  assert.equal(shouldApplyRuntimeGeneration(3, 2), false);
});
