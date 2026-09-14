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

function normalizeFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .filter((file) => typeof file === 'string' && file.trim())
    .slice(0, MAX_REFERENCED_FILES)
    .map((file) => file.trim().slice(0, MAX_FILE_PATH_LENGTH));
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
  images = [],
  referencedFiles = [],
  historical = false,
  attachmentsKnown = true,
} = {}) {
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
      known: Boolean(attachmentsKnown),
      imageCount: Array.isArray(images) ? images.length : 0,
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
      || Object.prototype.hasOwnProperty.call(message, 'referencedFiles')),
  );
  return createInputTrace({
    threadId: scope.threadId || null,
    projectId: scope.projectId || null,
    turnId: message?.turnId || null,
    source: sourceForMessage(message),
    images: message?.images,
    referencedFiles: message?.referencedFiles,
    historical: true,
    attachmentsKnown: hasAttachmentFields,
  });
}

export function getInputTraceSourceLabel(source) {
  return INPUT_TRACE_SOURCE_LABELS[source] || '输入';
}

export function collectInputMessages(messages = []) {
  return messages.filter((message) => message?.role === 'user');
}
