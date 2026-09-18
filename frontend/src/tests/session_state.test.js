import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRunFailure,
  normalizeGoal,
  normalizeInputPayload,
  readPersistedSessionSelection,
  scopedThreadKey,
} from '../utils/sessionState.js';
import {
  buildAutoThreadTitle,
  isDefaultThreadTitle,
} from '../utils/threadTitle.js';

test('builds bounded thread titles from the beginning of the first prompt', () => {
  assert.equal(
    buildAutoThreadTitle('  修复 Web Studio 的侧栏导航，并补充历史会话兼容测试  '),
    '修复 Web Studio 的侧栏导航，并补充历史会话兼容测试',
  );
  assert.equal(buildAutoThreadTitle('abcdefghijklmnopqrstuvwxyz', 8), 'abcdefgh…');
});

test('recognizes only generated thread titles as auto-title candidates', () => {
  assert.equal(isDefaultThreadTitle('新会话 t-demo', 't-demo'), true);
  assert.equal(isDefaultThreadTitle('默认会话', 'default'), true);
  assert.equal(isDefaultThreadTitle('我自己的标题', 't-demo'), false);
});

test('session state helpers preserve scoped identities and bounded projections', () => {
  assert.equal(scopedThreadKey('default', 'project-a'), 'project-a:default');
  assert.deepEqual(normalizeInputPayload('hello'), {
    prompt: 'hello',
    images: [],
    referencedFiles: [],
    textAttachments: [],
    fileAttachments: [],
  });
  assert.equal(
    normalizeInputPayload({
      prompt: 'inspect',
      textAttachments: [{ name: 'pasted-text.txt', content: 'INFO: failed' }],
    }).textAttachments[0].name,
    'pasted-text.txt',
  );
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
