import { request, requestSignal } from './request.js';

export const projectApi = {
  async listProjects(options = {}) {
    const res = await request('/api/projects', requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to list projects');
    return res.json();
  },

  async createProject(name, path = null, sourceFolders = null, initReadme = true, options = {}) {
    const res = await request('/api/projects/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path, source_folders: sourceFolders, init_readme: initReadme }),
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to create project');
    }
    return res.json();
  },

  async switchProject(path, options = {}) {
    const res = await request('/api/projects/switch', {
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
    const res = await request(
      `/api/projects/${encodeURIComponent(projectId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updates, project_id: projectId }),
        ...requestSignal(options),
      },
      projectId,
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to update project');
    }
    return res.json();
  },

  async deleteProject(projectId, options = {}) {
    const res = await request(
      `/api/projects/${encodeURIComponent(projectId)}`,
      { method: 'DELETE', ...requestSignal(options) },
      projectId,
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to delete project');
    }
    return res.json();
  },

  async pinProject(projectId, options = {}) {
    const res = await request(
      `/api/projects/${encodeURIComponent(projectId)}/pin`,
      { method: 'POST', ...requestSignal(options) },
      projectId,
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to pin project');
    }
    return res.json();
  },
};
