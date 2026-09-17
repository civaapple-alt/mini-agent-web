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
  if (eventProjectId && eventProjectId !== (currentProjectId || null)) {
    return false;
  }
  return true;
}

/**
 * Prevent an unscoped or stale Turn error from settling a newer active Turn.
 */
export function shouldSettleActiveTurnFromError(eventData, activeTurnId) {
  if (!activeTurnId) return true;
  const errorTurnId = eventData?.turnId || eventData?.turn_id;
  return Boolean(errorTurnId && errorTurnId === activeTurnId);
}

/**
 * Do not reopen an approval dock after its Turn has been stopped. A missing
 * Turn ID is treated as belonging to the interrupted Turn because accepting
 * an unscoped approval is less safe than dropping a stale notification.
 */
export function shouldIgnoreApprovalWhileInterrupting(
  approvalData,
  interrupting,
  interruptedTurnId = null,
) {
  if (!interrupting) return false;
  const approvalTurnId = approvalData?.turnId || approvalData?.turn_id;
  if (!approvalTurnId || !interruptedTurnId) return true;
  return approvalTurnId === interruptedTurnId;
}

function approvalField(approval, camel, snake = camel) {
  return approval?.[camel] ?? approval?.[snake];
}

function approvalPayload(approval) {
  return approval?.data && typeof approval.data === 'object'
    ? { ...approval.data, requestId: approval.requestId || approval.data.requestId }
    : approval || {};
}

/**
 * Stable UI identity for one approval wait. Provider request IDs are only a
 * transport hint; call ID plus the owning scope identifies the tool call.
 */
export function approvalIdentity(approval) {
  const payload = approvalPayload(approval);
  const projectId = payload.projectId || payload.project_id || '';
  const threadId = payload.threadId || payload.thread_id || '';
  const turnId = payload.turnId || payload.turn_id || '';
  const callId = payload.callId || payload.call_id;
  const requestId = payload.requestId || payload.request_id || '';
  return [
    projectId,
    threadId,
    turnId,
    callId ? `call:${callId}` : `request:${requestId}`,
  ].join('\u001f');
}

function approvalResultState(approval) {
  if (approval?.phase === 'requested') return 'pending';
  if (approval?.state) return approval.state;
  if (approval?.expired || approval?.cancelled) return 'expired';
  const outcome = String(
    approvalField(approval, 'outcome') || approvalField(approval, 'decision') || '',
  ).toLowerCase();
  if (outcome === 'approved' || outcome === 'approve') return 'approved';
  if (outcome === 'denied' || outcome === 'deny') return 'denied';
  return 'expired';
}

/**
 * Keep approval decisions in the transcript next to the tool they govern.
 * Pending approval remains an App-level control; this projection is durable
 * for the current message stream and survives the dock disappearing.
 */
export function mergeApprovalEvent(messages, approval) {
  if (!approval || messages.length === 0) return messages;
  const callId = approvalField(approval, 'callId', 'call_id') || null;
  const requestId = approvalField(approval, 'requestId', 'request_id') || null;
  const turnId = approvalField(approval, 'turnId', 'turn_id') || null;
  const toolName = approvalField(approval, 'toolName', 'tool_name') || null;
  let targetIndex = -1;

  if (callId) {
    targetIndex = messages.findIndex((message) => (
      message.role === 'assistant'
        && (message.blocks || []).some(
          (block) => block.type === 'tool' && block.call_id === callId,
        )
    ));
  }
  if (targetIndex === -1 && requestId && !callId) {
    targetIndex = messages.findIndex((message) => (
      message.role === 'assistant'
        && (message.blocks || []).some(
          (block) => block.type === 'tool' && block.approval?.requestId === requestId,
        )
    ));
  }
  if (targetIndex === -1 && turnId) {
    targetIndex = findTurnAssistantIndex(messages, turnId);
  }
  if (targetIndex === -1) return messages;

  const state = approvalResultState(approval);
  const current = messages[targetIndex];
  let changed = false;
  const blocks = (current.blocks || []).map((block) => {
    if (block.type !== 'tool') return block;
    const matchesCall = callId && block.call_id === callId;
    const matchesRequest = !callId && requestId
      && block.approval?.requestId === requestId;
    const matchesLegacyTool = !callId && !requestId && toolName
      && block.name === toolName && !block.approval;
    if (!matchesCall && !matchesRequest && !matchesLegacyTool) return block;
    changed = true;
    return {
      ...block,
      approval: {
        ...block.approval,
        state,
        requestId: requestId || block.approval?.requestId || null,
        callId: callId || block.call_id || null,
        toolName: toolName || block.name || null,
        grantScope: approvalField(approval, 'grantScope', 'grant_scope') || null,
        reason: approval.reason || '',
        source: approval.source || null,
      },
    };
  });
  if (!changed) return messages;
  const copy = [...messages];
  copy[targetIndex] = { ...current, blocks };
  return copy;
}

function projectedStatus(status) {
  if (status === 'failed') return 'failed';
  if (status === 'completed') return 'completed';
  return 'running';
}

function projectedToolOutput(value) {
  if (!value || typeof value !== 'object') return null;
  return value.output ?? value.result ?? value.content ?? null;
}

function projectedToolOutcome(value) {
  if (!value || typeof value !== 'object') return null;
  return typeof value.outcome === 'string' ? value.outcome : null;
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
    const output = projectedToolOutput(item);
    const outcome = projectedToolOutcome(item);
    const nextBlock = {
      type: 'tool',
      id: callId,
      call_id: callId,
      name: toolName,
      toolName: toolName,
      arguments: item.arguments ?? {},
      args: item.arguments ?? {},
      status: projectedStatus(item.status),
      outcome,
      output,
      error: item.status === 'failed' ? output ?? 'Tool failed' : null,
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
      output: output ?? blocks[existingIndex].output ?? null,
      outcome: outcome ?? blocks[existingIndex].outcome ?? null,
    };
  }

  last.blocks = blocks;
  copy[targetIndex] = last;
  return copy;
}

function settleThinkingBlocks(messages, targetIndex) {
  if (targetIndex < 0 || targetIndex >= messages.length) return messages;
  const current = messages[targetIndex];
  const blocks = current.blocks || [];
  if (!blocks.some((block) => block.type === 'thinking' && block.isStreaming)) {
    return messages;
  }
  const copy = [...messages];
  copy[targetIndex] = {
    ...current,
    blocks: blocks.map((block) => (
      block.type === 'thinking' ? { ...block, isStreaming: false } : block
    )),
  };
  return copy;
}

function hasAssistantBlockBoundary(blocks) {
  return blocks.some(
    (block) => block.type === 'tool' || block.type === 'compaction'
  );
}

function reasoningIdFromEvent(data) {
  const projectedReasoning = (data?.items || []).find(
    (item) => item.type === 'reasoning' && item.id,
  );
  if (projectedReasoning?.id) return projectedReasoning.id;

  const itemId = data?.itemId || data?.item_id;
  return itemId ? `${itemId}:reasoning` : null;
}

function appendReasoningDelta(content, delta) {
  if (!delta) return content || '';
  if (!content) return delta;
  if (content.endsWith(delta)) return content;
  if (delta.startsWith(content)) return delta;

  const maxOverlap = Math.min(content.length, delta.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (content.endsWith(delta.slice(0, overlap))) {
      return content + delta.slice(overlap);
    }
  }
  return content + delta;
}

function insertReasoningBlock(blocks, nextBlock) {
  const existingIndex = nextBlock.id
    ? blocks.findIndex(
      (block) => block.type === 'thinking' && block.id === nextBlock.id,
    )
    : blocks.findIndex(
      (block) => block.type === 'thinking' && block.content === nextBlock.content,
    );
  if (existingIndex !== -1) {
    blocks[existingIndex] = {
      ...blocks[existingIndex],
      ...nextBlock,
      content: nextBlock.content || blocks[existingIndex].content || '',
    };
    return;
  }

  // Provider streams can deliver the final answer before the complete
  // reasoning item. Keep reasoning before the answer unless a tool or
  // compaction already establishes a meaningful assistant block boundary.
  if (!hasAssistantBlockBoundary(blocks)) {
    const textIndex = blocks.findIndex((block) => block.type === 'text');
    blocks.splice(textIndex === -1 ? blocks.length : textIndex, 0, nextBlock);
  } else {
    blocks.push(nextBlock);
  }
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
    const existingIndex = blocks.findIndex(
      (b) =>
        b.type === 'compaction' &&
        (b.id === compactionId || (!item.id && b.id.startsWith('compaction')))
    );
    const nextBlock = {
      type: 'compaction',
      id: compactionId,
      status: item.status || 'completed',
      turnId: item.turnId || item.turn_id || null,
    };
    if (existingIndex === -1) {
      blocks.push(nextBlock);
    } else {
      blocks[existingIndex] = {
        ...blocks[existingIndex],
        ...nextBlock,
        turnId: nextBlock.turnId || blocks[existingIndex].turnId || null,
      };
    }
  }

  last.blocks = blocks;
  copy[targetIndex] = last;
  return copy;
}

/**
 * Collapse adjacent compaction lifecycle blocks without losing their details.
 * Non-adjacent compactions remain separate because another model/tool item is
 * meaningful ordering information in the transcript.
 */
export function groupCompactionBlocks(blocks = []) {
  const grouped = [];
  for (const block of blocks) {
    if (block?.type !== 'compaction') {
      grouped.push(block);
      continue;
    }

    const previous = grouped[grouped.length - 1];
    if (previous?.type === 'compactionGroup') {
      grouped[grouped.length - 1] = {
        ...previous,
        items: [...previous.items, block],
      };
    } else {
      grouped.push({
        type: 'compactionGroup',
        id: block.id || `compaction-group-${grouped.length}`,
        items: [block],
      });
    }
  }
  return grouped;
}

/**
 * Providers may finish a reasoning item after the final text item. Keep a
 * trailing reasoning-only suffix attached to the answer it explains while
 * preserving tool and compaction boundaries.
 */
export function normalizeAssistantBlocks(blocks = []) {
  const lastTextIndex = blocks.findLastIndex((block) => block.type === 'text');
  if (lastTextIndex === -1 || lastTextIndex === blocks.length - 1) return blocks;

  const trailing = blocks.slice(lastTextIndex + 1);
  if (!trailing.every((block) => block.type === 'thinking')) return blocks;

  return [
    ...blocks.slice(0, lastTextIndex),
    ...trailing,
    blocks[lastTextIndex],
  ];
}

function mergeProjectedReasoningItems(messages, items, targetIndex = messages.length - 1) {
  if (messages.length === 0 || items.length === 0) return messages;
  const copy = [...messages];
  const last = { ...copy[targetIndex] };
  const blocks = [...(last.blocks || [])];

  for (const item of items) {
    if (!item.text) continue;
    const existingIndex = item.id
      ? blocks.findIndex((b) => b.type === 'thinking' && b.id === item.id)
      : -1;
    const contentIndex = existingIndex === -1
      ? blocks.findIndex(
        (b) => b.type === 'thinking' && b.content === item.text,
      )
      : existingIndex;
    if (contentIndex === -1) {
      insertReasoningBlock(blocks, {
        type: 'thinking',
        id: item.id,
        content: item.text,
        isStreaming: false,
      });
    } else if ((blocks[contentIndex].content || '').length < item.text.length) {
      blocks[contentIndex] = {
        ...blocks[contentIndex],
        ...(item.id ? { id: item.id } : {}),
        content: item.text,
      };
    } else if (item.id && !blocks[contentIndex].id) {
      blocks[contentIndex] = { ...blocks[contentIndex], id: item.id };
    }
  }

  last.thinking = blocks
    .filter((block) => block.type === 'thinking')
    .map((block) => block.content)
    .join('\n\n');
  last.blocks = normalizeAssistantBlocks(blocks);
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

function normalizedHistoryText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/**
 * Attach durable Turn ownership to checkpoint messages without relying on the
 * number/order of assistant bubbles. SessionStore item projections are the
 * authoritative join key; this matters when one turn has multiple assistant
 * segments or when a later turn contains no visible text.
 */
export function assignHistoryTurnIds(messages = [], entries = []) {
  const candidates = (entries || [])
    .map((entry, index) => ({
      index,
      turnId: entry.turnId || entry.turn_id || null,
      capturedAt: entry.capturedAt || entry.captured_at || null,
      item: entry.item || {},
      used: false,
    }))
    .filter((candidate) => candidate.turnId);

  const findCandidate = (message) => {
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls
      : Array.isArray(message.toolCalls)
        ? message.toolCalls
        : [];
    const callIds = toolCalls
      .map((call) => call?.id || call?.call_id)
      .filter(Boolean);
    if (callIds.length > 0) {
      const toolCandidate = candidates.find((candidate) => (
        !candidate.used
          && (candidate.item.type === 'toolCall' || candidate.item.type === 'tool_call')
          && callIds.includes(candidate.item.id)
      ));
      if (toolCandidate) return toolCandidate;
    }

    const text = normalizedHistoryText(message.text);
    const reasoning = normalizedHistoryText(message.reasoning || message.thinking);
    const expectedTypes = message.role === 'user'
      ? ['userMessage']
      : ['agentMessage', 'reasoning'];
    return candidates.find((candidate) => {
      if (candidate.used || !expectedTypes.includes(candidate.item.type)) return false;
      const candidateText = normalizedHistoryText(candidate.item.text);
      return Boolean(candidateText) && (candidateText === text || candidateText === reasoning);
    }) || null;
  };

  return messages.map((message) => {
    const candidate = findCandidate(message);
    if (!candidate) return message;
    candidate.used = true;
    return {
      ...message,
      turnId: candidate.turnId,
      capturedAt: message.capturedAt || candidate.capturedAt || null,
    };
  });
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
    const projected = mergeProjectedToolItems(next, [item], targetIndex);
    return data.method === 'item/started'
      ? settleThinkingBlocks(projected, targetIndex)
      : projected;
  }
  if (item.type === 'contextCompaction' || item.type === 'context_compaction') {
    const projected = mergeProjectedCompactionItems(
      next,
      [{ ...item, turnId }],
      targetIndex,
    );
    return data.method === 'item/started'
      ? settleThinkingBlocks(projected, targetIndex)
      : projected;
  }
  return next;
}

/**
 * Hydrate a message projection with cursor results from thread/items/list.
 */
export function aggregateThreadItems(messages, entries) {
  let next = messages;
  const targetByTurn = new Map();
  for (let index = 0; index < next.length; index += 1) {
    const message = next[index];
    if (message.role === 'assistant' && message.turnId && !targetByTurn.has(message.turnId)) {
      targetByTurn.set(message.turnId, index);
    }
  }

  for (const entry of entries || []) {
    const turnId = entry.turnId || entry.turn_id || 'unknown';
    const item = entry.item || {};
    if (!item.type || item.type === 'userMessage') continue;
    let targetIndex = targetByTurn.get(turnId);
    if (targetIndex === undefined) {
      if (item.type === 'toolCall' || item.type === 'tool_call') {
        targetIndex = findToolTargetIndex(next, item, -1);
      }
      if (targetIndex === undefined || targetIndex < 0) {
        // Legacy checkpoints may lack message turn IDs. Never attach such an
        // item to an arbitrary assistant by position: create an explicit
        // Turn projection and keep the ambiguity visible to the user.
        next = ensureTurnAssistant(next, turnId);
        targetIndex = findTurnAssistantIndex(next, turnId);
      }
      targetByTurn.set(turnId, targetIndex);
    }
    if (item.type === 'toolCall' || item.type === 'tool_call') {
      next = mergeProjectedToolItems(
        next,
        [item],
        findToolTargetIndex(next, item, targetIndex),
      );
    } else if (item.type === 'contextCompaction' || item.type === 'context_compaction') {
      next = mergeProjectedCompactionItems(
        next,
        [{ ...item, turnId }],
        targetIndex,
      );
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
      last.blocks = normalizeAssistantBlocks(blocks);
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
          message.textAttachments?.length ||
          message.fileAttachments?.length ||
          message.referencedFiles?.length ||
          message.selectedSkills?.length ||
          message.workflow?.id ||
          message.isGoal ||
          message.isSteer,
      );
    }

    const hasBlock = (message.blocks || []).some((block) => {
      if (!block) return false;
      if (block.type === 'text' || block.type === 'thinking') {
        return Boolean(block.content?.trim?.());
      }
      return block.type === 'tool' || block.type === 'compaction' || block.type === 'skills';
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

    if (type === 'skill_group_activated') {
      const copy = [...messages];
      const last = { ...copy[targetIndex] };
      const blocks = [...(last.blocks || [])];
      const blockId = `workflow_${data.turnId || 'event'}`;
      const existingIndex = blocks.findIndex(
        (block) => block.type === 'skills' && block.id === blockId,
      );
      const workflowBlock = {
        type: 'skills',
        id: blockId,
        workflow: evt.group || null,
        skills: [],
        loading: [],
        loaded: [],
        failed: [],
        reasonCode: null,
      };
      if (existingIndex === -1) {
        blocks.push(workflowBlock);
      } else {
        blocks[existingIndex] = { ...blocks[existingIndex], ...workflowBlock };
      }
      last.blocks = blocks;
      copy[targetIndex] = last;
      return copy;
    }

    if (type === 'skills_loaded' || type === 'skills_load_failed') {
      const copy = [...messages];
      const last = { ...copy[targetIndex] };
      const blocks = [...(last.blocks || [])];
      const blockId = `skills_${data.turnId || 'event'}`;
      const existingIndex = blocks.findIndex(
        (block) => block.type === 'skills' && block.id === blockId,
      );
      const existing = existingIndex === -1 ? {} : blocks[existingIndex];
      const loading = new Set(existing.loading || []);
      const loaded = new Set(existing.loaded || existing.skills || []);
      const failed = new Set(existing.failed || []);
      const names = (evt.skills || [])
        .map((skill) => typeof skill === 'string'
          ? skill
          : (skill.qualifiedName || skill.qualified_name || skill.name))
        .filter(Boolean);

      if (type === 'skills_load_failed') {
        names.forEach((name) => {
          loading.delete(name);
          failed.add(name);
        });
      } else if ((evt.phase || 'loaded') === 'started') {
        names.forEach((name) => {
          if (!loaded.has(name)) loading.add(name);
          failed.delete(name);
        });
      } else {
        names.forEach((name) => {
          loading.delete(name);
          failed.delete(name);
          loaded.add(name);
        });
      }

      const skillBlock = {
        ...existing,
        type: 'skills',
        id: blockId,
        workflow: null,
        activation: evt.activation || existing.activation || 'on_demand',
        loading: [...loading],
        loaded: [...loaded],
        failed: [...failed],
        skills: [...loaded],
        reasonCode: evt.reasonCode || evt.reason_code || existing.reasonCode || null,
      };
      if (existingIndex === -1) {
        blocks.push(skillBlock);
      } else {
        blocks[existingIndex] = skillBlock;
      }
      last.blocks = blocks;
      copy[targetIndex] = last;
      return copy;
    }

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
      messages = mergeProjectedCompactionItems(
        messages,
        projectedCompactions.map((item) => ({ ...item, turnId: data.turnId })),
        targetIndex,
      );
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

    if (type === 'context_compaction_finished' && projectedCompactions.length === 0) {
      const fallbackId = `compaction_${evt.checkpoint_seq || Date.now()}`;
      const exists = blocks.some(
        (b) => b.type === 'compaction' && b.id === fallbackId,
      );
      if (!exists) {
        blocks.push({
          type: 'compaction',
          id: fallbackId,
          status: 'completed',
          turnId: data.turnId || null,
        });
        last.blocks = blocks;
        copy[targetIndex] = last;
        return copy;
      }
    }

    if (type === 'assistant_reasoning_delta') {
      const delta = evt.delta || '';
      const reasoningId = reasoningIdFromEvent(data);
      const identifiedIndex = reasoningId
        ? blocks.findIndex(
          (block) => block.type === 'thinking' && block.id === reasoningId,
        )
        : -1;
      if (identifiedIndex !== -1) {
        blocks[identifiedIndex] = {
          ...blocks[identifiedIndex],
          content: appendReasoningDelta(blocks[identifiedIndex].content, delta),
          isStreaming: true,
        };
      } else {
        const lastBlock = blocks[blocks.length - 1];
        const lastThinkingIndex = blocks.findLastIndex(
          (block) => block.type === 'thinking',
        );
        const boundaryAfterLastThinking = lastThinkingIndex !== -1
          && blocks.slice(lastThinkingIndex + 1).some(
            (block) => block.type === 'tool' || block.type === 'compaction',
          );
        const existingThinking = !hasAssistantBlockBoundary(blocks)
          ? blocks.findIndex((block) => block.type === 'thinking')
          : -1;
        if (lastBlock?.type === 'thinking' && !boundaryAfterLastThinking) {
          blocks[blocks.length - 1] = {
            ...lastBlock,
            content: appendReasoningDelta(lastBlock.content, delta),
            isStreaming: true,
          };
        } else if (existingThinking !== -1) {
          blocks[existingThinking] = {
            ...blocks[existingThinking],
            content: appendReasoningDelta(blocks[existingThinking].content, delta),
            isStreaming: true,
          };
        } else {
          insertReasoningBlock(blocks, {
            type: 'thinking',
            id: reasoningId || undefined,
            content: delta,
            isStreaming: true,
          });
        }
      }
      last.thinking = blocks
        .filter((block) => block.type === 'thinking')
        .map((block) => block.content || '')
        .join('\n\n');
      last.blocks = normalizeAssistantBlocks(blocks);
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
        id: evt.call_id || evt.id || '',
        name: toolName,
        toolName: toolName,
        args: evt.args || evt.parameters || {},
        arguments: evt.args || evt.parameters || {},
        status: 'running',
        outcome: null,
        call_id: evt.call_id || evt.id || '',
      });
      last.blocks = blocks;
      copy[targetIndex] = last;
      return copy;
    }

    if (type === 'tool_finished') {
      const output = projectedToolOutput(evt) ?? '';
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (
          blocks[i].type === 'tool' &&
          (blocks[i].call_id === evt.call_id || blocks[i].status === 'running')
        ) {
          blocks[i] = {
          ...blocks[i],
          status: evt.error ? 'failed' : 'completed',
          outcome: typeof evt.outcome === 'string'
            ? evt.outcome
            : blocks[i].outcome ?? null,
          output,
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
