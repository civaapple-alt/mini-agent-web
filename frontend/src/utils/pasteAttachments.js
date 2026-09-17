export const MAX_PASTED_TEXT_ATTACHMENTS = 4;
export const MAX_PASTED_TEXT_ATTACHMENT_BYTES = 128 * 1024;

const DIAGNOSTIC_LINE_PATTERN = /^\s*(?:INFO|DEBUG|WARN(?:ING)?|ERROR|FATAL|Traceback|Caused by:|Exception|at\s+|File\s+["']|PS\s+[A-Z]:[\\/])/im;

export function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value || '')).length;
}

/**
 * Keep ordinary short pastes in the composer, while moving likely logs and
 * long diagnostics into a bounded temporary text attachment.
 */
export function shouldCapturePastedText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  const lineCount = value.split(/\r?\n/).length;
  return (
    lineCount >= 6
    || value.length >= 1200
    || DIAGNOSTIC_LINE_PATTERN.test(value)
  );
}

export function createPastedTextAttachment(content, index = 0) {
  const suffix = index > 0 ? `-${index + 1}` : '';
  return {
    id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: `pasted-text${suffix}.txt`,
    content: String(content || ''),
    size: utf8ByteLength(content),
  };
}

export function normalizeTextAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => (
      item
      && typeof item === 'object'
      && typeof item.content === 'string'
      && item.content.trim()
      && utf8ByteLength(item.content) <= MAX_PASTED_TEXT_ATTACHMENT_BYTES
    ))
    .slice(0, MAX_PASTED_TEXT_ATTACHMENTS)
    .map((item, index) => ({
      id: item.id || `text_${Date.now()}_${index}`,
      name: String(item.name || `pasted-text${index ? `-${index + 1}` : ''}.txt`)
        .replaceAll('\\', '_')
        .replaceAll('/', '_')
        .replaceAll('[', '_')
        .replaceAll(']', '_')
        .trim()
        .slice(0, 120) || 'pasted-text.txt',
      content: item.content,
      size: Number.isFinite(item.size) ? item.size : utf8ByteLength(item.content),
    }));
}
