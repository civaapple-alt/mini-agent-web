import { request, requestSignal } from './request.js';

export const skillsApi = {
  async listSkills(options = {}) {
    const res = await request('/api/skills', requestSignal(options), options.projectId);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to load Skills');
    }
    return res.json();
  },
};
