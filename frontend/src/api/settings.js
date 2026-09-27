import { request, requestSignal } from './request.js';

export const settingsApi = {
  async getSettings(options = {}) {
    const res = await request('/api/settings', requestSignal(options));
    if (!res.ok) throw new Error('Failed to get settings');
    return res.json();
  },

  async updateSettings(settings, options = {}) {
    const res = await request('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
      ...requestSignal(options),
    });
    if (!res.ok) throw new Error('Failed to update settings');
    return res.json();
  },
};
