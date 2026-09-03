import test from 'node:test';
import assert from 'node:assert/strict';
import { api, createAgentWebSocket } from '../api.js';

test('api client methods construct expected fetch endpoints and payloads', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/api/threads') && options.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ thread_id: 't-123', title: 'Test Thread' }),
      };
    }
    if (url.includes('/api/settings') && options.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          settings: { profile: 'auto', approval_policy: 'auto_approve' },
        }),
      };
    }
    if (url.includes('/api/approval/respond')) {
      return {
        ok: true,
        json: async () => ({ status: 'resolved' }),
      };
    }
    return {
      ok: true,
      json: async () => ({ success: true }),
    };
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // 1. Thread APIs
  const startRes = await api.startThread('t-123', 'Test Thread');
  assert.equal(startRes.thread_id, 't-123');
  assert.equal(calls[0].url, '/api/threads');
  assert.equal(JSON.parse(calls[0].options.body).title, 'Test Thread');

  await api.listThreadItems('t-123', { limit: 64, sortDirection: 'desc' });
  assert.equal(calls[calls.length - 1].url, '/api/threads/t-123/items?limit=64&sort_direction=desc');

  // 2. Settings APIs
  const setRes = await api.updateSettings({ profile: 'auto' });
  assert.equal(setRes.settings.profile, 'auto');

  // 2b. Thread settings and Goal Runtime APIs
  await api.setCollaborationMode('plan');
  const settingsCall = calls[calls.length - 1];
  assert.equal(settingsCall.url, '/api/threads/default/settings');
  assert.equal(JSON.parse(settingsCall.options.body).mode, 'plan');

  await api.updateThreadSettings('plan', ['read_file', 'shell'], 't-123');
  const toolSettingsCall = calls[calls.length - 1];
  assert.equal(toolSettingsCall.url, '/api/threads/t-123/settings');
  assert.deepEqual(JSON.parse(toolSettingsCall.options.body).builtin_tools, [
    'read_file',
    'shell',
  ]);
  assert.equal(JSON.parse(toolSettingsCall.options.body).thread_id, undefined);

  await api.setGoal('Ship the next release', 4096);
  const goalCall = calls[calls.length - 1];
  assert.equal(goalCall.url, '/api/threads/default/goal');
  assert.equal(JSON.parse(goalCall.options.body).token_budget, 4096);

  await api.getGoal();
  assert.equal(calls[calls.length - 1].url, '/api/threads/default/goal');
  assert.equal(calls[calls.length - 1].options.method, undefined);

  await api.clearGoal();
  assert.equal(calls[calls.length - 1].options.method, 'DELETE');

  // 3. Approval response
  const appRes = await api.respondApproval('req-1', 'allow', '', true);
  assert.equal(appRes.status, 'resolved');
  const lastCall = calls[calls.length - 1];
  const parsedBody = JSON.parse(lastCall.options.body);
  assert.equal(parsedBody.request_id, 'req-1');
  assert.equal(parsedBody.decision, 'allow');
  assert.equal(parsedBody.remember, true);
});

test('createAgentWebSocket provides safe send and isOpen status', (t) => {
  // Mock WebSocket class
  class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = MockWebSocket.OPEN;
      this.sentData = [];
      setTimeout(() => {
        if (this.onopen) this.onopen();
      }, 0);
    }

    send(data) {
      this.sentData.push(data);
    }

    close() {
      this.readyState = MockWebSocket.CLOSED;
      if (this.onclose) this.onclose();
    }
  }

  const originalWS = globalThis.WebSocket;
  const originalLocation = globalThis.window?.location;
  globalThis.WebSocket = MockWebSocket;
  globalThis.window = {
    location: { protocol: 'http:', host: 'localhost:8000' },
  };

  t.after(() => {
    globalThis.WebSocket = originalWS;
    globalThis.window = originalLocation;
  });

  let opened = false;
  const client = createAgentWebSocket(
    () => {},
    () => {
      opened = true;
    }
  );

  assert.equal(client.isOpen(), true);
  const success = client.send({ action: 'ping' });
  assert.equal(success, true);

  client.close();
  assert.equal(client.isOpen(), false);
  const fail = client.send({ action: 'ping' });
  assert.equal(fail, false);
});
