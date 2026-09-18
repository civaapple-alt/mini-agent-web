export const AUTO_THREAD_TITLE_MAX_CHARS = 32;

export function isDefaultThreadTitle(title, threadId) {
  const normalizedTitle = String(title || '').trim();
  const normalizedThreadId = String(threadId || '').trim();

  if (!normalizedTitle) return true;
  if (['默认会话', '默认会话 (Default Session)'].includes(normalizedTitle)) {
    return true;
  }
  if (!normalizedThreadId) return false;

  return [
    normalizedThreadId,
    `会话 ${normalizedThreadId}`,
    `新会话 ${normalizedThreadId}`,
  ].includes(normalizedTitle);
}

export function buildAutoThreadTitle(prompt, maxChars = AUTO_THREAD_TITLE_MAX_CHARS) {
  const normalizedPrompt = String(prompt || '').replace(/\s+/gu, ' ').trim();
  if (!normalizedPrompt) return '';

  const characters = Array.from(normalizedPrompt);
  if (characters.length <= maxChars) return normalizedPrompt;
  return `${characters.slice(0, maxChars).join('').trimEnd()}…`;
}
