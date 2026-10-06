import {
  cleanInputText,
  collectInputMessages,
  getChildWakeupTurnIds,
  getInputTrace,
} from './inputTrace.js';

export const TURN_STATE_LABELS = {
  running: '运行中',
  approval: '等待审批',
  stopping: '正在停止',
  plan_review: '等待确认',
  goal_paused: 'Goal 已暂停',
  completed: '已完成',
  failed: '运行失败',
  interrupted: '已中断',
  step_limit: '达到步数上限',
  unknown: '历史',
};

const TERMINAL_STATUS_MAP = {
  completed: 'completed',
  success: 'completed',
  failed: 'failed',
  error: 'failed',
  interrupted: 'interrupted',
  cancelled: 'interrupted',
  canceled: 'interrupted',
  step_limit: 'step_limit',
};

const INCOMPLETE_TURN_STATUSES = new Set([
  'failed',
  'error',
  'interrupted',
  'cancelled',
  'canceled',
  'step_limit',
  'in_progress',
]);

export function isIncompleteTurnStatus(value) {
  return INCOMPLETE_TURN_STATUSES.has(String(value || '').toLowerCase());
}

function normalizedTurnId(value) {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function timestampMilliseconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampForThreadItem(entry) {
  const item = entry?.item || {};
  return timestampMilliseconds(entry?.capturedAt || entry?.captured_at)
    ?? timestampMilliseconds(item.capturedAt || item.captured_at);
}

function timingForTurn({ message, messages, threadItems, turnId, lastTurnResult }) {
  if (!turnId) return { startedAtMs: null, durationMs: null };
  const matchingEntries = (threadItems || []).filter((entry) => (
    normalizedTurnId(entry?.turnId || entry?.turn_id) === turnId
  ));
  const matchingMessages = (messages || []).filter((candidate) => (
    normalizedTurnId(candidate?.turnId) === turnId
  ));
  const entryTimes = matchingEntries.map(timestampForThreadItem).filter(Number.isFinite);
  const messageTimes = matchingMessages
    .map((candidate) => timestampMilliseconds(candidate?.capturedAt || candidate?.inputTrace?.capturedAt))
    .filter(Number.isFinite);
  const persistedInputTimes = matchingEntries
    .filter((entry) => ['userMessage', 'user_message'].includes(String(entry?.item?.type || '').toLowerCase()))
    .map(timestampForThreadItem)
    .filter(Number.isFinite);
  const inputMessageTime = timestampMilliseconds(message?.inputTrace?.capturedAt || message?.capturedAt);
  const startedAtMs = persistedInputTimes.length > 0
    ? Math.min(...persistedInputTimes)
    : inputMessageTime ?? (entryTimes.length > 0 ? Math.min(...entryTimes) : null);
  const activityTimes = [...entryTimes, ...messageTimes].filter(Number.isFinite);
  const latestActivityAtMs = activityTimes.length > 0 ? Math.max(...activityTimes) : null;
  const resultTurnId = normalizedTurnId(lastTurnResult?.turnId || lastTurnResult?.turn_id);
  const rawResultDurationMs = lastTurnResult?.durationMs;
  const resultDurationMs = resultTurnId === turnId
    && rawResultDurationMs !== null
    && rawResultDurationMs !== undefined
    ? Number(rawResultDurationMs)
    : NaN;
  const durationMs = Number.isFinite(resultDurationMs) && resultDurationMs >= 0
    ? resultDurationMs
    : Number.isFinite(startedAtMs) && Number.isFinite(latestActivityAtMs) && latestActivityAtMs >= startedAtMs
      ? latestActivityAtMs - startedAtMs
      : null;
  return { startedAtMs, durationMs };
}

function statusFromValue(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase();
  if (normalized === 'approval' || normalized === 'waiting_approval') return 'approval';
  if (normalized === 'running' || normalized === 'active') return 'running';
  if (normalized === 'stopping' || normalized === 'cancelling') return 'stopping';
  return TERMINAL_STATUS_MAP[normalized] || null;
}

function explicitHistoricalStatus(message, threadItems, turnId) {
  const directStatus = statusFromValue(
    message?.turnStatus || message?.turn_status || message?.terminalStatus,
  );
  if (directStatus) return directStatus;

  const matchingItems = (threadItems || []).filter((entry) => (
    normalizedTurnId(entry?.turnId || entry?.turn_id) === turnId
  ));
  for (const entry of matchingItems) {
    const item = entry?.item || {};
    const type = String(item.type || entry?.type || '').toLowerCase();
    if (!type.includes('turn') || !type.includes('finish')) continue;
    const status = statusFromValue(
      entry?.turnStatus || entry?.turn_status || entry?.status
        || item.turnStatus || item.turn_status || item.status,
    );
    if (status) return status;
  }
  return 'unknown';
}

function boundedSummary(message) {
  const text = cleanInputText(message?.text);
  if (text) return text.length > 88 ? `${text.slice(0, 88).trim()}…` : text;
  if (message?.images?.length) return '（图片输入）';
  if (message?.textAttachments?.length) return '（文本附件）';
  if (message?.fileAttachments?.length) return '（文件输入）';
  return '（空输入）';
}

function boundedResponseSummary(messages, turnId) {
  const text = (messages || [])
    .filter((message) => message?.role === 'assistant')
    .filter((message) => normalizedTurnId(message.turnId) === turnId)
    .flatMap((message) => {
      if (message.text) return [message.text];
      return (message.blocks || [])
        .filter((block) => block?.type === 'text' && block.content)
        .map((block) => block.content);
    })
    .map((value) => cleanInputText(value))
    .filter(Boolean)
    .at(-1) || '';
  return text.length > 140 ? `${text.slice(0, 140).trim()}…` : text;
}

function blocksForTurn(messages, turnId) {
  return (messages || [])
    .filter((message) => message?.role === 'assistant')
    .filter((message) => normalizedTurnId(message.turnId) === turnId)
    .flatMap((message) => {
      if (Array.isArray(message.blocks) && message.blocks.length > 0) return message.blocks;
      return [
        ...(message.thinking ? [{ type: 'thinking', content: message.thinking }] : []),
        ...(Array.isArray(message.tools) ? message.tools : [])
          .map((tool) => ({ type: 'tool', ...tool })),
      ];
    });
}

function metricsForTurn(messages, turnId, lastTurnResult) {
  const blocks = blocksForTurn(messages, turnId);
  const tools = blocks.filter((block) => block.type === 'tool');
  const thinking = blocks.filter((block) => block.type === 'thinking');
  const shellCount = tools.filter((block) => (
    /^(shell|bash|powershell|exec|run_command)$/i.test(String(block.name || block.toolName || ''))
  )).length;
  const resultTurnId = normalizedTurnId(lastTurnResult?.turnId || lastTurnResult?.turn_id);
  const steps = resultTurnId === turnId && Number.isFinite(Number(lastTurnResult?.steps))
    ? Number(lastTurnResult.steps)
    : null;
  const durationMs = resultTurnId === turnId && Number.isFinite(Number(lastTurnResult?.durationMs))
    ? Number(lastTurnResult.durationMs)
    : null;
  return {
    steps,
    toolCount: tools.length,
    shellCount,
    thinkingCount: thinking.length,
    durationMs,
  };
}

function actionHint(state, statusModel, isCurrent) {
  if (!isCurrent) return null;
  if (statusModel?.nextAction) return statusModel.nextAction;
  if (state === 'approval') return '请处理审批';
  if (state === 'failed') return '打开详情查看失败原因';
  if (state === 'interrupted' || state === 'step_limit') return '可继续发送指令';
  return null;
}

function stateForTurn({ turnId, activeTurnId, statusModel, lastTurnResult, message, threadItems }) {
  const currentId = normalizedTurnId(activeTurnId || statusModel?.scope?.turnId);
  if (currentId && currentId === turnId) {
    return statusModel?.lifecycle === 'idle' ? 'running' : statusModel.lifecycle;
  }
  const resultTurnId = normalizedTurnId(lastTurnResult?.turnId || lastTurnResult?.turn_id);
  if (resultTurnId && resultTurnId === turnId) {
    return statusFromValue(lastTurnResult.status || lastTurnResult.stopReason) || 'unknown';
  }
  return explicitHistoricalStatus(message, threadItems, turnId);
}

/**
 * Build the bounded, read-only projection used by the Session Turn rail and
 * inline activity summaries. It never turns an assistant message into a
 * completed Turn without explicit terminal evidence.
 */
export function buildTurnHistoryEntries({
  messages = [],
  threadItems = [],
  scope = {},
  statusModel = null,
  activeTurnId = null,
  lastTurnResult = null,
} = {}) {
  const inputs = collectInputMessages(messages, threadItems, scope);
  const childWakeupTurnIds = getChildWakeupTurnIds(messages, threadItems);
  const inputTurnIds = new Set(inputs.map((message) => normalizedTurnId(message.turnId)).filter(Boolean));
  const assistantMessageByTurnId = new Map();
  messages.forEach((message) => {
    const turnId = normalizedTurnId(message?.turnId);
    if (turnId && message.role === 'assistant' && !assistantMessageByTurnId.has(turnId)) {
      assistantMessageByTurnId.set(turnId, message);
    }
  });
  const projectedInputs = inputs.map((message, index) => ({
    message,
    index,
    childWakeup: false,
    order: timelineOrder(message, messages, threadItems, index),
  }));
  [...childWakeupTurnIds].forEach((turnId, index) => {
    if (inputTurnIds.has(turnId)) return;
    const sourceMessage = assistantMessageByTurnId.get(turnId);
    projectedInputs.push({
      message: {
        id: sourceMessage?.id || `turn_${turnId}`,
        role: 'assistant',
        turnId,
        text: '',
        turnSource: 'child_wakeup',
      },
      index: inputs.length + index,
      childWakeup: true,
      order: timelineOrder({ turnId, id: sourceMessage?.id }, messages, threadItems, inputs.length + index),
    });
  });
  projectedInputs.sort((left, right) => left.order - right.order || left.index - right.index);
  const turnInputs = [];
  const seenTurns = new Set();
  projectedInputs.forEach((input) => {
    const turnId = normalizedTurnId(input.message.turnId);
    const key = turnId || `message:${input.message.id || input.index}`;
    if (seenTurns.has(key)) return;
    seenTurns.add(key);
    turnInputs.push(input);
  });
  const currentId = normalizedTurnId(activeTurnId || statusModel?.scope?.turnId);
  return turnInputs.map(({ message, index, childWakeup }) => {
    const trace = getInputTrace(message, scope);
    const turnId = normalizedTurnId(message.turnId || trace.scope?.turnId);
    const isCurrent = Boolean(currentId && turnId && currentId === turnId);
    const state = stateForTurn({
      turnId,
      activeTurnId,
      statusModel,
      lastTurnResult,
      message,
      threadItems,
    });
    const timing = timingForTurn({ message, messages, threadItems, turnId, lastTurnResult });
    return {
      id: `turn:${turnId || message.id || index}`,
      messageId: message.id || `input_${index}`,
      turnId,
      summary: childWakeup ? '子代理更新' : boundedSummary(message),
      source: childWakeup ? 'child_wakeup' : trace.source || 'user',
      state,
      stateLabel: TURN_STATE_LABELS[state] || TURN_STATE_LABELS.unknown,
      isCurrent,
      startedAtMs: timing.startedAtMs,
      durationMs: timing.durationMs,
      responseSummary: boundedResponseSummary(messages, turnId),
      metrics: metricsForTurn(messages, turnId, lastTurnResult),
      actionHint: actionHint(state, statusModel, isCurrent),
    };
  });
}

function timelineOrder(message, messages, threadItems, fallbackIndex) {
  const turnId = normalizedTurnId(message?.turnId);
  const itemIndex = (threadItems || []).findIndex((entry) => (
    normalizedTurnId(entry?.turnId || entry?.turn_id) === turnId
  ));
  if (itemIndex !== -1) return itemIndex;
  const messageIndex = (messages || []).findIndex((candidate) => (
    (message?.id && candidate?.id === message.id)
    || (turnId && normalizedTurnId(candidate?.turnId) === turnId)
  ));
  return (threadItems || []).length + (messageIndex === -1 ? fallbackIndex : messageIndex);
}

export function formatDuration(durationMs) {
  if (!Number.isFinite(Number(durationMs)) || Number(durationMs) < 0) return null;
  const totalSeconds = Math.round(Number(durationMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

export function blocksCanBeGrouped(blocks) {
  return (blocks || []).filter((block) => {
    const status = String(block.status || '').toLowerCase();
    const outcome = String(block.outcome || '').toLowerCase();
    if (block.type === 'thinking') {
      return !block.isStreaming
        && !block.error
        && !['running', 'inprogress', 'pending', 'queued', 'failed', 'error'].includes(status)
        && !['failed', 'error', 'needs_approval', 'deferred'].includes(outcome);
    }
    if (block.type !== 'tool') return false;
    const approvalState = String(block.approval?.state || '').toLowerCase();
    const name = String(block.name || block.toolName || block.tool || '').toLowerCase();
    const hasOutcome = block.outcome !== null
      && block.outcome !== undefined
      && (typeof block.outcome !== 'string' || block.outcome.trim() !== '');
    const isFailure = isFailedToolBlock(block);
    const hasKnownOutcome = !hasOutcome
      || ['completed', 'success', 'failed', 'error', 'retryable'].includes(outcome);
    const isSettled = ['completed', 'success', 'failed', 'error'].includes(status);
    return isSettled
      && name !== 'delegate_task'
      && !block.isStreaming
      && (isFailure || hasKnownOutcome)
      && (isFailure || !block.error)
      && !block.approval
      && !['needs_approval', 'deferred'].includes(outcome)
      && !['pending', 'denied', 'expired'].includes(approvalState);
  });
}

function isFailedToolBlock(block) {
  if (block?.type !== 'tool') return false;
  const status = String(block.status || '').toLowerCase();
  const outcome = String(block.outcome || '').toLowerCase();
  return Boolean(block.error)
    || ['failed', 'error'].includes(status)
    || ['failed', 'error', 'retryable'].includes(outcome);
}

function activityGroup(items, index = 0) {
  const failureCounts = new Map();
  for (const item of items) {
    if (!isFailedToolBlock(item)) continue;
    const name = String(item.name || item.toolName || item.tool || 'tool');
    failureCounts.set(name, (failureCounts.get(name) || 0) + 1);
  }

  const failureTypes = [...failureCounts].map(([name, count]) => ({ name, count }));
  return {
    type: 'activityGroup',
    id: `activity_${items[0]?.id || index}`,
    items,
    failureCount: failureTypes.reduce((total, item) => total + item.count, 0),
    failureTypes,
  };
}

/** Group adjacent settled activity and keep failure details in the summary. */
export function groupSettledAssistantBlocks(blocks = []) {
  const grouped = [];
  let pending = [];
  const flush = () => {
    if (pending.length > 0) {
      grouped.push(activityGroup(pending, grouped.length));
      pending = [];
    }
  };
  for (const block of blocks) {
    if (blocksCanBeGrouped([block]).length > 0) {
      pending.push(block);
    } else {
      flush();
      grouped.push(block);
    }
  }
  flush();
  return grouped;
}
