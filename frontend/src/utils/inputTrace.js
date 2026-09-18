const MAX_REFERENCED_FILES = 12;
const MAX_FILE_PATH_LENGTH = 160;

export const INPUT_TRACE_SOURCE_LABELS = {
  user: '用户输入',
  steer: '实时纠偏',
  goal: 'Goal 目标',
};

export const INPUT_TRACE_ACCESS_LABELS = {
  project: '项目范围',
  full_machine: '完全访问',
};

export const INPUT_TRACE_POLICY_LABELS = {
  interactive: '交互批准',
  automatic: '自动低风险',
  trusted: '信任执行',
};

export const INPUT_TRACE_CONTINUATION_LABELS = {
  manual: '手动推进',
  continuous: '连续执行',
};

export const COMPACTED_CONTEXT_PREFIX = '[Compacted conversation context]';

/**
 * Compaction summaries are synthetic user-role messages for the next model
 * context, not user submissions. Keep them out of input history and the Turn
 * rail; the structured context-compaction item owns their visible projection.
 */
export function isInternalCompactionMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (message.type === 'contextCompaction' || message.type === 'context_compaction') {
    return true;
  }
  if (message.messageKind === 'context_compaction' || message.itemKind === 'context_compaction') {
    return true;
  }
  return String(message.text || '').trim().startsWith(COMPACTED_CONTEXT_PREFIX);
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .filter((file) => typeof file === 'string' && file.trim())
    .slice(0, MAX_REFERENCED_FILES)
    .map((file) => file.trim().slice(0, MAX_FILE_PATH_LENGTH));
}

function summarizeAttachmentText(text) {
  const value = String(text || '');
  return {
    imageCount: (value.match(/\[User Attached Image:/g) || []).length,
    textCount: (value.match(/\[User Attached Text:/g) || []).length,
    fileCount: (value.match(/\[User Attached (?:File|Path):/g) || []).length,
  };
}

export function extractTextAttachmentNames(text) {
  const value = String(text || '');
  return [...value.matchAll(/\[User Attached Text:\s*([^\]]+)\]/g)]
    .map((match) => {
      const named = match[1].match(/\(name:\s*([^;)]+)(?:;|\))/);
      if (named?.[1]) return named[1].trim();
      const path = match[1].split(' (')[0].trim();
      return path.split(/[\\/]/).pop() || 'pasted-text.txt';
    })
    .filter(Boolean);
}

export function extractFileAttachmentNames(text) {
  const value = String(text || '');
  return [...value.matchAll(/\[User Attached (?:File|Path):\s*([^\]]+)\]/g)]
    .map((match) => {
      const named = match[1].match(/\(name:\s*([^;)]+)(?:;|\))/);
      if (named?.[1]) return named[1].trim();
      const path = match[1].split(' (')[0].trim();
      return path.split(/[\\/]/).pop() || 'attachment';
    })
    .filter(Boolean);
}

export function cleanInputText(text) {
  return String(text || '')
    .replace(/\s*\[User Attached Image:[^\]]+\]/g, '')
    .replace(/\s*\[User Attached Text:[^\]]+\]/g, '')
    .replace(/\s*\[User Attached (?:File|Path):[^\]]+\]/g, '')
    .replace(/\s*\[User Referenced Files:[^\]]+\]/g, '')
    .trim();
}

function sourceForMessage(message) {
  if (message?.isSteer || message?.messageKind === 'steer') return 'steer';
  if (message?.isGoal || message?.messageKind === 'goal') return 'goal';
  return 'user';
}

/**
 * Create bounded presentation metadata for a user input.
 *
 * The prompt itself remains on the canonical message. This object only
 * records the scope and settings observed when the live input was submitted.
 * Historical projections intentionally use execution: null when that metadata
 * was not persisted by the Session protocol.
 */
export function createInputTrace({
  threadId = null,
  projectId = null,
  turnId = null,
  source = 'user',
  capturedAt = null,
  accessScope = null,
  policy = null,
  continuationMode = null,
  planActive = false,
  goalActive = false,
  images = null,
  textAttachments = null,
  fileAttachments = null,
  referencedFiles = [],
  attachmentText = '',
  historical = false,
  attachmentsKnown = true,
} = {}) {
  const attachmentSummary = summarizeAttachmentText(attachmentText);
  const imageCount = Array.isArray(images)
    ? images.length
    : attachmentSummary.imageCount;
  const textCount = Array.isArray(textAttachments)
    ? textAttachments.length
    : attachmentSummary.textCount;
  const fileCount = Array.isArray(fileAttachments)
    ? fileAttachments.length
    : attachmentSummary.fileCount;
  return {
    scope: {
      projectId: projectId || null,
      threadId: threadId || null,
      turnId: turnId || null,
    },
    source,
    capturedAt: capturedAt || null,
    historical: Boolean(historical),
    execution: historical
      ? null
      : {
        accessScope: accessScope || null,
        policy: policy || null,
        continuationMode: continuationMode || null,
        planActive: Boolean(planActive),
        goalActive: Boolean(goalActive),
      },
    attachments: {
      known: Boolean(attachmentsKnown || imageCount > 0 || textCount > 0 || fileCount > 0),
      imageCount,
      textCount,
      fileCount,
      referencedFiles: normalizeFiles(referencedFiles),
    },
  };
}

/**
 * Project a message into trace metadata without inventing historical data.
 */
export function getInputTrace(message, scope = {}) {
  if (message?.inputTrace) return message.inputTrace;

  const hasAttachmentFields = Boolean(
    message && (Object.prototype.hasOwnProperty.call(message, 'images')
      || Object.prototype.hasOwnProperty.call(message, 'referencedFiles')
      || Object.prototype.hasOwnProperty.call(message, 'textAttachments')
      || Object.prototype.hasOwnProperty.call(message, 'fileAttachments')),
  );
  return createInputTrace({
    threadId: scope.threadId || null,
    projectId: scope.projectId || null,
    turnId: message?.turnId || null,
    source: sourceForMessage(message),
    images: message?.images,
    textAttachments: message?.textAttachments,
    fileAttachments: message?.fileAttachments,
    referencedFiles: message?.referencedFiles,
    attachmentText: message?.text,
    historical: true,
    attachmentsKnown: hasAttachmentFields
      || summarizeAttachmentText(message?.text).imageCount > 0
      || summarizeAttachmentText(message?.text).textCount > 0
      || summarizeAttachmentText(message?.text).fileCount > 0,
  });
}

export function getInputTraceSourceLabel(source) {
  return INPUT_TRACE_SOURCE_LABELS[source] || '输入';
}

function entryTurnId(entry) {
  return entry?.turnId || entry?.turn_id || null;
}

function entryInputMessage(entry, index, scope) {
  const item = entry?.item || {};
  const turnId = entryTurnId(entry);
  return {
    id: item.id || `history_item_${index}`,
    role: 'user',
    text: cleanInputText(item.text),
    textAttachments: extractTextAttachmentNames(item.text).map((name) => ({ name })),
    fileAttachments: extractFileAttachmentNames(item.text).map((name) => ({ name })),
    turnId,
    inputTrace: createInputTrace({
      threadId: scope.threadId || null,
      projectId: scope.projectId || null,
      turnId,
      source: 'user',
      capturedAt: entry.capturedAt || entry.captured_at || null,
      attachmentText: item.text,
      historical: true,
      attachmentsKnown: summarizeAttachmentText(item.text).imageCount > 0
        || summarizeAttachmentText(item.text).textCount > 0
        || summarizeAttachmentText(item.text).fileCount > 0,
    }),
  };
}

/**
 * Merge checkpoint messages with the durable item projection.
 *
 * Checkpoints can be compacted or bounded, while item projections retain the
 * user-message history. Existing messages win so live attachment metadata is
 * not replaced by the deliberately smaller historical projection.
 */
export function collectInputMessages(messages = [], entries = [], scope = {}) {
  const existing = messages.filter((message) => (
    message?.role === 'user' && !isInternalCompactionMessage(message)
  ));
  const used = new Set();
  const result = [];
  const inputEntries = (entries || []).filter((entry) => (
    (entry?.item?.type === 'userMessage' || entry?.item?.type === 'user_message')
    && !isInternalCompactionMessage(entry.item)
  ));

  for (const [index, entry] of inputEntries.entries()) {
    const turnId = entryTurnId(entry);
    const itemText = cleanInputText(entry.item?.text);
    const matchIndex = existing.findIndex((message, messageIndex) => {
      if (used.has(messageIndex)) return false;
      if (turnId && message.turnId) return turnId === message.turnId;
      return itemText && String(message.text || '').trim() === itemText;
    });
    if (matchIndex >= 0) {
      used.add(matchIndex);
      result.push(existing[matchIndex]);
    } else {
      result.push(entryInputMessage(entry, index, scope));
    }
  }

  existing.forEach((message, index) => {
    if (!used.has(index)) result.push(message);
  });
  return result;
}
