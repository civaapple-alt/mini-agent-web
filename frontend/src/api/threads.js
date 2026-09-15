import { request, requestSignal } from './request.js';

export const threadApi = {
  async listThreads(options = {}) {
    const res = await request('/api/threads', requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to list threads');
    return res.json();
  },

  async startThread(threadId = 'default', title = null, project = null, options = {}) {
    const projectId = project || options.projectId;
    const res = await request('/api/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, title, project, project_id: projectId }),
      ...requestSignal(options),
    }, projectId);
    if (!res.ok) throw new Error('Failed to start thread');
    return res.json();
  },

  async attachThread(threadId = 'default', project = null, options = {}) {
    const projectId = project || options.projectId;
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId)}/attach`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, project_id: projectId }),
        ...requestSignal(options),
      },
      projectId,
    );
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || `Failed to attach thread ${threadId}`);
    }
    return res.json();
  },

  async forkThread(sourceThreadId, newThreadId, title = null, project = null, options = {}) {
    const projectId = project || options.projectId;
    const res = await request('/api/threads/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_thread_id: sourceThreadId,
        new_thread_id: newThreadId,
        title,
        project,
        project_id: projectId,
        context_policy: options.contextPolicy || 'compact_if_needed',
      }),
      ...requestSignal(options),
    }, projectId);
    if (!res.ok) throw new Error('Failed to fork thread');
    return res.json();
  },

  async readThread(threadId, options = {}) {
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId)}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to read thread ${threadId}`);
    return res.json();
  },

  async listThreadItems(threadId, options = {}) {
    const params = new URLSearchParams();
    if (options.turnId) params.set('turn_id', options.turnId);
    if (options.cursor) params.set('cursor', options.cursor);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.sortDirection) params.set('sort_direction', options.sortDirection);
    const query = params.toString();
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId)}/items${query ? `?${query}` : ''}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to list items for thread ${threadId}`);
    return res.json();
  },

  async getRuntimeStatus(threadId = 'default', options = {}) {
    const targetThread = threadId || 'default';
    const res = await request(
      `/api/threads/${encodeURIComponent(targetThread)}/runtime/status`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to get runtime status for ${targetThread}`);
    return res.json();
  },

  async replayThreadEvents(threadId = 'default', afterSequence = null, limit = 128, options = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (afterSequence !== null && afterSequence !== undefined) {
      params.set('after_sequence', String(afterSequence));
    }
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId || 'default')}/events?${params}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to replay events for ${threadId}`);
    return res.json();
  },

  async renameThread(threadId, title, options = {}) {
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId)}/rename`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
        ...requestSignal(options),
      },
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to rename thread ${threadId}`);
    return res.json();
  },

  async updateThreadSummary(threadId, summary, options = {}) {
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId)}/summary`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
        ...requestSignal(options),
      },
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to update summary for ${threadId}`);
    return res.json();
  },

  async closeThread(threadId, options = {}) {
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId)}/close`,
      { method: 'POST', ...requestSignal(options) },
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to close thread ${threadId}`);
    return res.json();
  },
};
