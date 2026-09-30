import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../api.js';

test('web search settings APIs send provider credentials only on updates', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ settings: { provider: 'exa' } }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await api.getWebSearchSettings({ projectId: 'project-1' });
  assert.match(calls[0].url, /^\/api\/web-search\/settings\?project_id=project-1$/);
  assert.equal(calls[0].options.method, undefined);

  await api.updateWebSearchSettings({ provider: 'exa', exaApiKey: 'exa-secret-value' });
  assert.equal(calls[1].url, '/api/web-search/settings');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    provider: 'exa',
    exaApiKey: 'exa-secret-value',
  });
});
