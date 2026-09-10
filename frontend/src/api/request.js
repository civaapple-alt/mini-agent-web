const API_BASE = '';

let activeProjectId = null;

/** Set the routing context used by every subsequent REST/WS request. */
export function setActiveProjectId(projectId) {
  activeProjectId = projectId || null;
}

export function resolveProjectId(projectId) {
  return projectId || activeProjectId;
}

export function request(url, options = {}, projectId = null) {
  const resolvedProjectId = resolveProjectId(projectId);
  if (!resolvedProjectId) return fetch(`${API_BASE}${url}`, options);
  const separator = url.includes('?') ? '&' : '?';
  return fetch(
    `${API_BASE}${url}${separator}project_id=${encodeURIComponent(resolvedProjectId)}`,
    options,
  );
}

export function requestSignal(options) {
  return options?.signal ? { signal: options.signal } : {};
}
