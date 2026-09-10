/**
 * API and WebSocket client for Mini Agent Web Backend.
 */

const API_BASE = '';

let activeProjectId = null;

/** Set the routing context used by every subsequent REST/WS request. */
export function setActiveProjectId(projectId) {
  activeProjectId = projectId || null;
}

function resolveProjectId(projectId) {
  return projectId || activeProjectId;
}

function withProjectId(url, projectId) {
  const resolvedProjectId = resolveProjectId(projectId);
  if (!resolvedProjectId) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}project_id=${encodeURIComponent(resolvedProjectId)}`;
}

function request(url, options = {}, projectId = null) {
  return fetch(withProjectId(url, projectId), options);
}

function requestSignal(options) {
  return options?.signal ? { signal: options.signal } : {};
}

export const api = {
  // ---------------------------------------------------------------------------
  // Thread Management
  // ---------------------------------------------------------------------------

  async listThreads(options = {}) {
    const res = await request(`${API_BASE}/api/threads`, requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to list threads');
    return res.json();
  },

  async startThread(threadId = 'default', title = null, project = null, options = {}) {
    const projectId = project || options.projectId;
    const res = await request(`${API_BASE}/api/threads`, {
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
    const res = await request(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}/attach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, project_id: projectId }),
      ...requestSignal(options),
    }, projectId);
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || `Failed to attach thread ${threadId}`);
    }
    return res.json();
  },

  async forkThread(sourceThreadId, newThreadId, title = null, project = null, options = {}) {
    const projectId = project || options.projectId;
    const res = await request(`${API_BASE}/api/threads/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_thread_id: sourceThreadId,
        new_thread_id: newThreadId,
        title,
        project,
        project_id: projectId,
      }),
      ...requestSignal(options),
    }, projectId);
    if (!res.ok) throw new Error('Failed to fork thread');
    return res.json();
  },

  async readThread(threadId, options = {}) {
    const res = await request(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}`, requestSignal(options), options.projectId);
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
      `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/items${query ? `?${query}` : ''}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to list items for thread ${threadId}`);
    return res.json();
  },

  async getRuntimeStatus(threadId = 'default', options = {}) {
    const targetThread = threadId || 'default';
    const res = await request(
      `${API_BASE}/api/threads/${encodeURIComponent(targetThread)}/runtime/status`,
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
      `${API_BASE}/api/threads/${encodeURIComponent(threadId || 'default')}/events?${params}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error(`Failed to replay events for ${threadId}`);
    return res.json();
  },

  async renameThread(threadId, title, options = {}) {
    const res = await request(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) throw new Error(`Failed to rename thread ${threadId}`);
    return res.json();
  },

  async updateThreadSummary(threadId, summary, options = {}) {
    const res = await request(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}/summary`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary }),
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) throw new Error(`Failed to update summary for ${threadId}`);
    return res.json();
  },

  async closeThread(threadId, options = {}) {
    const res = await request(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}/close`, {
      method: 'POST',
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) throw new Error(`Failed to close thread ${threadId}`);
    return res.json();
  },

  // ---------------------------------------------------------------------------
  // World Governance & MCP
  // ---------------------------------------------------------------------------

  async getWorldState(options = {}) {
    const res = await request(`${API_BASE}/api/world/state`, requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to get world state');
    return res.json();
  },

  async refreshWorld(options = {}) {
    const res = await request(`${API_BASE}/api/world/refresh`, { method: 'POST', ...requestSignal(options) }, options.projectId);
    if (!res.ok) throw new Error('Failed to refresh world');
    return res.json();
  },

  async getMcpStatus(options = {}) {
    const res = await request(`${API_BASE}/api/mcp/status`, requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to get MCP status');
    return res.json();
  },

  async retryMcp(options = {}) {
    const res = await request(`${API_BASE}/api/mcp/retry`, { method: 'POST', ...requestSignal(options) }, options.projectId);
    if (!res.ok) throw new Error('Failed to retry MCP');
    return res.json();
  },

  async setWorldExecution(access = 'project', policy = 'interactive', options = {}) {
    const res = await request(`${API_BASE}/api/world/execution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access, policy, project_id: resolveProjectId(options.projectId) }),
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) throw new Error('Failed to set execution scope');
    return res.json();
  },

  async getWorldApproval(options = {}) {
    const params = new URLSearchParams();
    if (options.threadId) params.set('thread_id', options.threadId);
    const query = params.toString();
    const url = `${API_BASE}/api/world/approval${query ? `?${query}` : ''}`;
    const res = await request(url, requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to inspect project approvals');
    return res.json();
  },

  async revokeWorldApprovals(options = {}) {
    const res = await request(`${API_BASE}/api/world/approval/revoke`, {
      method: 'POST',
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) throw new Error('Failed to revoke project approvals');
    return res.json();
  },

  // ---------------------------------------------------------------------------
  // Workflows (Plan Mode & Goals) & Files
  // ---------------------------------------------------------------------------

  async getWorkflowState(threadId = null, options = {}) {
    const params = new URLSearchParams();
    if (threadId) params.set('thread_id', threadId);
    const query = params.toString();
    const url = `${API_BASE}/api/workflows/state${query ? `?${query}` : ''}`;
    const res = await request(url, requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to get workflow state');
    return res.json();
  },

  async updateThreadSettings(mode, builtinTools = null, threadId = 'default', continuationMode = null, options = {}) {
    const targetThread = threadId || 'default';
    const payload = { mode, builtin_tools: builtinTools };
    if (continuationMode) payload.continuation_mode = continuationMode;
    const res = await request(`${API_BASE}/api/threads/${encodeURIComponent(targetThread)}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) throw new Error('Failed to update thread settings');
    return res.json();
  },

  async setCollaborationMode(mode, threadId = null, continuationMode = null, options = {}) {
    return this.updateThreadSettings(mode, null, threadId, continuationMode, options);
  },

  async setGoal(objective, tokenBudget = null, status = null, threadId = 'default', options = {}) {
    const targetThread = threadId || 'default';
    const res = await request(`${API_BASE}/api/threads/${encodeURIComponent(targetThread)}/goal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objective,
        token_budget: tokenBudget,
        status,
        project_id: resolveProjectId(options.projectId),
      }),
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) throw new Error('Failed to set goal');
    return res.json();
  },
  async updateGoal(objective, tokenBudget = null, threadId = 'default', options = {}) {
    return this.setGoal(objective, tokenBudget, null, threadId, options);
  },
  async pauseGoal(threadId = 'default', options = {}) {
    const targetThread = threadId || 'default';
    const res = await request(`${API_BASE}/api/threads/${encodeURIComponent(targetThread)}/goal/pause`, {
      method: 'POST',
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) throw new Error('Failed to pause goal');
    return res.json();
  },
  async resumeGoal(threadId = 'default', options = {}) {
    const targetThread = threadId || 'default';
    const res = await request(`${API_BASE}/api/threads/${encodeURIComponent(targetThread)}/goal/resume`, {
      method: 'POST',
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) throw new Error('Failed to resume goal');
    return res.json();
  },

  async getGoal(threadId = 'default', options = {}) {
    const url = `${API_BASE}/api/threads/${encodeURIComponent(threadId || 'default')}/goal`;
    const res = await request(url, requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to get goal');
    return res.json();
  },

  async clearGoal(threadId = 'default', options = {}) {
    const url = `${API_BASE}/api/threads/${encodeURIComponent(threadId || 'default')}/goal`;
    const res = await request(url, { method: 'DELETE', ...requestSignal(options) }, options.projectId);
    if (!res.ok) throw new Error('Failed to clear goal');
    return res.json();
  },

  async getWorkflowFiles(threadId = null, options = {}) {
    const params = new URLSearchParams();
    if (threadId) params.set('thread_id', threadId);
    const query = params.toString();
    const res = await request(`${API_BASE}/api/workflows/files${query ? `?${query}` : ''}`, requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to list workflow files');
    return res.json();
  },

  async getWorkflowFileContent(path, threadId = null, options = {}) {
    const params = new URLSearchParams({ path });
    if (threadId) params.set('thread_id', threadId);
    const res = await request(`${API_BASE}/api/workflows/file/content?${params}`, requestSignal(options), options.projectId);
    if (!res.ok) throw new Error(`Failed to read file content for ${path}`);
    return res.json();
  },

  async getGitStatus(options = {}) {
    const res = await request(`${API_BASE}/api/world/git/status`, requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to get git status');
    return res.json();
  },

  // ---------------------------------------------------------------------------
  // Projects & Workspace Management
  // ---------------------------------------------------------------------------

  async listProjects(options = {}) {
    const res = await request(`${API_BASE}/api/projects`, requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to list projects');
    return res.json();
  },

  async createProject(name, path = null, sourceFolders = null, initReadme = true, options = {}) {
    const res = await request(`${API_BASE}/api/projects/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        path,
        source_folders: sourceFolders,
        init_readme: initReadme,
      }),
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to create project');
    }
    return res.json();
  },

  async switchProject(path, options = {}) {
    const res = await request(`${API_BASE}/api/projects/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to switch project');
    }
    return res.json();
  },

  async updateProject(projectId, updates, options = {}) {
    const res = await request(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, project_id: projectId }),
      ...requestSignal(options),
    }, projectId);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update project');
    }
    return res.json();
  },

  async deleteProject(projectId, options = {}) {
    const res = await request(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      ...requestSignal(options),
    }, projectId);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete project');
    }
    return res.json();
  },

  async pinProject(projectId, options = {}) {
    const res = await request(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/pin`, {
      method: 'POST',
      ...requestSignal(options),
    }, projectId);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to pin project');
    }
    return res.json();
  },

  async browseFolder(options = {}) {
    const res = await request(`${API_BASE}/api/world/browse-folder`, {
      method: 'POST',
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) throw new Error('Failed to open native folder dialog');
    return res.json();
  },

  async getWorkspaceFiles(query = '', options = {}) {
    const res = await request(`${API_BASE}/api/world/workspace-files?query=${encodeURIComponent(query)}`, requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to list workspace files');
    return res.json();
  },

  // ---------------------------------------------------------------------------
  // Settings Management
  // ---------------------------------------------------------------------------

  async getSettings(options = {}) {
    const res = await request(`${API_BASE}/api/settings`, requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to get settings');
    return res.json();
  },

  async updateSettings(settings, options = {}) {
    const res = await request(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, project_id: resolveProjectId(options.projectId) }),
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) throw new Error('Failed to update settings');
    return res.json();
  },

  // ---------------------------------------------------------------------------
  // Security Approval Response
  // ---------------------------------------------------------------------------

  async respondApproval(requestId, decision, grantScope, reason = '', options = {}) {
    const res = await request(`${API_BASE}/api/approval/respond`, {
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
    const url = `${API_BASE}/api/approval/pending${query ? `?${query}` : ''}`;
    const res = await request(
      url,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to list pending approvals');
    return res.json();
  },
};

/**
 * Creates a managed WebSocket connection to the Agent Gateway.
 */
export function createAgentWebSocket(onMessage, onOpen, onClose, getProjectId = () => activeProjectId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/agent`;

  let socket = null;
  let shouldReconnect = true;

  function connect() {
    const projectId = resolveProjectId(getProjectId?.());
    const separator = wsUrl.includes('?') ? '&' : '?';
    socket = new WebSocket(projectId ? `${wsUrl}${separator}project_id=${encodeURIComponent(projectId)}` : wsUrl);

    socket.onopen = () => {
      if (onOpen) onOpen();
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onMessage) onMessage(data);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    socket.onclose = () => {
      if (onClose) onClose();
      if (shouldReconnect) {
        setTimeout(connect, 2000);
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  connect();

  return {
    send(data) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        if (typeof data === 'string') {
          socket.send(data);
        } else {
          socket.send(JSON.stringify({
            ...data,
            project_id: data.project_id || data.projectId || resolveProjectId(getProjectId?.()),
          }));
        }
        return true;
      }
      return false;
    },
    isOpen() {
      return Boolean(socket && socket.readyState === WebSocket.OPEN);
    },
    close() {
      shouldReconnect = false;
      if (socket) socket.close();
    },
  };
}
