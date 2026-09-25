import { request, requestSignal } from './request.js';

export const modelApi = {
  async getModelCatalog(options = {}) {
    const res = await request('/api/models', requestSignal(options), options.projectId);
    if (!res.ok) throw new Error('Failed to load model catalog');
    return res.json();
  },

  async manageModelCatalog(operation, fields = {}, options = {}) {
    const res = await request(
      '/api/models/manage',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, ...fields }),
        ...requestSignal(options),
      },
      options.projectId,
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail || 'Failed to update model catalog');
    }
    return res.json();
  },

  async updateThreadModelSettings(threadId, modelSelection, reasoningSelection, options = {}) {
    const target = threadId || 'default';
    const res = await request(
      `/api/threads/${encodeURIComponent(target)}/settings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_selection: modelSelection,
          reasoning_selection: reasoningSelection,
        }),
        ...requestSignal(options),
      },
      options.projectId,
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail || 'Failed to update Thread model');
    }
    return res.json();
  },

  async getThreadModelSettings(threadId, options = {}) {
    const target = threadId || 'default';
    const res = await request(
      `/api/threads/${encodeURIComponent(target)}/model-settings`,
      requestSignal(options),
      options.projectId,
    );
    if (!res.ok) throw new Error('Failed to load Thread model settings');
    return res.json();
  },
};
