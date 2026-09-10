import { request, requestSignal, resolveProjectId } from './request.js';

export const settingsApi = {
  async getSettings(options = {}) {
    const res = await request('/api/settings', requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to get settings');
    return res.json();
  },

  async updateSettings(settings, options = {}) {
    const res = await request('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, project_id: resolveProjectId(options.projectId) }),
      ...requestSignal(options),
    }, options.projectId);
    if (!res.ok) throw new Error('Failed to update settings');
    return res.json();
  },
};
