export function parseActivityTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function compareThreadActivity(a, b) {
  const timeA = parseActivityTime(a.updated_at);
  const timeB = parseActivityTime(b.updated_at);

  if (timeA === null && timeB !== null) return 1;
  if (timeA !== null && timeB === null) return -1;
  if (timeA !== null && timeB !== null && timeA !== timeB) {
    return timeB - timeA;
  }

  return String(a.thread_id || '').localeCompare(String(b.thread_id || ''));
}

export function formatRelativeTime(value, now = Date.now()) {
  const timestamp = parseActivityTime(value);
  if (timestamp === null) return '时间未知';

  const elapsedMs = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsedMs / 60_000);
  const hours = Math.floor(elapsedMs / 3_600_000);
  const days = Math.floor(elapsedMs / 86_400_000);

  if (minutes < 1) return '刚刚';
  if (hours < 1) return `${minutes} 分钟前`;
  if (days < 1) return `${hours} 小时前`;
  return `${days} 天前`;
}
