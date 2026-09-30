import { request, requestSignal } from './request.js';

export const skillsApi = {
  async listSkills(options = {}) {
    const query = options.threadId
      ? `?thread_id=${encodeURIComponent(options.threadId)}`
      : '';
    const res = await request(`/api/skills${query}`, requestSignal(options), options.projectId);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to load Skills');
    }
    return res.json();
  },
};
