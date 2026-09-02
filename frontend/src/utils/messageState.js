/**
 * Pure helper functions for message streaming aggregation and thread isolation.
 */

/**
 * Validates whether an incoming event belongs to the active thread.
 */
export function shouldAcceptEventForThread(eventData, currentThreadId) {
  if (!eventData) return false;
  const eventThreadId = eventData.threadId || eventData.thread_id;
  if (eventThreadId && eventThreadId !== currentThreadId) {
    return false;
  }
  return true;
}

/**
 * Pure reducer function to update messages array based on engine stream events.
 */
export function aggregateStreamEvent(messages, data) {
  if (!data) return messages;

  // Handle typed event
  if (data.type === 'event') {
    const evt = data.event || {};
    const type = evt.type;

    if (type === 'turn_started') {
      return [
        ...messages,
        {
          id: 'turn_' + (data.turnId || Date.now()),
          role: 'assistant',
          text: '',
          thinking: '',
          tools: [],
          blocks: [],
        },
      ];
    }

    if (messages.length === 0) return messages;
    const copy = [...messages];
    const last = { ...copy[copy.length - 1] };
    const blocks = [...(last.blocks || [])];

    if (type === 'assistant_reasoning_delta') {
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
      last.thinking = (last.thinking || '') + (evt.delta || '');
      last.blocks = blocks;
      copy[copy.length - 1] = last;
      return copy;
    }

    if (type === 'assistant_text_delta') {
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && lastBlock.type === 'thinking') {
        blocks[blocks.length - 1] = { ...lastBlock, isStreaming: false };
      }

      const activeText = blocks[blocks.length - 1];
      if (!activeText || activeText.type !== 'text') {
        blocks.push({
          type: 'text',
          content: evt.delta || '',
        });
      } else {
        blocks[blocks.length - 1] = {
          ...activeText,
          content: (activeText.content || '') + (evt.delta || ''),
        };
      }
      last.text = (last.text || '') + (evt.delta || '');
      last.blocks = blocks;
      copy[copy.length - 1] = last;
      return copy;
    }

    if (type === 'tool_started') {
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && lastBlock.type === 'thinking') {
        blocks[blocks.length - 1] = { ...lastBlock, isStreaming: false };
      }
      blocks.push({
        type: 'tool',
        toolName: evt.tool || evt.name || '',
        args: evt.args || evt.parameters || {},
        status: 'running',
        call_id: evt.call_id || evt.id || '',
      });
      last.blocks = blocks;
      copy[copy.length - 1] = last;
      return copy;
    }

    if (type === 'tool_finished') {
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].type === 'tool' && (blocks[i].call_id === evt.call_id || blocks[i].status === 'running')) {
          blocks[i] = {
            ...blocks[i],
            status: evt.error ? 'failed' : 'completed',
            output: evt.output || evt.result || '',
            error: evt.error || null,
          };
          break;
        }
      }
      last.blocks = blocks;
      copy[copy.length - 1] = last;
      return copy;
    }

    if (type === 'turn_finished' || type === 'run_finished' || type === 'run_failed') {
      last.blocks = blocks.map((b) => {
        if (b.type === 'thinking') return { ...b, isStreaming: false };
        if (b.type === 'tool' && b.status === 'running') return { ...b, status: 'completed' };
        return b;
      });
      copy[copy.length - 1] = last;
      return copy;
    }
  }

  return messages;
}
