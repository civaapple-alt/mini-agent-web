/**
 * API and WebSocket client for Mini Agent Web Backend.
 */

const API_BASE = '';

export const api = {
  // ---------------------------------------------------------------------------
  // Thread Management
  // ---------------------------------------------------------------------------

  async listThreads() {
    const res = await fetch(`${API_BASE}/api/threads`);
    if (!res.ok) throw new Error('Failed to list threads');
    return res.json();
  },

  async startThread(threadId = 'default', title = null, project = null) {
    const res = await fetch(`${API_BASE}/api/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, title, project }),
    });
    if (!res.ok) throw new Error('Failed to start thread');
    return res.json();
  },

  async forkThread(sourceThreadId, newThreadId, title = null) {
    const res = await fetch(`${API_BASE}/api/threads/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_thread_id: sourceThreadId,
        new_thread_id: newThreadId,
        title,
      }),
    });
    if (!res.ok) throw new Error('Failed to fork thread');
    return res.json();
  },

  async readThread(threadId) {
    const res = await fetch(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}`);
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
    const res = await fetch(
      `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/items${query ? `?${query}` : ''}`
    );
    if (!res.ok) throw new Error(`Failed to list items for thread ${threadId}`);
    return res.json();
  },

  async renameThread(threadId, title) {
    const res = await fetch(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error(`Failed to rename thread ${threadId}`);
    return res.json();
  },

  async updateThreadSummary(threadId, summary) {
    const res = await fetch(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}/summary`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary }),
    });
    if (!res.ok) throw new Error(`Failed to update summary for ${threadId}`);
    return res.json();
  },

  async closeThread(threadId) {
    const res = await fetch(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}/close`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`Failed to close thread ${threadId}`);
    return res.json();
  },

  // ---------------------------------------------------------------------------
  // World Governance & MCP
  // ---------------------------------------------------------------------------

  async getWorldState() {
    const res = await fetch(`${API_BASE}/api/world/state`);
    if (!res.ok) throw new Error('Failed to get world state');
    return res.json();
  },

  async refreshWorld() {
    const res = await fetch(`${API_BASE}/api/world/refresh`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to refresh world');
    return res.json();
  },

  async getMcpStatus() {
    const res = await fetch(`${API_BASE}/api/mcp/status`);
    if (!res.ok) throw new Error('Failed to get MCP status');
    return res.json();
  },

  async retryMcp() {
    const res = await fetch(`${API_BASE}/api/mcp/retry`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to retry MCP');
    return res.json();
  },

  async setWorldExecution(access = 'project', approval = 'per_action') {
    const res = await fetch(`${API_BASE}/api/world/execution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access, approval }),
    });
    if (!res.ok) throw new Error('Failed to set execution scope');
    return res.json();
  },

  // ---------------------------------------------------------------------------
  // Workflows (Plan Mode & Goals) & Files
  // ---------------------------------------------------------------------------

  async getWorkflowState(threadId = null) {
    const url = threadId
      ? `${API_BASE}/api/workflows/state?thread_id=${encodeURIComponent(threadId)}`
      : `${API_BASE}/api/workflows/state`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to get workflow state');
    return res.json();
  },

  async updateThreadSettings(mode, builtinTools = null, threadId = 'default') {
    const targetThread = threadId || 'default';
    const res = await fetch(`${API_BASE}/api/threads/${encodeURIComponent(targetThread)}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, builtin_tools: builtinTools }),
    });
    if (!res.ok) throw new Error('Failed to update thread settings');
    return res.json();
  },

  async setCollaborationMode(mode, threadId = null) {
    return this.updateThreadSettings(mode, null, threadId);
  },

  async setGoal(objective, tokenBudget = null, status = null, threadId = 'default') {
    const targetThread = threadId || 'default';
    const res = await fetch(`${API_BASE}/api/threads/${encodeURIComponent(targetThread)}/goal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objective,
        token_budget: tokenBudget,
        status,
      }),
    });
    if (!res.ok) throw new Error('Failed to set goal');
    return res.json();
  },

  async getGoal(threadId = 'default') {
    const url = `${API_BASE}/api/threads/${encodeURIComponent(threadId || 'default')}/goal`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to get goal');
    return res.json();
  },

  async clearGoal(threadId = 'default') {
    const url = `${API_BASE}/api/threads/${encodeURIComponent(threadId || 'default')}/goal`;
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to clear goal');
    return res.json();
  },

  async getWorkflowFiles() {
    const res = await fetch(`${API_BASE}/api/workflows/files`);
    if (!res.ok) throw new Error('Failed to list workflow files');
    return res.json();
  },

  async getWorkflowFileContent(path) {
    const res = await fetch(`${API_BASE}/api/workflows/file/content?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(`Failed to read file content for ${path}`);
    return res.json();
  },

  async getGitStatus() {
    const res = await fetch(`${API_BASE}/api/world/git/status`);
    if (!res.ok) throw new Error('Failed to get git status');
    return res.json();
  },

  // ---------------------------------------------------------------------------
  // Projects & Workspace Management
  // ---------------------------------------------------------------------------

  async listProjects() {
    const res = await fetch(`${API_BASE}/api/projects`);
    if (!res.ok) throw new Error('Failed to list projects');
    return res.json();
  },

  async createProject(name, path = null, sourceFolders = null, initReadme = true) {
    const res = await fetch(`${API_BASE}/api/projects/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        path,
        source_folders: sourceFolders,
        init_readme: initReadme,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to create project');
    }
    return res.json();
  },

  async switchProject(path) {
    const res = await fetch(`${API_BASE}/api/projects/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to switch project');
    }
    return res.json();
  },

  async updateProject(projectId, updates) {
    const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update project');
    }
    return res.json();
  },

  async deleteProject(projectId) {
    const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete project');
    }
    return res.json();
  },

  async pinProject(projectId) {
    const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/pin`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to pin project');
    }
    return res.json();
  },

  async browseFolder() {
    const res = await fetch(`${API_BASE}/api/world/browse-folder`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to open native folder dialog');
    return res.json();
  },

  async getWorkspaceFiles(query = '') {
    const res = await fetch(`${API_BASE}/api/world/workspace-files?query=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Failed to list workspace files');
    return res.json();
  },

  // ---------------------------------------------------------------------------
  // Settings Management
  // ---------------------------------------------------------------------------

  async getSettings() {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (!res.ok) throw new Error('Failed to get settings');
    return res.json();
  },

  async updateSettings(settings) {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('Failed to update settings');
    return res.json();
  },

  // ---------------------------------------------------------------------------
  // Security Approval Response
  // ---------------------------------------------------------------------------

  async respondApproval(requestId, decision, access, approval, reason = '') {
    const res = await fetch(`${API_BASE}/api/approval/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: requestId,
        decision,
        access,
        approval,
        reason,
      }),
    });
    if (!res.ok) throw new Error('Failed to respond approval');
    return res.json();
  },
};

/**
 * Creates a managed WebSocket connection to the Agent Gateway.
 */
export function createAgentWebSocket(onMessage, onOpen, onClose) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/agent`;

  let socket = null;
  let shouldReconnect = true;

  function connect() {
    socket = new WebSocket(wsUrl);

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
        socket.send(typeof data === 'string' ? data : JSON.stringify(data));
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
