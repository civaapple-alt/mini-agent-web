import test from 'node:test';
import assert from 'node:assert/strict';
import { readStateRevision, shouldApplyStateRevision } from '../utils/revisionState.js';

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
