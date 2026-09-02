import test from 'node:test';
import assert from 'node:assert/strict';

// Helper simulating stream block reduction
function reduceStreamEvent(messages, evt) {
  if (evt.type === 'turn_started') {
    return [
      ...messages,
      { role: 'assistant', text: '', thinking: '', tools: [], blocks: [] },
    ];
  }

  if (messages.length === 0) return messages;
  const copy = [...messages];
  const last = { ...copy[copy.length - 1] };
  const blocks = [...(last.blocks || [])];

  if (evt.type === 'assistant_reasoning_delta') {
    const lastBlock = blocks[blocks.length - 1];
    if (!lastBlock || lastBlock.type !== 'thinking') {
      blocks.push({
        type: 'thinking',
        content: evt.delta || '',
        isStreaming: true,
      });
    } else {
      blocks[blocks.length - 1] = {
        ...lastBlock,
        content: (lastBlock.content || '') + (evt.delta || ''),
        isStreaming: true,
      };
    }
    last.blocks = blocks;
    last.thinking = (last.thinking || '') + (evt.delta || '');
  } else if (evt.type === 'assistant_text_delta') {
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].type === 'thinking') {
        blocks[i] = { ...blocks[i], isStreaming: false };
      }
    }
    const lastBlock = blocks[blocks.length - 1];
    if (!lastBlock || lastBlock.type !== 'text') {
      blocks.push({
        type: 'text',
        content: evt.delta || '',
      });
    } else {
      blocks[blocks.length - 1] = {
        ...lastBlock,
        content: (lastBlock.content || '') + (evt.delta || ''),
      };
    }
    last.blocks = blocks;
    last.text = (last.text || '') + (evt.delta || '');
  } else if (evt.type === 'tool_started') {
    blocks.push({
      type: 'tool',
      id: evt.id || `tool_${Date.now()}`,
      name: evt.name || 'tool',
      arguments: evt.call?.arguments || {},
      status: 'running',
    });
    last.blocks = blocks;
  } else if (evt.type === 'tool_finished') {
    last.blocks = blocks.map((b) => {
      if (b.type === 'tool' && (b.name === evt.name || b.id === evt.id)) {
        return {
          ...b,
          status: evt.is_error ? 'failed' : 'completed',
          output: evt.content || '',
        };
      }
      return b;
    });
  }

  copy[copy.length - 1] = last;
  return copy;
}

test('message stream aggregation cleanly sequences thinking, text, and tools', () => {
  let msgs = [];

  // 1. turn_started
  msgs = reduceStreamEvent(msgs, { type: 'turn_started' });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, 'assistant');

  // 2. reasoning delta
  msgs = reduceStreamEvent(msgs, { type: 'assistant_reasoning_delta', delta: 'Think step 1.' });
  msgs = reduceStreamEvent(msgs, { type: 'assistant_reasoning_delta', delta: ' Step 2.' });
  assert.equal(msgs[0].thinking, 'Think step 1. Step 2.');
  assert.equal(msgs[0].blocks[0].type, 'thinking');
  assert.equal(msgs[0].blocks[0].isStreaming, true);

  // 3. text delta (closes thinking isStreaming)
  msgs = reduceStreamEvent(msgs, { type: 'assistant_text_delta', delta: 'Hello world.' });
  assert.equal(msgs[0].blocks[0].isStreaming, false);
  assert.equal(msgs[0].blocks[1].type, 'text');
  assert.equal(msgs[0].text, 'Hello world.');

  // 4. tool execution
  msgs = reduceStreamEvent(msgs, {
    type: 'tool_started',
    id: 't-1',
    name: 'shell',
    call: { arguments: { command: 'cargo test' } },
  });
  assert.equal(msgs[0].blocks.length, 3);
  assert.equal(msgs[0].blocks[2].status, 'running');

  // 5. tool finished
  msgs = reduceStreamEvent(msgs, {
    type: 'tool_finished',
    id: 't-1',
    name: 'shell',
    content: 'All tests passed',
    is_error: false,
  });
  assert.equal(msgs[0].blocks[2].status, 'completed');
  assert.equal(msgs[0].blocks[2].output, 'All tests passed');
});

test('thread isolation rejects foreign thread events', () => {
  const currentThread = 'thread-main';
  const incomingEvents = [
    { threadId: 'thread-main', event: { type: 'assistant_text_delta', delta: 'A' } },
    { threadId: 'thread-other', event: { type: 'assistant_text_delta', delta: 'B' } },
    { threadId: 'thread-main', event: { type: 'assistant_text_delta', delta: 'C' } },
  ];

  let buffer = '';
  for (const item of incomingEvents) {
    if (item.threadId === currentThread) {
      buffer += item.event.delta;
    }
  }

  assert.equal(buffer, 'AC');
});
