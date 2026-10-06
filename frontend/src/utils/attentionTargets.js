export function toolCallIdOf(tool) {
  const id = tool?.callId || tool?.call_id || tool?.id;
  return id === null || id === undefined || id === '' ? null : String(id);
}

function visitTools(value, found, seen) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => visitTools(item, found, seen));
    return;
  }

  if (value.type === 'tool' || value.name || value.toolName || value.tool_name) {
    const id = toolCallIdOf(value);
    if (id) found.set(id, value);
  }
  if (Array.isArray(value.blocks)) visitTools(value.blocks, found, seen);
  if (Array.isArray(value.tools)) visitTools(value.tools, found, seen);
  if (Array.isArray(value.items)) visitTools(value.items, found, seen);
}

export function getToolCalls(message) {
  const found = new Map();
  visitTools(message?.blocks, found, new Set());
  visitTools(message?.tools, found, new Set());
  return [...found.entries()].map(([callId, tool]) => ({ callId, tool }));
}

export function getToolCallIds(messages = []) {
  return new Set(messages.flatMap((message) => (
    getToolCalls(message).map(({ callId }) => callId)
  )));
}

export function messageMatchesAttentionTarget(message, target = {}) {
  if (!message) return false;
  const targetTurnId = target.turnId ? String(target.turnId) : null;
  const messageTurnId = message.turnId ? String(message.turnId) : null;
  if (targetTurnId && messageTurnId && targetTurnId !== messageTurnId) return false;

  if (target.callId) {
    return getToolCalls(message).some(({ callId }) => callId === String(target.callId));
  }
  if (target.interactionId) {
    const interactionId = String(target.interactionId);
    if (String(message.interactionId || message.interaction_id || '') === interactionId) return true;
    return getToolCalls(message).some(({ tool }) => (
      String(tool.interactionId || tool.interaction_id || '') === interactionId
    ));
  }
  return Boolean(targetTurnId && messageTurnId === targetTurnId);
}

export function findAttentionMessage(messages = [], target = {}) {
  return messages.find((message) => messageMatchesAttentionTarget(message, target)) || null;
}

export function pendingApprovalCallId(approval) {
  const data = approval?.data || approval || {};
  const callId = data.callId || data.call_id;
  return callId === null || callId === undefined || callId === '' ? null : String(callId);
}

export function pendingApprovalRequestId(approval) {
  const requestId = approval?.requestId || approval?.request_id || approval?.data?.requestId;
  return requestId === null || requestId === undefined || requestId === ''
    ? null
    : String(requestId);
}
