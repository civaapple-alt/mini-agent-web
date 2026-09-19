import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateItemLifecycle,
  aggregateStreamEvent,
  aggregateThreadItems,
  assignHistoryTurnIds,
  approvalIdentity,
  filterEmptyMessages,
  groupCompactionBlocks,
  mergeApprovalEvent,
  normalizeAssistantBlocks,
  orderMessagesByTurnHistory,
  restorePersistedTurnPresentation,
  shouldAcceptEventForThread,
  shouldIgnoreApprovalWhileInterrupting,
  shouldIgnoreStreamEventWhileInterrupting,
  shouldSettleActiveTurnFromError,
} from '../utils/messageState.js';

test('history messages join their durable Turn by item content and call id', () => {
  const assigned = assignHistoryTurnIds(
    [
      { role: 'user', text: 'first' },
      { role: 'assistant', text: '', tool_calls: [{ id: 'call-2' }] },
      { role: 'assistant', text: 'second answer' },
    ],
    [
      { turnId: 'turn-2', item: { type: 'toolCall', id: 'call-2' } },
      { turnId: 'turn-1', item: { type: 'agentMessage', text: 'second answer' } },
      {
        turnId: 'turn-1',
        capturedAt: '2026-09-17T10:00:00.000Z',
        item: { type: 'userMessage', text: 'first' },
      },
    ],
  );

  assert.equal(assigned[0].turnId, 'turn-1');
  assert.equal(assigned[0].capturedAt, '2026-09-17T10:00:00.000Z');
  assert.equal(assigned[1].turnId, 'turn-2');
  assert.equal(assigned[2].turnId, 'turn-1');
});

test('unmatched legacy items create a Turn projection instead of using first assistant', () => {
  const messages = aggregateThreadItems(
    [
      { id: 'assistant-1', role: 'assistant', text: 'first', blocks: [] },
      { id: 'assistant-2', role: 'assistant', text: 'second', blocks: [] },
    ],
    [
      {
        turnId: 'turn-unmatched',
        item: {
          type: 'toolCall',
          id: 'call-unmatched',
          name: 'shell',
          arguments: { command: 'pwd' },
          status: 'completed',
        },
      },
    ],
  );

  assert.equal(messages.length, 3);
  assert.equal(messages[0].blocks.length, 0);
  assert.equal(messages[1].blocks.length, 0);
  assert.equal(messages[2].turnId, 'turn-unmatched');
  assert.equal(messages[2].blocks[0].id, 'call-unmatched');
});

test('restores projected messages before newer checkpoint Turns', () => {
  const ordered = orderMessagesByTurnHistory(
    [
      { id: 'turn-11-user', role: 'user', turnId: 'turn-11', text: '不做剪贴板监听' },
      { id: 'turn-11-assistant', role: 'assistant', turnId: 'turn-11', text: 'answer' },
      { id: 'turn-9-user', role: 'user', turnId: 'turn-9', text: 'recall 继续' },
      { id: 'turn-9-assistant', role: 'assistant', turnId: 'turn-9', text: 'older answer' },
    ],
    [
      { turnId: 'turn-9', item: { type: 'userMessage', text: 'recall 继续' } },
      { turnId: 'turn-9', item: { type: 'agentMessage', text: 'older answer' } },
      { turnId: 'turn-11', item: { type: 'userMessage', text: '不做剪贴板监听' } },
    ],
  );

  assert.deepEqual(ordered.map((message) => message.id), [
    'turn-9-user',
    'turn-9-assistant',
    'turn-11-user',
    'turn-11-assistant',
  ]);
});

test('message stream aggregation cleanly sequences thinking, text, and tools', () => {
  let messages = [];

  // 1. Turn started
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-1',
    event: { type: 'turn_started' },
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'assistant');

  // 2. Reasoning delta
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-1',
    event: { type: 'assistant_reasoning_delta', delta: 'Analyzing requirements...' },
  });
  assert.equal(messages[0].thinking, 'Analyzing requirements...');
  assert.equal(messages[0].blocks.length, 1);
  assert.equal(messages[0].blocks[0].type, 'thinking');
  assert.equal(messages[0].blocks[0].isStreaming, true);

  // 3. Text delta (should finish thinking block streaming state)
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-1',
    event: { type: 'assistant_text_delta', delta: 'Here is the plan.' },
  });
  assert.equal(messages[0].blocks[0].isStreaming, false);
  assert.equal(messages[0].blocks[1].type, 'text');
  assert.equal(messages[0].blocks[1].content, 'Here is the plan.');

  // 4. Tool started
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-1',
    event: { type: 'tool_started', tool: 'shell', call_id: 'call-1', args: { cmd: 'ls' } },
  });
  assert.equal(messages[0].blocks.length, 3);
  assert.equal(messages[0].blocks[2].type, 'tool');
  assert.equal(messages[0].blocks[2].status, 'running');

  // 5. Tool finished
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-1',
    event: {
      type: 'tool_finished',
      call_id: 'call-1',
      output: 'file1.txt\nfile2.txt',
      outcome: 'retryable',
    },
  });
  assert.equal(messages[0].blocks[2].status, 'completed');
  assert.equal(messages[0].blocks[2].outcome, 'retryable');
  assert.equal(messages[0].blocks[2].output, 'file1.txt\nfile2.txt');

  // 6. Turn finished
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-1',
    event: { type: 'turn_finished' },
  });
  assert.equal(messages[0].blocks.every((b) => !b.isStreaming), true);
});

test('skill loading phases merge into one compact Turn status block', () => {
  let messages = aggregateStreamEvent([], {
    type: 'event',
    turnId: 'turn-skills',
    event: { type: 'turn_started' },
  });

  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-skills',
    event: {
      type: 'skills_loaded',
      phase: 'started',
      activation: 'on_demand',
      skills: [{ qualifiedName: 'pstack:architect' }],
    },
  });
  assert.deepEqual(messages[0].blocks[0].loading, ['pstack:architect']);
  assert.deepEqual(messages[0].blocks[0].loaded, []);

  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-skills',
    event: {
      type: 'skills_loaded',
      skills: [{ qualifiedName: 'pstack:architect' }],
    },
  });
  assert.deepEqual(messages[0].blocks[0].loading, []);
  assert.deepEqual(messages[0].blocks[0].loaded, ['pstack:architect']);
  assert.deepEqual(messages[0].blocks[0].skills, ['pstack:architect']);

  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-skills',
    event: {
      type: 'skills_load_failed',
      skills: ['blender-procedural-modeling'],
      reason_code: 'body_read_failed',
    },
  });
  assert.deepEqual(messages[0].blocks[0].failed, ['blender-procedural-modeling']);
  assert.equal(messages[0].blocks[0].reasonCode, 'body_read_failed');
});

test('legacy tool_finished content is preserved as the read_file output', () => {
  let messages = aggregateStreamEvent([], {
    type: 'event',
    turnId: 'turn-read-file-content',
    event: { type: 'turn_started' },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-read-file-content',
    event: {
      type: 'tool_started',
      tool: 'read_file',
      call_id: 'call-read-file-content',
      args: { path: 'scripts/car_model.py', offset: 40, limit: 12 },
    },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-read-file-content',
    event: {
      type: 'tool_finished',
      call_id: 'call-read-file-content',
      content: '41: page content',
    },
  });

  assert.equal(messages[0].blocks[0].output, '41: page content');
});

test('late reasoning remains before the final answer', () => {
  let messages = aggregateStreamEvent([], {
    type: 'event',
    turnId: 'turn-late-reasoning',
    event: { type: 'turn_started' },
  });

  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-late-reasoning',
    event: { type: 'assistant_text_delta', delta: '最终回答' },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-late-reasoning',
    event: { type: 'assistant_reasoning_delta', delta: '补到的思考' },
  });

  assert.deepEqual(
    messages[0].blocks.map((block) => block.type),
    ['thinking', 'text'],
  );
  assert.equal(messages[0].blocks[0].content, '补到的思考');
  assert.equal(messages[0].blocks[1].content, '最终回答');
});

test('late reasoning after a tool is moved before the answer without crossing the tool', () => {
  const blocks = normalizeAssistantBlocks([
    { type: 'tool', name: 'web_fetch' },
    { type: 'text', content: '最终回答' },
    { type: 'thinking', content: '补到的思考' },
  ]);

  assert.deepEqual(blocks.map((block) => block.type), ['tool', 'thinking', 'text']);
});

test('thread isolation rejects foreign thread events', () => {
  const activeThread = 'thread-main';

  const validEvent = {
    type: 'event',
    threadId: 'thread-main',
    event: { type: 'assistant_text_delta', delta: 'hello' },
  };

  const foreignEvent = {
    type: 'event',
    threadId: 'thread-foreign',
    event: { type: 'assistant_text_delta', delta: 'ignored' },
  };

  const genericEvent = {
    type: 'event',
    event: { type: 'assistant_text_delta', delta: 'inherited' },
  };

  assert.equal(shouldAcceptEventForThread(validEvent, activeThread), true);
  assert.equal(shouldAcceptEventForThread(foreignEvent, activeThread), false);
  assert.equal(shouldAcceptEventForThread(genericEvent, activeThread), true);
  assert.equal(
    shouldAcceptEventForThread(
      { ...validEvent, projectId: 'mini-agent-web' },
      activeThread,
      'mini-agent-web',
    ),
    true,
  );
  assert.equal(
    shouldAcceptEventForThread(
      { ...validEvent, projectId: 'pi' },
      activeThread,
      'mini-agent-web',
    ),
    false,
  );
  assert.equal(
    shouldAcceptEventForThread(
      { ...validEvent, projectId: 'pi' },
      activeThread,
      null,
    ),
    false,
  );
});

test('a concurrent Turn error cannot settle the active Turn', () => {
  assert.equal(
    shouldSettleActiveTurnFromError(
      { type: 'error', scope: 'turn', terminal: true },
      'turn-running',
    ),
    false,
  );
  assert.equal(
    shouldSettleActiveTurnFromError(
      { type: 'error', scope: 'turn', terminal: true, turnId: 'turn-old' },
      'turn-running',
    ),
    false,
  );
  assert.equal(
    shouldSettleActiveTurnFromError(
      { type: 'error', scope: 'turn', terminal: true, turnId: 'turn-running' },
      'turn-running',
    ),
    true,
  );
  assert.equal(
    shouldSettleActiveTurnFromError({ type: 'error', scope: 'turn' }, null),
    true,
  );
});

test('a stopped Turn cannot reopen its approval dock', () => {
  assert.equal(
    shouldIgnoreApprovalWhileInterrupting(
      { turnId: 'turn-stopped' },
      true,
      'turn-stopped',
    ),
    true,
  );
  assert.equal(
    shouldIgnoreApprovalWhileInterrupting(
      { turnId: 'turn-next' },
      true,
      'turn-stopped',
    ),
    false,
  );
  assert.equal(
    shouldIgnoreApprovalWhileInterrupting({}, true, 'turn-stopped'),
    true,
  );
  assert.equal(
    shouldIgnoreApprovalWhileInterrupting({ turnId: 'turn-stopped' }, false),
    false,
  );
});

test('late content events from a stopped Turn are ignored but its terminal event is kept', () => {
  const stoppedTurns = new Set(['turn-stopped']);
  assert.equal(
    shouldIgnoreStreamEventWhileInterrupting(
      { type: 'event', turnId: 'turn-stopped', event: { type: 'assistant_reasoning_delta' } },
      false,
      null,
      stoppedTurns,
    ),
    true,
  );
  assert.equal(
    shouldIgnoreStreamEventWhileInterrupting(
      { type: 'event', turnId: 'turn-stopped', event: { type: 'tool_finished' } },
      false,
      null,
      stoppedTurns,
    ),
    true,
  );
  assert.equal(
    shouldIgnoreStreamEventWhileInterrupting(
      { type: 'event', turnId: 'turn-stopped', event: { type: 'turn_finished' } },
      false,
      null,
      stoppedTurns,
    ),
    false,
  );
  assert.equal(
    shouldIgnoreStreamEventWhileInterrupting(
      { type: 'event', event: { type: 'assistant_text_delta' } },
      true,
      'turn-stopped',
    ),
    true,
  );
});

test('steer events start a new assistant segment instead of appending to the steer message', () => {
  let messages = aggregateStreamEvent([], {
    type: 'event',
    turnId: 'turn-steer',
    event: { type: 'turn_started' },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-steer',
    event: { type: 'assistant_text_delta', delta: '原始回答' },
  });
  messages = [
    ...messages,
    {
      id: 'steer-1',
      role: 'user',
      isSteer: true,
      steerTurnId: 'turn-steer',
      text: '1',
      blocks: [{ type: 'text', content: '1' }],
    },
  ];

  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-steer',
    event: { type: 'assistant_text_delta', delta: '纠偏后的回答' },
  });

  assert.equal(messages[1].role, 'user');
  assert.equal(messages[1].text, '1');
  assert.equal(messages[1].blocks[0].content, '1');
  assert.equal(messages[2].role, 'assistant');
  assert.equal(messages[2].text, '纠偏后的回答');
});

test('ThreadItem tool projections update one stable tool block', () => {
  let messages = aggregateStreamEvent([], {
    type: 'event',
    threadId: 'thread-main',
    turnId: 'turn-items',
    event: { type: 'turn_started' },
  });

  messages = aggregateStreamEvent(messages, {
    type: 'event',
    threadId: 'thread-main',
    turnId: 'turn-items',
    items: [
      {
        type: 'toolCall',
        id: 'call-items-1',
        name: 'shell',
        arguments: { command: 'pwd' },
        status: 'inProgress',
      },
    ],
    event: { type: 'tool_started' },
  });

  messages = aggregateStreamEvent(messages, {
    type: 'event',
    threadId: 'thread-main',
    turnId: 'turn-items',
    items: [
      {
        type: 'toolCall',
        id: 'call-items-1',
        name: 'shell',
        arguments: { command: 'pwd' },
        status: 'completed',
        output: 'C:\\workspace',
      },
    ],
    event: { type: 'tool_finished' },
  });

  assert.equal(messages[0].blocks.length, 1);
  assert.equal(messages[0].blocks[0].call_id, 'call-items-1');
  assert.equal(messages[0].blocks[0].status, 'completed');
  assert.equal(messages[0].blocks[0].output, 'C:\\workspace');
});

test('ThreadItem contextCompaction projections create compaction notice block', () => {
  let messages = aggregateStreamEvent([], {
    type: 'event',
    threadId: 'thread-main',
    turnId: 'turn-compact',
    event: { type: 'turn_started' },
  });

  messages = aggregateStreamEvent(messages, {
    type: 'event',
    threadId: 'thread-main',
    turnId: 'turn-compact',
    items: [
      {
        type: 'contextCompaction',
        id: 'compaction-1',
        status: 'completed',
      },
    ],
    event: { type: 'context_compaction_finished' },
  });

  assert.equal(messages[0].blocks.length, 1);
  assert.equal(messages[0].blocks[0].type, 'compaction');
  assert.equal(messages[0].blocks[0].id, 'compaction-1');
  assert.equal(messages[0].blocks[0].status, 'completed');
});

test('adjacent compactions are grouped while preserving Turn details', () => {
  const grouped = groupCompactionBlocks([
    { type: 'thinking', content: 'Inspect' },
    { type: 'compaction', id: 'compact-1', status: 'completed', turnId: 'turn-1' },
    { type: 'compaction', id: 'compact-2', status: 'completed', turnId: 'turn-1' },
    { type: 'tool', id: 'call-1', status: 'completed' },
    { type: 'compaction', id: 'compact-3', status: 'completed', turnId: 'turn-2' },
  ]);

  assert.equal(grouped[1].type, 'compactionGroup');
  assert.equal(grouped[1].items.length, 2);
  assert.equal(grouped[1].items[1].turnId, 'turn-1');
  assert.equal(grouped[3].type, 'compactionGroup');
  assert.equal(grouped[3].items[0].id, 'compact-3');
});

test('compaction lifecycle completion updates one block and keeps its Turn id', () => {
  let messages = aggregateStreamEvent([], {
    type: 'event',
    turnId: 'turn-compact-life',
    event: { type: 'turn_started' },
  });
  messages = aggregateItemLifecycle(messages, {
    type: 'notification',
    method: 'item/started',
    data: {
      turnId: 'turn-compact-life',
      item: {
        type: 'contextCompaction',
        id: 'compact-life',
        status: 'inProgress',
      },
    },
  });
  messages = aggregateItemLifecycle(messages, {
    type: 'notification',
    method: 'item/completed',
    data: {
      turnId: 'turn-compact-life',
      item: {
        type: 'contextCompaction',
        id: 'compact-life',
        status: 'completed',
      },
    },
  });

  assert.equal(messages[0].blocks.length, 1);
  assert.equal(messages[0].blocks[0].status, 'completed');
  assert.equal(messages[0].blocks[0].turnId, 'turn-compact-life');
});

test('legacy compaction events with different checkpoints remain distinct', () => {
  let messages = aggregateStreamEvent([], {
    type: 'event',
    turnId: 'turn-legacy-compact',
    event: { type: 'turn_started' },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-legacy-compact',
    event: { type: 'context_compaction_finished', checkpoint_seq: 4 },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-legacy-compact',
    event: { type: 'context_compaction_finished', checkpoint_seq: 5 },
  });

  assert.equal(messages[0].blocks.length, 2);
  assert.equal(messages[0].blocks[1].id, 'compaction_5');
});

test('ThreadItem reasoning projections synchronize thinking block', () => {
  let messages = aggregateStreamEvent([], {
    type: 'event',
    threadId: 'thread-main',
    turnId: 'turn-reason',
    event: { type: 'turn_started' },
  });

  messages = aggregateStreamEvent(messages, {
    type: 'event',
    threadId: 'thread-main',
    turnId: 'turn-reason',
    items: [
      {
        type: 'reasoning',
        id: 'reason-1',
        text: 'System architecture analysis and design steps...',
      },
    ],
    event: { type: 'model_responded' },
  });

  assert.equal(messages[0].thinking, 'System architecture analysis and design steps...');
  assert.equal(messages[0].blocks.length, 1);
  assert.equal(messages[0].blocks[0].type, 'thinking');
  assert.equal(messages[0].blocks[0].content, 'System architecture analysis and design steps...');
});

test('reasoning segments keep their identity across tools and projected replay', () => {
  let messages = aggregateStreamEvent([], {
    type: 'event',
    turnId: 'turn-reasoning-segments',
    itemId: 'turn-reasoning-segments:model:1',
    event: { type: 'turn_started' },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-reasoning-segments',
    itemId: 'turn-reasoning-segments:model:1',
    event: { type: 'assistant_reasoning_delta', delta: 'First model step.' },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-reasoning-segments',
    event: {
      type: 'tool_started',
      tool: 'shell',
      call_id: 'call-reasoning-segments',
      args: { command: 'pwd' },
    },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-reasoning-segments',
    itemId: 'turn-reasoning-segments:model:2',
    event: { type: 'assistant_reasoning_delta', delta: 'Second model step.' },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-reasoning-segments',
    itemId: 'turn-reasoning-segments:model:2',
    items: [
      {
        type: 'reasoning',
        id: 'turn-reasoning-segments:model:2:reasoning',
        text: 'Second model step.',
      },
    ],
    event: { type: 'model_responded' },
  });

  assert.deepEqual(
    messages[0].blocks.map((block) => [block.type, block.id, block.content]),
    [
      ['thinking', 'turn-reasoning-segments:model:1:reasoning', 'First model step.'],
      ['tool', 'call-reasoning-segments', undefined],
      ['thinking', 'turn-reasoning-segments:model:2:reasoning', 'Second model step.'],
    ],
  );
});

test('legacy reasoning deltas create a new block after a tool boundary', () => {
  let messages = aggregateStreamEvent([], {
    type: 'event',
    turnId: 'turn-legacy-reasoning-segments',
    event: { type: 'turn_started' },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-legacy-reasoning-segments',
    event: { type: 'assistant_reasoning_delta', delta: 'Before tool.' },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-legacy-reasoning-segments',
    event: {
      type: 'tool_started',
      tool: 'shell',
      call_id: 'call-legacy-reasoning-segments',
    },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-legacy-reasoning-segments',
    event: { type: 'assistant_reasoning_delta', delta: 'After tool.' },
  });

  assert.deepEqual(
    messages[0].blocks.map((block) => [block.type, block.content]),
    [
      ['thinking', 'Before tool.'],
      ['tool', undefined],
      ['thinking', 'After tool.'],
    ],
  );
});

test('approval results stay attached to the matching tool block', () => {
  const messages = [{
    role: 'assistant',
    turnId: 'turn-approval-result',
    blocks: [
      { type: 'tool', call_id: 'call-1', name: 'shell', status: 'running' },
      { type: 'tool', call_id: 'call-2', name: 'shell', status: 'running' },
    ],
  }];

  const next = mergeApprovalEvent(messages, {
    phase: 'resolved',
    requestId: 'approval-1',
    callId: 'call-1',
    outcome: 'approved',
    grantScope: 'once',
  });

  assert.equal(next[0].blocks[0].approval.state, 'approved');
  assert.equal(next[0].blocks[0].approval.grantScope, 'once');
  assert.equal(next[0].blocks[1].approval, undefined);
});

test('approval identity keeps reused request ids distinct by tool call', () => {
  assert.notEqual(
    approvalIdentity({
      requestId: 'approval-reused',
      data: { projectId: 'project', threadId: 'thread', turnId: 'turn', callId: 'call-1' },
    }),
    approvalIdentity({
      requestId: 'approval-reused',
      data: { projectId: 'project', threadId: 'thread', turnId: 'turn', callId: 'call-2' },
    }),
  );
});

test('approval call identity wins over a colliding request id', () => {
  const messages = [{
    role: 'assistant',
    turnId: 'turn-approval-collision',
    blocks: [
      {
        type: 'tool',
        call_id: 'call-1',
        name: 'shell',
        approval: { requestId: 'approval-reused' },
      },
      { type: 'tool', call_id: 'call-2', name: 'shell' },
    ],
  }];

  const next = mergeApprovalEvent(messages, {
    phase: 'resolved',
    requestId: 'approval-reused',
    callId: 'call-2',
    outcome: 'denied',
  });

  assert.equal(next[0].blocks[0].approval.state, undefined);
  assert.equal(next[0].blocks[1].approval.state, 'denied');
});

test('dedicated ThreadItem lifecycle notifications reconcile without duplicate tool blocks', () => {
  let messages = aggregateStreamEvent([], {
    type: 'event',
    turnId: 'turn-earlier',
    event: { type: 'turn_started' },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-later',
    event: { type: 'turn_started' },
  });
  messages = aggregateItemLifecycle(messages, {
    type: 'notification',
    method: 'item/started',
    data: {
      threadId: 'thread-main',
      turnId: 'turn-earlier',
      item: {
        type: 'toolCall',
        id: 'call-life',
        name: 'shell',
        arguments: { command: 'pwd' },
        status: 'inProgress',
      },
    },
  });
  messages = aggregateItemLifecycle(messages, {
    type: 'notification',
    method: 'item/completed',
    data: {
      threadId: 'thread-main',
      turnId: 'turn-earlier',
      item: {
        type: 'toolCall',
        id: 'call-life',
        name: 'shell',
        arguments: { command: 'pwd' },
        status: 'completed',
        output: 'C:\\workspace',
      },
    },
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].blocks.length, 1);
  assert.equal(messages[0].blocks[0].status, 'completed');
  assert.equal(messages[0].blocks[0].output, 'C:\\workspace');
  assert.equal(messages[1].blocks.length, 0);
});

test('dedicated tool start settles the preceding reasoning block', () => {
  let messages = aggregateStreamEvent([], {
    type: 'event',
    turnId: 'turn-reasoning-tool',
    event: { type: 'turn_started' },
  });
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-reasoning-tool',
    event: { type: 'assistant_reasoning_delta', delta: 'Inspect the repository first.' },
  });

  messages = aggregateItemLifecycle(messages, {
    type: 'notification',
    method: 'item/started',
    data: {
      threadId: 'thread-main',
      turnId: 'turn-reasoning-tool',
      item: {
        type: 'toolCall',
        id: 'call-reasoning-tool',
        name: 'shell',
        arguments: { command: 'git status' },
        status: 'inProgress',
      },
    },
  });

  assert.equal(messages[0].blocks[0].type, 'thinking');
  assert.equal(messages[0].blocks[0].isStreaming, false);
  assert.equal(messages[0].blocks[1].type, 'tool');
});

test('thread item history hydrates existing assistant turns and preserves item identity', () => {
  const messages = aggregateThreadItems(
    [
      { id: 'user-1', role: 'user', text: 'Inspect', blocks: [{ type: 'text', content: 'Inspect' }] },
      {
        id: 'assistant-1',
        role: 'assistant',
        turnId: 'turn-history',
        text: 'Done',
        blocks: [{ type: 'text', content: 'Done' }],
      },
    ],
    [
      {
        turnId: 'turn-history',
        item: {
          type: 'toolCall',
          id: 'call-history',
          name: 'shell',
          arguments: { command: 'pwd' },
          status: 'completed',
          outcome: 'deferred',
          output: 'C:\\workspace',
        },
      },
    ],
  );

  assert.equal(messages.length, 2);
  assert.equal(messages[1].blocks[1].id, 'call-history');
  assert.equal(messages[1].blocks[1].outcome, 'deferred');
});

test('thread item history preserves unknown tool outcomes for the UI boundary', () => {
  const messages = aggregateThreadItems(
    [{ role: 'assistant', turnId: 'turn-unknown-outcome', blocks: [] }],
    [{
      turnId: 'turn-unknown-outcome',
      item: {
        type: 'toolCall',
        id: 'call-unknown-outcome',
        name: 'shell',
        status: 'failed',
        outcome: 'server_added_state',
      },
    }],
  );

  assert.equal(messages[0].blocks[0].outcome, 'server_added_state');
});

test('thread item history keeps intermediate reasoning and maps tools to each response', () => {
  const messages = aggregateThreadItems(
    [
      { id: 'user-1', role: 'user', text: 'Inspect', blocks: [{ type: 'text', content: 'Inspect' }] },
      {
        id: 'assistant-1',
        role: 'assistant',
        text: '',
        thinking: 'First thought',
        toolCallIds: ['call-1'],
        blocks: [{ type: 'thinking', content: 'First thought' }],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        text: 'Intermediate result',
        thinking: 'Second thought',
        toolCallIds: ['call-2'],
        blocks: [
          { type: 'thinking', content: 'Second thought' },
          { type: 'text', content: 'Intermediate result' },
        ],
      },
    ],
    [
      {
        turnId: 'turn-history',
        item: {
          type: 'toolCall', id: 'call-1', name: 'read_file', status: 'completed', output: 'one',
        },
      },
      {
        turnId: 'turn-history',
        item: { type: 'reasoning', id: 'assistant-3:reasoning', text: 'Third thought' },
      },
      {
        turnId: 'turn-history',
        item: {
          type: 'toolCall', id: 'call-2', name: 'apply_patch', status: 'completed', output: 'two',
        },
      },
    ],
  );

  assert.equal(messages[1].blocks[1].id, 'call-1');
  assert.equal(messages[2].blocks[2].id, 'call-2');
  assert.equal(messages[1].blocks.some((block) => block.content === 'Third thought'), true);
  assert.equal(messages[2].blocks.some((block) => block.content === 'Second thought'), true);
});

test('history replays persisted workflow and skill boundaries in item order', () => {
  const messages = restorePersistedTurnPresentation([
    { id: 'user-1', role: 'user', turnId: 'turn-history', text: 'Inspect' },
    {
      id: 'assistant-1',
      role: 'assistant',
      turnId: 'turn-history',
      thinking: 'First thought',
      blocks: [
        { type: 'thinking', id: 'thinking-1', content: 'First thought' },
        { type: 'tool', id: 'tool-1', name: 'read_file' },
      ],
    },
    {
      id: 'assistant-2',
      role: 'assistant',
      turnId: 'turn-history',
      thinking: 'Second thought',
      blocks: [
        { type: 'thinking', id: 'thinking-2', content: 'Second thought' },
        { type: 'tool', id: 'tool-2', name: 'shell' },
      ],
    },
  ], [
    {
      turnId: 'turn-history',
      item: { type: 'reasoning', id: 'assistant-1:reasoning', segmentId: 'assistant-1', text: 'First thought' },
    },
    {
      turnId: 'turn-history',
      item: { type: 'toolCall', id: 'tool-1', name: 'read_file', status: 'completed' },
    },
    {
      turnId: 'turn-history',
      item: { type: 'reasoning', id: 'assistant-2:reasoning', segmentId: 'assistant-2', text: 'Second thought' },
    },
    {
      turnId: 'turn-history',
      item: { type: 'toolCall', id: 'tool-2', name: 'shell', status: 'completed' },
    },
  ], [
    {
      turnId: 'turn-history',
      workflow: { kind: 'skill_group', id: 'knowledge-work', mode: 'auto' },
      activities: [
        { kind: 'skill_group_activated', afterAssistantSegments: 0, group: 'knowledge-work' },
        { kind: 'skills_loaded', afterAssistantSegments: 1, phase: 'loaded', skills: ['knowledge-work:product-management'] },
      ],
    },
  ]);

  assert.equal(messages.length, 2);
  assert.equal(messages[1].id, 'assistant-1');
  assert.equal(messages[1].thinking, 'First thought\n\nSecond thought');
  assert.deepEqual(messages[1].blocks.map((block) => block.id), [
    'workflow_turn-history',
    'assistant-1:reasoning',
    'skills_turn-history',
    'tool-1',
    'assistant-2:reasoning',
    'tool-2',
  ]);
});

test('history filtering removes empty assistant placeholders but keeps visible blocks', () => {
  const messages = filterEmptyMessages([
    { role: 'user', text: 'Inspect' },
    { role: 'assistant', text: '', thinking: '', blocks: [] },
    { role: 'assistant', text: '', thinking: '', blocks: [{ type: 'text', content: 'Done' }] },
    { role: 'assistant', text: '', thinking: '', blocks: [{ type: 'tool', name: 'shell' }] },
    { role: 'assistant', text: '', thinking: '', blocks: [{ type: 'text', content: '   ' }] },
    { role: 'tool', text: 'internal output', blocks: [] },
    { role: 'system', text: 'internal state', blocks: [] },
  ]);

  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[1].blocks[0].content, 'Done');
  assert.equal(messages[2].blocks[0].type, 'tool');
});
