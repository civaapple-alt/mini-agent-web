import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getExecutionSettings,
  getStatusViewModel,
  normalizeTheme,
} from '../utils/statusModel.js';

test('status priority keeps stopping above approval and running', () => {
  const status = getStatusViewModel({
    isConnected: true,
    isGenerating: true,
    isInterrupting: true,
    activeTurnId: 'turn-1',
    pendingApproval: { requestId: 'req-1', data: { turnId: 'turn-1' } },
  });

  assert.equal(status.lifecycle, 'stopping');
  assert.equal(status.approval.state, 'cancelling');
  assert.equal(status.scope.turnId, 'turn-1');
});

test('approval is visible above an active Turn', () => {
  const status = getStatusViewModel({
    isConnected: true,
    isGenerating: true,
    activeTurnId: 'turn-2',
    pendingApproval: {
      requestId: 'req-2',
      data: { turnId: 'turn-2', actionSummary: '写入文件' },
    },
  });

  assert.equal(status.lifecycle, 'approval');
  assert.equal(status.summary, '敏感操作已暂停，等待人工授权');
  assert.equal(status.approval.actionSummary, '写入文件');
});

test('authoritative stopping phase locks the Turn even without local stop state', () => {
  const status = getStatusViewModel({
    isConnected: true,
    runtimeStatus: { phase: 'stopping', turnId: 'turn-remote' },
    pendingApproval: {
      requestId: 'req-remote',
      data: { turnId: 'turn-remote' },
    },
  });

  assert.equal(status.lifecycle, 'stopping');
  assert.equal(status.nextAction, '等待终止确认');
  assert.equal(status.scope.turnId, 'turn-remote');
});

test('a locked idle process remains standby and does not become running', () => {
  const status = getStatusViewModel({
    isConnected: true,
    isGenerating: false,
    runtimeStatus: { phase: 'idle', active: false },
  });

  assert.equal(status.lifecycle, 'idle');
  assert.equal(status.process.turnActive, false);
  assert.equal(status.process.processLabel, '待命');
});

test('connection recovery is visible without declaring a false completion', () => {
  const status = getStatusViewModel({
    isConnected: false,
    connectionState: 'reconnecting',
    isGenerating: true,
    activeTurnId: 'turn-3',
  });

  assert.equal(status.connection, 'reconnecting');
  assert.equal(status.lifecycle, 'running');
  assert.equal(status.process.processOnline, true);
  assert.notEqual(status.lifecycle, 'completed');
});

test('connection loss takes priority over a cached completed result', () => {
  const status = getStatusViewModel({
    isConnected: false,
    connectionState: 'offline',
    lastTurnResult: { status: 'completed', turnId: 'turn-7' },
  });

  assert.equal(status.label, '连接中断');
  assert.equal(status.summary, '连接中断，等待运行状态恢复');
  assert.equal(status.nextAction, '等待状态回放');
});

test('legacy themes normalize to the two supported themes', () => {
  assert.equal(normalizeTheme('midnight'), 'dark');
  assert.equal(normalizeTheme('cyberpunk'), 'dark');
  assert.equal(normalizeTheme('unknown'), 'light');
  assert.equal(normalizeTheme('dark'), 'dark');
});

test('Goal owns continuation summary while remaining scoped to the session', () => {
  const settings = getExecutionSettings({
    accessScope: 'project',
    policy: 'interactive',
    continuationMode: 'manual',
    goalState: { status: 'active' },
  });

  assert.equal(settings.summary, '项目范围 · 交互批准 · Goal 接管');
});
