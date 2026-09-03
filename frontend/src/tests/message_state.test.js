import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateStreamEvent, shouldAcceptEventForThread } from '../utils/messageState.js';

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
    event: { type: 'tool_finished', call_id: 'call-1', output: 'file1.txt\nfile2.txt' },
  });
  assert.equal(messages[0].blocks[2].status, 'completed');
  assert.equal(messages[0].blocks[2].output, 'file1.txt\nfile2.txt');

  // 6. Turn finished
  messages = aggregateStreamEvent(messages, {
    type: 'event',
    turnId: 'turn-1',
    event: { type: 'turn_finished' },
  });
  assert.equal(messages[0].blocks.every((b) => !b.isStreaming), true);
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
