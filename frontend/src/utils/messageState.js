/**
 * Pure helper functions for message streaming aggregation and thread isolation.
 */

/**
 * Validates whether an incoming event belongs to the active thread.
 */
export function shouldAcceptEventForThread(
  eventData,
  currentThreadId,
  currentProjectId = null,
) {
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
  const eventProjectId =
    eventData.projectId ||
    eventData.project_id ||
    notificationData.projectId ||
    notificationData.project_id ||
    approvalData.projectId ||
    approvalData.project_id;
  if (eventThreadId && eventThreadId !== currentThreadId) {
    return false;
  }
  if (eventProjectId && currentProjectId && eventProjectId !== currentProjectId) {
    return false;
  }
  return true;
}

function projectedStatus(status) {
  if (status === 'failed') return 'failed';
  if (status === 'completed') return 'completed';
  return 'running';
}

function mergeProjectedToolItems(messages, items, targetIndex = messages.length - 1) {
  if (messages.length === 0 || items.length === 0) return messages;
  const copy = [...messages];
  const last = { ...copy[targetIndex] };
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
  copy[targetIndex] = last;
  return copy;
}

function findToolTargetIndex(messages, item, fallbackIndex) {
  const callId = item.id || item.call_id;
  if (!callId) return fallbackIndex;
  const persistedIndex = messages.findIndex(
    (message) => message.role === 'assistant' && message.toolCallIds?.includes(callId),
  );
  if (persistedIndex !== -1) return persistedIndex;
  const existingIndex = messages.findIndex(
    (message) => message.role === 'assistant'
      && (message.blocks || []).some(
        (block) => block.type === 'tool' && block.call_id === callId,
      ),
  );
  return existingIndex === -1 ? fallbackIndex : existingIndex;
}

function mergeProjectedCompactionItems(messages, items, targetIndex = messages.length - 1) {
  if (messages.length === 0 || items.length === 0) return messages;
  const copy = [...messages];
  const last = { ...copy[targetIndex] };
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
  copy[targetIndex] = last;
  return copy;
}

function mergeProjectedReasoningItems(messages, items, targetIndex = messages.length - 1) {
  if (messages.length === 0 || items.length === 0) return messages;
  const copy = [...messages];
  const last = { ...copy[targetIndex] };
  const blocks = [...(last.blocks || [])];

  for (const item of items) {
    if (!item.text) continue;
    const existingIndex = blocks.findIndex(
      (b) => b.type === 'thinking' && (!item.id || b.id === item.id),
    );
    if (existingIndex === -1) {
      blocks.push({
        type: 'thinking',
        id: item.id,
        content: item.text,
        isStreaming: false,
      });
    } else if ((blocks[existingIndex].content || '').length < item.text.length) {
      blocks[existingIndex] = {
        ...blocks[existingIndex],
        content: item.text,
      };
    }
  }

  last.thinking = blocks
    .filter((block) => block.type === 'thinking')
    .map((block) => block.content)
    .join('\n\n');
  last.blocks = blocks;
  copy[targetIndex] = last;
  return copy;
}

function findTurnAssistantIndex(messages, turnId) {
  if (!turnId) return -1;

  // A steer is a user-visible boundary inside the same engine turn. Once a
  // steer has been rendered, the next engine event must start a new assistant
  // segment instead of being appended to the steer bubble.
  let crossedLatestSteer = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.isSteer && message.steerTurnId === turnId) {
      crossedLatestSteer = true;
      continue;
    }
    if (
      !crossedLatestSteer &&
      message.role === 'assistant' &&
      (message.turnId === turnId || message.id === `turn_${turnId}`)
    ) {
      return index;
    }
  }
  return -1;
}

function ensureTurnAssistant(messages, turnId) {
  const existing = findTurnAssistantIndex(messages, turnId);
  if (existing !== -1) return messages;

  const baseId = `turn_${turnId}`;
  const hasBaseId = messages.some((message) => message.id === baseId);
  const id = hasBaseId
    ? `${baseId}_segment_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    : baseId;
  return [
    ...messages,
    {
      id,
      role: 'assistant',
      turnId,
      text: '',
      thinking: '',
      tools: [],
      blocks: [],
    },
  ];
}

/**
 * Apply a dedicated App Server item lifecycle notification.
 *
 * Text and reasoning deltas remain the streaming source for their respective
 * blocks. Tool and compaction items are reconciled here because their
 * authoritative completed projection can arrive outside turn/event.
 */
export function aggregateItemLifecycle(messages, data) {
  if (!data || data.type !== 'notification') return messages;
  if (data.method !== 'item/started' && data.method !== 'item/completed') return messages;

  const payload = data.data || {};
  const item = payload.item;
  if (!item) return messages;

  const turnId = payload.turnId || payload.turn_id || 'unknown';
  let next = ensureTurnAssistant(messages, turnId);
  const targetIndex = findTurnAssistantIndex(next, turnId);
  if (item.type === 'toolCall' || item.type === 'tool_call') {
    return mergeProjectedToolItems(next, [item], targetIndex);
  }
  if (item.type === 'contextCompaction' || item.type === 'context_compaction') {
    return mergeProjectedCompactionItems(next, [item], targetIndex);
  }
  return next;
}

/**
 * Hydrate a message projection with cursor results from thread/items/list.
 */
export function aggregateThreadItems(messages, entries) {
  let next = messages;
  const targetByTurn = new Map();
  const turnOrder = [];
  for (const entry of entries || []) {
    const turnId = entry.turnId || entry.turn_id || 'unknown';
    if (!targetByTurn.has(turnId)) {
      targetByTurn.set(turnId, null);
      turnOrder.push(turnId);
    }
  }
  const assistantIndexes = next
    .map((message, index) => (message.role === 'assistant' ? index : -1))
    .filter((index) => index !== -1);
  turnOrder.forEach((turnId, index) => {
    const existingIndex = assistantIndexes[index];
    if (existingIndex !== undefined) {
      targetByTurn.set(turnId, existingIndex);
    } else {
      next = ensureTurnAssistant(next, turnId);
      targetByTurn.set(turnId, next.length - 1);
    }
  });

  for (const entry of entries || []) {
    const turnId = entry.turnId || entry.turn_id || 'unknown';
    const item = entry.item || {};
    if (!item.type || item.type === 'userMessage') continue;
    const targetIndex = targetByTurn.get(turnId) ?? next.length - 1;
    if (item.type === 'toolCall' || item.type === 'tool_call') {
      next = mergeProjectedToolItems(
        next,
        [item],
        findToolTargetIndex(next, item, targetIndex),
      );
    } else if (item.type === 'contextCompaction' || item.type === 'context_compaction') {
      next = mergeProjectedCompactionItems(next, [item], targetIndex);
    } else if (item.type === 'reasoning') {
      const alreadyHydrated = next.some((message) =>
        (message.blocks || []).some(
          (block) => block.type === 'thinking' && block.content === item.text,
        ),
      );
      if (!alreadyHydrated) next = mergeProjectedReasoningItems(next, [item], targetIndex);
    } else if (item.type === 'agentMessage' && item.text) {
      const alreadyHydrated = next.some((message) =>
        (message.blocks || []).some(
          (block) => block.type === 'text' && block.content === item.text,
        ),
      );
      if (alreadyHydrated) continue;
      const copy = [...next];
      const last = { ...copy[targetIndex] };
      const blocks = [...(last.blocks || [])];
      const textBlock = blocks.findIndex(
        (block) => block.type === 'text' && (!item.id || block.id === item.id),
      );
      if (textBlock === -1) blocks.push({ type: 'text', id: item.id, content: item.text });
      else blocks[textBlock] = { ...blocks[textBlock], content: item.text };
      last.text = item.text;
      last.blocks = blocks;
      copy[targetIndex] = last;
      next = copy;
    }
  }
  return next;
}

/**
 * Remove history placeholders that have no visible content after item
 * hydration. Empty assistant messages are useful while a live turn is being
 * assembled, but rendering them after a settled history only produces a bare
 * avatar with no message body.
 */
export function filterEmptyMessages(messages) {
  return (messages || []).filter((message) => {
    if (message.messageKind === 'goal_verification') return true;
    if (message.role !== 'user' && message.role !== 'assistant') return false;
    if (message.role !== 'assistant') {
      return Boolean(
        message.text?.trim?.() ||
          message.images?.length ||
          message.referencedFiles?.length ||
          message.isGoal ||
          message.isSteer,
      );
    }

    const hasBlock = (message.blocks || []).some((block) => {
      if (!block) return false;
      if (block.type === 'text' || block.type === 'thinking') {
        return Boolean(block.content?.trim?.());
      }
      return block.type === 'tool' || block.type === 'compaction';
    });
    return Boolean(
      message.text?.trim?.() ||
        message.thinking?.trim?.() ||
        message.tools?.length ||
        hasBlock,
    );
  });
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
      const turnMessageId = 'turn_' + (data.turnId || '');
      if (data.turnId && messages.some((message) => message.id === turnMessageId)) {
        return messages;
      }
      return [
        ...messages,
        {
          id: 'turn_' + (data.turnId || Date.now()),
          role: 'assistant',
          turnId: data.turnId,
          text: '',
          thinking: '',
          tools: [],
          blocks: [],
        },
      ];
    }

    let targetIndex = data.turnId
      ? findTurnAssistantIndex(messages, data.turnId)
      : messages.length - 1;
    if (targetIndex === -1 && data.turnId) {
      messages = ensureTurnAssistant(messages, data.turnId);
      targetIndex = findTurnAssistantIndex(messages, data.turnId);
    }
    if (messages.length === 0 || targetIndex === -1) return messages;

    const projectedTools = (data.items || []).filter(
      (item) => item.type === 'toolCall' || item.type === 'tool_call'
    );
    if (projectedTools.length > 0) {
      messages = mergeProjectedToolItems(messages, projectedTools, targetIndex);
      if (type === 'tool_started' || type === 'tool_finished') return messages;
    }

    const projectedCompactions = (data.items || []).filter(
      (item) =>
        item.type === 'contextCompaction' || item.type === 'context_compaction'
    );
    if (projectedCompactions.length > 0) {
      messages = mergeProjectedCompactionItems(messages, projectedCompactions, targetIndex);
    }

    const projectedReasonings = (data.items || []).filter(
      (item) => item.type === 'reasoning'
    );
    if (projectedReasonings.length > 0) {
      messages = mergeProjectedReasoningItems(messages, projectedReasonings, targetIndex);
    }

    const copy = [...messages];
    const last = { ...copy[targetIndex] };
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
        copy[targetIndex] = last;
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
      copy[targetIndex] = last;
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
      copy[targetIndex] = last;
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
      copy[targetIndex] = last;
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
      copy[targetIndex] = last;
      return copy;
    }

    if (type === 'turn_finished' || type === 'run_finished' || type === 'run_failed') {
      last.blocks = blocks.map((b) => {
        if (b.type === 'thinking') return { ...b, isStreaming: false };
        if (b.type === 'tool' && b.status === 'running') return { ...b, status: 'completed' };
        return b;
      });
      copy[targetIndex] = last;
      return copy;
    }
  }

  return messages;
}
