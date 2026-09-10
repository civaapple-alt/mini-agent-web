import { request, requestSignal, resolveProjectId } from './request.js';

export const worldApi = {
  async getWorldState(options = {}) {
    const res = await request('/api/world/state', requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to get world state');
    return res.json();
  },

  async refreshWorld(options = {}) {
    const res = await request(
      '/api/world/refresh',
      { method: 'POST', ...requestSignal(options) },
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to refresh world');
    return res.json();
  },

  async getMcpStatus(options = {}) {
    const res = await request('/api/mcp/status', requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to get MCP status');
    return res.json();
  },

  async retryMcp(options = {}) {
    const res = await request(
      '/api/mcp/retry',
      { method: 'POST', ...requestSignal(options) },
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to retry MCP');
    return res.json();
  },

  async setWorldExecution(access = 'project', policy = 'interactive', options = {}) {
    const res = await request(
      '/api/world/execution',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access, policy, project_id: resolveProjectId(options.projectId) }),
        ...requestSignal(options),
      },
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to set execution scope');
    return res.json();
  },

  async getWorldApproval(options = {}) {
    const params = new URLSearchParams();
    if (options.threadId) params.set('thread_id', options.threadId);
    const query = params.toString();
    const res = await request(
      `/api/world/approval${query ? `?${query}` : ''}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to inspect project approvals');
    return res.json();
  },

  async revokeWorldApprovals(options = {}) {
    const res = await request(
      '/api/world/approval/revoke',
      { method: 'POST', ...requestSignal(options) },
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to revoke project approvals');
    return res.json();
  },

  async getGitStatus(options = {}) {
    const res = await request('/api/world/git/status', requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to get git status');
    return res.json();
  },

  async browseFolder(options = {}) {
    const res = await request(
      '/api/world/browse-folder',
      { method: 'POST', ...requestSignal(options) },
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to open native folder dialog');
    return res.json();
  },

  async getWorkspaceFiles(query = '', options = {}) {
    const res = await request(
      `/api/world/workspace-files?query=${encodeURIComponent(query)}`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to list workspace files');
    return res.json();
  },
};
