import { request, requestSignal, resolveProjectId } from './request.js';

export const approvalApi = {
  async respondApproval(requestId, decision, grantScope, reason = '', options = {}) {
    const res = await request('/api/approval/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: requestId,
        decision,
        grant_scope: grantScope,
        reason,
        project_id: resolveProjectId(options.projectId),
        thread_id: options.threadId || null,
        turn_id: options.turnId || null,
      }),
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) throw new Error('Failed to respond approval');
    return res.json();
  },

  async listPendingApprovals(options = {}) {
    const params = new URLSearchParams();
    if (options.threadId) params.set('thread_id', options.threadId);
    const query = params.toString();
    const res = await request(
      `/api/approval/pending${query ? `?${query}` : ''}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to list pending approvals');
    return res.json();
  },
};
