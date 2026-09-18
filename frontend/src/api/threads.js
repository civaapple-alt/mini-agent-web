import { request, requestSignal, resolveProjectId } from './request.js';

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
        context_policy: options.contextPolicy || 'exact',
      }),
      ...requestSignal(options),
    }, projectId);
    if (!res.ok) throw new Error('Failed to fork thread');
    return res.json();
  },

  async startChildTask(sourceThreadId, newThreadId, prompt, options = {}) {
    const projectId = options.projectId || null;
    const body = {
      new_thread_id: newThreadId,
      prompt,
      title: options.title || null,
      project_id: projectId,
    };
    if (options.groupId) body.group_id = options.groupId;
    if (options.executionMode) body.execution_mode = options.executionMode;
    if (options.sequence !== undefined && options.sequence !== null) {
      body.sequence = options.sequence;
    }
    const res = await request(
      `/api/threads/${encodeURIComponent(sourceThreadId || 'default')}/children`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...requestSignal(options),
      },
      projectId,
    );
    if (!res.ok) throw new Error('Failed to start child task');
    return res.json();
  },

  async listChildTasks(sourceThreadId = 'default', options = {}) {
    const threadId = sourceThreadId || 'default';
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId)}/children`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to list child tasks for ${threadId}`);
    return res.json();
  },

  async cancelChildTask(sourceThreadId, childThreadId, options = {}) {
    const parent = sourceThreadId || 'default';
    const res = await request(
      `/api/threads/${encodeURIComponent(parent)}/children/${encodeURIComponent(childThreadId)}/cancel`,
      { method: 'POST', ...requestSignal(options) },
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to cancel child task ${childThreadId}`);
    return res.json();
  },

  async retryChildTask(sourceThreadId, childThreadId, options = {}) {
    const parent = sourceThreadId || 'default';
    const res = await request(
      `/api/threads/${encodeURIComponent(parent)}/children/${encodeURIComponent(childThreadId)}/retry`,
      { method: 'POST', ...requestSignal(options) },
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to retry child task ${childThreadId}`);
    return res.json();
  },

  async readNotebook(threadId = 'default', options = {}) {
    const targetThread = threadId || 'default';
    const params = new URLSearchParams();
    if (options.scope === 'parent') params.set('scope', 'parent');
    const query = params.toString();
    const res = await request(
      `/api/threads/${encodeURIComponent(targetThread)}/notebook${query ? `?${query}` : ''}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to read notebook for ${targetThread}`);
    return res.json();
  },

  async searchNotebook(threadId = 'default', query, options = {}) {
    const params = new URLSearchParams({ q: query });
    if (options.scope === 'parent') params.set('scope', 'parent');
    if (options.limit) params.set('limit', String(options.limit));
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId)}/notebook/search?${params.toString()}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to search notebook for ${threadId}`);
    return res.json();
  },

  async writeNotebook(threadId = 'default', entry = {}, options = {}) {
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId)}/notebook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
        ...requestSignal(options),
      },
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to write notebook for ${threadId}`);
    return res.json();
  },

  async forgetNotebook(threadId = 'default', key, options = {}) {
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId)}/notebook`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
        ...requestSignal(options),
      },
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to forget notebook entry for ${threadId}`);
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

  async listBackgroundTasks(threadId = 'default', options = {}) {
    const targetThread = threadId || 'default';
    const res = await request(
      `/api/threads/${encodeURIComponent(targetThread)}/background-tasks`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to list background tasks for ${targetThread}`);
    return res.json();
  },

  async readBackgroundTask(threadId, taskId, options = {}) {
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId || 'default')}/background-tasks/${encodeURIComponent(taskId)}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to read background task ${taskId}`);
    return res.json();
  },

  async readBackgroundTaskLogs(threadId, taskId, options = {}) {
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId || 'default')}/background-tasks/${encodeURIComponent(taskId)}/logs`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to read background task logs ${taskId}`);
    return res.json();
  },

  async stopBackgroundTask(threadId, taskId, options = {}) {
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId || 'default')}/background-tasks/${encodeURIComponent(taskId)}/stop`,
      { method: 'POST', ...requestSignal(options) },
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to stop background task ${taskId}`);
    return res.json();
  },

  async restartBackgroundTask(threadId, taskId, options = {}) {
    const res = await request(
      `/api/threads/${encodeURIComponent(threadId || 'default')}/background-tasks/${encodeURIComponent(taskId)}/restart`,
      { method: 'POST', ...requestSignal(options) },
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to restart background task ${taskId}`);
    return res.json();
  },

  async interruptTurn(turnId, threadId = 'default', options = {}) {
    const projectId = resolveProjectId(options.projectId);
    const targetThread = threadId || 'default';
    const res = await request('/api/agent/interrupt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        turn_id: turnId,
        thread_id: targetThread,
        project_id: projectId || null,
      }),
      ...requestSignal(options),
    }, projectId);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || `Failed to interrupt turn ${turnId}`);
    }
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
