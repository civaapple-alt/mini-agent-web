import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRunFailure,
  normalizeGoal,
  normalizeInputPayload,
  readPersistedSessionSelection,
  scopedThreadKey,
} from '../utils/sessionState.js';

test('session state helpers preserve scoped identities and bounded projections', () => {
  assert.equal(scopedThreadKey('default', 'project-a'), 'project-a:default');
  assert.deepEqual(normalizeInputPayload('hello'), {
    prompt: 'hello',
    images: [],
    referencedFiles: [],
  });
  assert.equal(formatRunFailure({ type: 'limit_exceeded', detail: { kind: 'turns' } }), '达到运行限制（turns）');
  assert.deepEqual(normalizeGoal({ threadId: 't-1', tokenBudget: 12 }).thread_id, 't-1');
});

test('persisted selection fails closed when storage is unavailable or malformed', () => {
  assert.deepEqual(readPersistedSessionSelection(null), {});
  assert.deepEqual(
    readPersistedSessionSelection({ getItem: () => '{not-json' }),
    {},
  );
  assert.deepEqual(
    readPersistedSessionSelection({
      getItem: () => JSON.stringify({ threadId: 't-1', projectId: 'project-a' }),
    }),
    { threadId: 't-1', projectId: 'project-a' },
  );
});
