function approvalData(approval) {
  return approval?.data && typeof approval.data === 'object'
    ? approval.data
    : approval || {};
}

function approvalField(data, camel, snake) {
  return data?.[camel] || data?.[snake] || null;
}

export function approvalThreadId(approval) {
  return approvalField(approvalData(approval), 'threadId', 'thread_id');
}

export function approvalProjectId(approval) {
  return approvalField(approvalData(approval), 'projectId', 'project_id');
}

export function partitionApprovalsByThread(approvals, threadId, projectId) {
  const currentThread = [];
  const otherThreads = [];
  for (const approval of Array.isArray(approvals) ? approvals : []) {
    const approvalProject = approvalProjectId(approval);
    if (projectId && approvalProject && approvalProject !== projectId) continue;
    const approvalThread = approvalThreadId(approval);
    if (!approvalThread || approvalThread === threadId) currentThread.push(approval);
    else otherThreads.push(approval);
  }
  return { currentThread, otherThreads };
}

export function projectOtherThreadApprovalEvent(event, currentThreadId, currentProjectId) {
  const approval = event?.approval || event?.data || {};
  const threadId = event?.threadId
    || event?.thread_id
    || approval.threadId
    || approval.thread_id;
  const projectId = event?.projectId
    || event?.project_id
    || approval.projectId
    || approval.project_id
    || currentProjectId;
  if (!threadId || threadId === currentThreadId) return null;
  if (projectId && currentProjectId && projectId !== currentProjectId) return null;

  if (event.type === 'error' && event.scope === 'approval') {
    return {
      kind: 'error',
      requestId: event.requestId || event.request_id,
      callId: event.callId || event.call_id,
      threadId,
      turnId: event.turnId || event.turn_id || null,
      projectId,
    };
  }

  if (event.type === 'approval_request' || event.type === 'approval') {
    const payload = event.type === 'approval_request' ? event.data || {} : event.approval || {};
    const phase = event.type === 'approval_request' ? 'requested' : payload.phase;
    if (phase !== 'requested' && phase !== 'resolved') return null;
    return {
      kind: phase,
      requestId: event.requestId || payload.requestId || payload.request_id,
      approval: {
        ...payload,
        projectId: payload.projectId || payload.project_id || projectId,
        threadId: payload.threadId || payload.thread_id || threadId,
        turnId: payload.turnId || payload.turn_id || event.turnId || event.turn_id || null,
      },
    };
  }
  return null;
}
