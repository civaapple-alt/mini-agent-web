import { request, requestSignal } from './request.js';

export const webSearchApi = {
  async getWebSearchSettings(options = {}) {
    const res = await request('/api/web-search/settings', requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to load web search settings');
    return res.json();
  },

  async updateWebSearchSettings(settings, options = {}) {
    const res = await request(
      '/api/web-search/settings',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
        ...requestSignal(options),
      },
      options.projectId,
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail || 'Failed to update web search settings');
    }
    return res.json();
  },
};
