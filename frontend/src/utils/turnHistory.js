import { cleanInputText, collectInputMessages, getInputTrace } from './inputTrace';

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

function normalizedTurnId(value) {
  return value === null || value === undefined || value === '' ? null : String(value);
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
  const currentId = normalizedTurnId(activeTurnId || statusModel?.scope?.turnId);
  return inputs.map((message, index) => {
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
    return {
      id: `turn:${turnId || message.id || index}`,
      messageId: message.id || `input_${index}`,
      turnId,
      summary: boundedSummary(message),
      source: trace.source || 'user',
      state,
      stateLabel: TURN_STATE_LABELS[state] || TURN_STATE_LABELS.unknown,
      isCurrent,
      responseSummary: boundedResponseSummary(messages, turnId),
      metrics: metricsForTurn(messages, turnId, lastTurnResult),
      actionHint: actionHint(state, statusModel, isCurrent),
    };
  });
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
    if (block.type === 'thinking') return !block.isStreaming;
    if (block.type !== 'tool') return false;
    const outcome = String(block.outcome || '').toLowerCase();
    const approvalState = String(block.approval?.state || '').toLowerCase();
    return !block.isStreaming
      && !block.error
      && !['failed', 'error', 'needs_approval', 'deferred'].includes(outcome)
      && !['pending', 'denied', 'expired'].includes(approvalState);
  });
}

/** Group adjacent settled internal blocks while preserving all source blocks. */
export function groupSettledAssistantBlocks(blocks = []) {
  const grouped = [];
  let pending = [];
  const flush = () => {
    if (pending.length > 0) {
      grouped.push({
        type: 'activityGroup',
        id: `activity_${pending[0].id || grouped.length}`,
        items: pending,
      });
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
