const subscribers = new Map();

function scopeKey(projectId, threadId) {
  return JSON.stringify([projectId || null, threadId || null]);
}

export function subscribeChildRuntimeEvents(projectId, threadId, handler) {
  if (!threadId || typeof handler !== 'function') return () => {};

  const key = scopeKey(projectId, threadId);
  const handlers = subscribers.get(key) || new Set();
  handlers.add(handler);
  subscribers.set(key, handlers);

  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) subscribers.delete(key);
  };
}

export function publishChildRuntimeEvent(data) {
  if (data?.type !== 'event') return;

  const nested = data.data && typeof data.data === 'object' ? data.data : {};
  const threadId = data.threadId || data.thread_id || nested.threadId || nested.thread_id;
  if (!threadId) return;
  const projectId = data.projectId || data.project_id || nested.projectId || nested.project_id || null;
  const handlers = subscribers.get(scopeKey(projectId, threadId));
  if (!handlers) return;

  for (const handler of handlers) {
    try {
      handler(data);
    } catch (error) {
      console.debug('Child runtime event observer failed:', error);
    }
  }
}
