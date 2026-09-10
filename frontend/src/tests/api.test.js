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
          settings: { access: 'project', policy: 'interactive' },
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

  await api.forkThread('t-123', 't-fork', null, 'project-1');
  const forkCall = calls[calls.length - 1];
  assert.equal(forkCall.url, '/api/threads/fork?project_id=project-1');
  assert.equal(JSON.parse(forkCall.options.body).project, 'project-1');
  assert.equal(JSON.parse(forkCall.options.body).project_id, 'project-1');

  // 2. Settings APIs
  const setRes = await api.updateSettings({ reasoning_effort: 'high' });
  assert.equal(setRes.settings.access, 'project');

  await api.setWorldExecution('full_machine', 'automatic');
  const executionCall = calls[calls.length - 1];
  assert.equal(executionCall.url, '/api/world/execution');
  assert.deepEqual(JSON.parse(executionCall.options.body), {
    access: 'full_machine',
    policy: 'automatic',
    project_id: null,
  });

  await api.setWorldExecution('project', 'trusted');
  const trustedExecutionCall = calls[calls.length - 1];
  assert.equal(JSON.parse(trustedExecutionCall.options.body).policy, 'trusted');

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

  await api.updateThreadSettings('default', null, 't-123', 'continuous');
  const continuationCall = calls[calls.length - 1];
  assert.equal(JSON.parse(continuationCall.options.body).continuation_mode, 'continuous');

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
  const appRes = await api.respondApproval(
    'req-1',
    'approve',
    'project',
    ''
  );
  assert.equal(appRes.status, 'resolved');
  const lastCall = calls[calls.length - 1];
  const parsedBody = JSON.parse(lastCall.options.body);
  assert.equal(parsedBody.request_id, 'req-1');
  assert.equal(parsedBody.decision, 'approve');
  assert.equal(parsedBody.grant_scope, 'project');

  await api.respondApproval('req-2', 'deny', null, 'not now', {
    projectId: 'project-2',
    threadId: 'thread-2',
    turnId: 'turn-2',
  });
  const scopedApprovalBody = JSON.parse(calls[calls.length - 1].options.body);
  assert.equal(scopedApprovalBody.project_id, 'project-2');
  assert.equal(scopedApprovalBody.thread_id, 'thread-2');
  assert.equal(scopedApprovalBody.turn_id, 'turn-2');
});

test('thread settings preserve the server guard detail on conflict', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ detail: '当前 Turn 正在执行' }),
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    api.setCollaborationMode('default', 'thread-active'),
    { message: '当前 Turn 正在执行' },
  );
});

test('createAgentWebSocket provides safe send and isOpen status', (t) => {
  // Mock WebSocket class
  class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url) {
      MockWebSocket.lastUrl = url;
      this.url = url;
      this.readyState = MockWebSocket.OPEN;
      this.sentData = [];
      MockWebSocket.lastInstance = this;
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

  const client = createAgentWebSocket(null, null, null, () => 'project-1');
  assert.equal(MockWebSocket.lastUrl, 'ws://localhost:8000/ws/agent?project_id=project-1');

  assert.equal(client.isOpen(), true);
  const success = client.send({ action: 'ping' });
  assert.equal(success, true);
  assert.deepEqual(JSON.parse(MockWebSocket.lastInstance.sentData[0]), {
    action: 'ping',
    project_id: 'project-1',
  });

  client.close();
  assert.equal(client.isOpen(), false);
  const fail = client.send({ action: 'ping' });
  assert.equal(fail, false);
});
