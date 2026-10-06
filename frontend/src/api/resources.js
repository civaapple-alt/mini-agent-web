import { request } from './request.js';

async function readResponse(response, fallback) {
  if (response.ok) return response.json();
  const body = await response.json().catch(() => ({}));
  const detail = typeof body.detail === 'string'
    ? body.detail
    : Array.isArray(body.detail?.blockers)
      ? body.detail.blockers.join('、')
      : fallback;
  throw new Error(detail || fallback);
}

export const resourceApi = {
  async snapshot(options = {}) {
    const response = await request('/api/resources', {
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return readResponse(response, '读取资源快照失败');
  },

  async history(processKey, options = {}) {
    const query = new URLSearchParams({ process_key: processKey });
    const response = await request(`/api/resources/history?${query}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return readResponse(response, '读取资源历史失败');
  },

  async park(threadId, projectId) {
    const response = await request(
      `/api/threads/${encodeURIComponent(threadId)}/park`,
      { method: 'POST' },
      projectId,
    );
    return readResponse(response, '休眠会话失败');
  },
};
