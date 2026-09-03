/**
 * Pure helper functions for message streaming aggregation and thread isolation.
 */

/**
 * Validates whether an incoming event belongs to the active thread.
 */
export function shouldAcceptEventForThread(eventData, currentThreadId) {
  if (!eventData) return false;
  const notificationData = eventData.data || {};
  const approvalData = eventData.approval || {};
  const eventThreadId =
    eventData.threadId ||
    eventData.thread_id ||
    notificationData.threadId ||
    notificationData.thread_id ||
    approvalData.threadId ||
    approvalData.thread_id;
  if (eventThreadId && eventThreadId !== currentThreadId) {
    return false;
  }
  return true;
}

function projectedStatus(status) {
  if (status === 'failed') return 'failed';
  if (status === 'completed') return 'completed';
  return 'running';
}

function mergeProjectedToolItems(messages, items) {
  if (messages.length === 0 || items.length === 0) return messages;
  const copy = [...messages];
  const last = { ...copy[copy.length - 1] };
  const blocks = [...(last.blocks || [])];

  for (const item of items) {
    const callId = item.id || '';
    const existingIndex = blocks.findIndex(
      (block) => block.type === 'tool' && block.call_id === callId
    );
    const toolName = item.name || item.toolName || item.tool || 'tool';
    const nextBlock = {
      type: 'tool',
      id: callId,
      call_id: callId,
      name: toolName,
      toolName: toolName,
      arguments: item.arguments ?? {},
      args: item.arguments ?? {},
      status: projectedStatus(item.status),
      output: item.output ?? null,
      error: item.status === 'failed' ? item.output ?? 'Tool failed' : null,
    };

    if (existingIndex === -1) {
      blocks.push(nextBlock);
      continue;
    }

    blocks[existingIndex] = {
      ...blocks[existingIndex],
      ...nextBlock,
      arguments: item.arguments ?? blocks[existingIndex].arguments ?? {},
      args: item.arguments ?? blocks[existingIndex].args ?? {},
      output: item.output ?? blocks[existingIndex].output ?? null,
    };
  }

  last.blocks = blocks;
  copy[copy.length - 1] = last;
  return copy;
}

function mergeProjectedCompactionItems(messages, items) {
  if (messages.length === 0 || items.length === 0) return messages;
  const copy = [...messages];
  const last = { ...copy[copy.length - 1] };
  const blocks = [...(last.blocks || [])];

  for (const item of items) {
    const compactionId = item.id || 'compaction';
    const exists = blocks.some(
      (b) =>
        b.type === 'compaction' &&
        (b.id === compactionId || (!item.id && b.id.startsWith('compaction')))
    );
    if (!exists) {
      blocks.push({
        type: 'compaction',
        id: compactionId,
        status: item.status || 'completed',
      });
    }
  }

  last.blocks = blocks;
  copy[copy.length - 1] = last;
  return copy;
}

function mergeProjectedReasoningItems(messages, items) {
  if (messages.length === 0 || items.length === 0) return messages;
  const copy = [...messages];
  const last = { ...copy[copy.length - 1] };
  const blocks = [...(last.blocks || [])];

  for (const item of items) {
    if (!item.text) continue;
    const existingIndex = blocks.findIndex((b) => b.type === 'thinking');
    if (existingIndex === -1) {
      blocks.unshift({
        type: 'thinking',
        content: item.text,
        isStreaming: false,
      });
      last.thinking = item.text;
    } else if ((blocks[existingIndex].content || '').length < item.text.length) {
      blocks[existingIndex] = {
        ...blocks[existingIndex],
        content: item.text,
      };
      last.thinking = item.text;
    }
  }

  last.blocks = blocks;
  copy[copy.length - 1] = last;
  return copy;
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

    const projectedTools = (data.items || []).filter(
      (item) => item.type === 'toolCall' || item.type === 'tool_call'
    );
    if (projectedTools.length > 0) {
      messages = mergeProjectedToolItems(messages, projectedTools);
      if (type === 'tool_started' || type === 'tool_finished') return messages;
    }

    const projectedCompactions = (data.items || []).filter(
      (item) =>
        item.type === 'contextCompaction' || item.type === 'context_compaction'
    );
    if (projectedCompactions.length > 0) {
      messages = mergeProjectedCompactionItems(messages, projectedCompactions);
    }

    const projectedReasonings = (data.items || []).filter(
      (item) => item.type === 'reasoning'
    );
    if (projectedReasonings.length > 0) {
      messages = mergeProjectedReasoningItems(messages, projectedReasonings);
    }

    const copy = [...messages];
    const last = { ...copy[copy.length - 1] };
    const blocks = [...(last.blocks || [])];

    if (type === 'context_compaction_finished') {
      const exists = blocks.some((b) => b.type === 'compaction');
      if (!exists) {
        blocks.push({
          type: 'compaction',
          id: `compaction_${evt.checkpoint_seq || Date.now()}`,
          status: 'completed',
        });
        last.blocks = blocks;
        copy[copy.length - 1] = last;
        return copy;
      }
    }

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
      const toolName = evt.tool || evt.name || evt.toolName || '';
      blocks.push({
        type: 'tool',
        name: toolName,
        toolName: toolName,
        args: evt.args || evt.parameters || {},
        arguments: evt.args || evt.parameters || {},
        status: 'running',
        call_id: evt.call_id || evt.id || '',
      });
      last.blocks = blocks;
      copy[copy.length - 1] = last;
      return copy;
    }

    if (type === 'tool_finished') {
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (
          blocks[i].type === 'tool' &&
          (blocks[i].call_id === evt.call_id || blocks[i].status === 'running')
        ) {
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
