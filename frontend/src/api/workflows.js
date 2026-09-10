import { request, requestSignal, resolveProjectId } from './request.js';

export const workflowApi = {
  async getWorkflowState(threadId = null, options = {}) {
    const params = new URLSearchParams();
    if (threadId) params.set('thread_id', threadId);
    const query = params.toString();
    const res = await request(
      `/api/workflows/state${query ? `?${query}` : ''}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to get workflow state');
    return res.json();
  },

  async updateThreadSettings(
    mode,
    builtinTools = null,
    threadId = 'default',
    continuationMode = null,
    options = {},
  ) {
    const targetThread = threadId || 'default';
    const payload = { mode, builtin_tools: builtinTools };
    if (continuationMode) payload.continuation_mode = continuationMode;
    const res = await request(
      `/api/threads/${encodeURIComponent(targetThread)}/settings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        ...requestSignal(options),
      },
      options.projectId,
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(
        body?.detail || body?.message || `Failed to update thread settings (${res.status})`,
      );
    }
    return res.json();
  },

  async setCollaborationMode(mode, threadId = null, continuationMode = null, options = {}) {
    return workflowApi.updateThreadSettings(mode, null, threadId, continuationMode, options);
  },

  async setGoal(objective, tokenBudget = null, status = null, threadId = 'default', options = {}) {
    const targetThread = threadId || 'default';
    const res = await request(
      `/api/threads/${encodeURIComponent(targetThread)}/goal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective,
          token_budget: tokenBudget,
          status,
          project_id: resolveProjectId(options.projectId),
        }),
        ...requestSignal(options),
      },
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to set goal');
    return res.json();
  },

  async updateGoal(objective, tokenBudget = null, threadId = 'default', options = {}) {
    return workflowApi.setGoal(objective, tokenBudget, null, threadId, options);
  },

  async pauseGoal(threadId = 'default', options = {}) {
    const targetThread = threadId || 'default';
    const res = await request(
      `/api/threads/${encodeURIComponent(targetThread)}/goal/pause`,
      { method: 'POST', ...requestSignal(options) },
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to pause goal');
    return res.json();
  },

  async resumeGoal(threadId = 'default', options = {}) {
    const targetThread = threadId || 'default';
    const res = await request(
      `/api/threads/${encodeURIComponent(targetThread)}/goal/resume`,
      { method: 'POST', ...requestSignal(options) },
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to resume goal');
    return res.json();
  },

  async getGoal(threadId = 'default', options = {}) {
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId || 'default')}/goal`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to get goal');
    return res.json();
  },

  async clearGoal(threadId = 'default', options = {}) {
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId || 'default')}/goal`,
      { method: 'DELETE', ...requestSignal(options) },
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to clear goal');
    return res.json();
  },

  async getWorkflowFiles(threadId = null, options = {}) {
    const params = new URLSearchParams();
    if (threadId) params.set('thread_id', threadId);
    const query = params.toString();
    const res = await request(
      `/api/workflows/files${query ? `?${query}` : ''}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to list workflow files');
    return res.json();
  },

  async getWorkflowFileContent(path, threadId = null, options = {}) {
    const params = new URLSearchParams({ path });
    if (threadId) params.set('thread_id', threadId);
    const res = await request(
      `/api/workflows/file/content?${params}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to read file content for ${path}`);
    return res.json();
  },
};
