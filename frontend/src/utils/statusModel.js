import { RUNTIME_PHASE_LABELS } from './sessionState.js';

export const STATUS_LIFECYCLE_LABELS = {
  idle: '空闲',
  running: '运行中',
  approval: '等待审批',
  stopping: '正在停止',
  plan_review: '等待确认',
  goal_paused: 'Goal 已暂停',
  completed: '已完成',
  failed: '运行失败',
  interrupted: '已中断',
  step_limit: '达到步数上限',
};

const ACCESS_LABELS = {
  project: '项目范围',
  full_machine: '完全访问',
};

const POLICY_LABELS = {
  interactive: '交互批准',
  automatic: '自动低风险',
  trusted: '信任执行',
};

const CONTINUATION_LABELS = {
  manual: '手动推进',
  continuous: '连续执行',
};

function getTurnResultStatus(lastTurnResult) {
  const status = lastTurnResult?.status || lastTurnResult?.stopReason;
  if (status === 'completed') return 'completed';
  if (status === 'interrupted' || status === 'cancelled') return 'interrupted';
  if (status === 'step_limit') return 'step_limit';
  if (status === 'failed' || status === 'error') return 'failed';
  return null;
}

function getConnectionState(isConnected, connectionState) {
  if (connectionState === 'reconnecting' || connectionState === 'offline') {
    return connectionState;
  }
  return isConnected ? 'online' : 'offline';
}

function getRuntimeSummary(runtimeStatus, lifecycle) {
  if (lifecycle === 'stopping') return '正在取消当前 Turn，等待运行时确认';
  if (lifecycle === 'approval') return '敏感操作已暂停，等待人工授权';
  if (lifecycle === 'plan_review') return '规划已完成，请选择继续规划或开始实施';
  if (lifecycle === 'goal_paused') return 'Goal 已暂停，可在详情中恢复';
  if (runtimeStatus?.error) return runtimeStatus.error;
  if (runtimeStatus?.phase && runtimeStatus.phase !== 'idle') {
    return RUNTIME_PHASE_LABELS[runtimeStatus.phase] || runtimeStatus.phase;
  }
  return STATUS_LIFECYCLE_LABELS[lifecycle] || STATUS_LIFECYCLE_LABELS.idle;
}

export function normalizeTheme(theme) {
  return theme === 'dark' || theme === 'midnight' || theme === 'cyberpunk'
    ? 'dark'
    : 'light';
}

export function getExecutionSettings({
  accessScope = 'project',
  policy = 'interactive',
  continuationMode = 'manual',
  goalState = null,
} = {}) {
  return {
    accessScope,
    policy,
    continuationMode,
    accessLabel: ACCESS_LABELS[accessScope] || accessScope,
    policyLabel: POLICY_LABELS[policy] || policy,
    continuationLabel: goalState?.status === 'active'
      ? 'Goal 接管'
      : CONTINUATION_LABELS[continuationMode] || continuationMode,
    summary: [
      ACCESS_LABELS[accessScope] || accessScope,
      POLICY_LABELS[policy] || policy,
      goalState?.status === 'active'
        ? 'Goal 接管'
        : CONTINUATION_LABELS[continuationMode] || continuationMode,
    ].join(' · '),
  };
}

export function getStatusViewModel({
  projectId = null,
  threadId = 'default',
  isConnected = false,
  connectionState = null,
  isGenerating = false,
  isInterrupting = false,
  activeTurnId = null,
  pendingApproval = null,
  planActive = false,
  planReviewPending = false,
  goalState = null,
  runtimeStatus = null,
  lastWorkflowEvent = null,
  lastTurnResult = null,
  accessScope = 'project',
  policy = 'interactive',
  continuationMode = 'manual',
  sessionReadOnly = false,
} = {}) {
  const connection = getConnectionState(isConnected, connectionState);
  const turnId = activeTurnId
    || pendingApproval?.data?.turnId
    || pendingApproval?.data?.turn_id
    || runtimeStatus?.turnId
    || lastTurnResult?.turnId
    || null;
  const hasActiveTurn = Boolean(isGenerating || activeTurnId || runtimeStatus?.active);
  const hasApproval = Boolean(pendingApproval);
  const turnResultStatus = getTurnResultStatus(lastTurnResult);

  let lifecycle = 'idle';
  if (connection === 'reconnecting' && hasActiveTurn) {
    lifecycle = 'running';
  } else if (isInterrupting) {
    lifecycle = 'stopping';
  } else if (hasApproval) {
    lifecycle = 'approval';
  } else if (hasActiveTurn) {
    lifecycle = 'running';
  } else if (planActive && planReviewPending) {
    lifecycle = 'plan_review';
  } else if (goalState?.status === 'paused') {
    lifecycle = 'goal_paused';
  } else if (turnResultStatus) {
    lifecycle = turnResultStatus;
  }

  const lifecycleLabel = STATUS_LIFECYCLE_LABELS[lifecycle] || STATUS_LIFECYCLE_LABELS.idle;
  const statusLabel = connection === 'reconnecting'
    ? '正在恢复'
    : connection === 'offline'
      ? '连接中断'
      : lifecycleLabel;
  const settings = getExecutionSettings({
    accessScope,
    policy,
    continuationMode,
    goalState,
  });
  const runtimeError = runtimeStatus?.error || lastTurnResult?.error || null;
  const connectionSummary = connection === 'reconnecting'
    ? '连接已断开，正在恢复并核对运行状态'
    : connection === 'offline'
      ? '连接中断，等待运行状态恢复'
      : runtimeError || getRuntimeSummary(runtimeStatus, lifecycle);
  const connectionNextAction = connection !== 'online'
    ? '等待状态回放'
    : null;

  return {
    scope: { projectId, threadId, turnId },
    connection,
    lifecycle,
    label: statusLabel,
    summary: connectionSummary,
    nextAction: connectionNextAction || (lifecycle === 'approval'
      ? '请在下方审批操作'
      : lifecycle === 'plan_review'
        ? '打开计划详情进行确认'
        : lifecycle === 'failed'
          ? '打开详情查看失败原因'
          : lifecycle === 'stopping'
            ? '等待终止确认'
            : null),
    phase: runtimeStatus?.phase || 'idle',
    runtime: {
      checkpointSeq: runtimeStatus?.checkpointSeq ?? runtimeStatus?.checkpoint_seq ?? null,
      operationId: runtimeStatus?.operationId || runtimeStatus?.operation_id || null,
      error: runtimeError,
      lastWorkflowEvent: lastWorkflowEvent?.method || lastWorkflowEvent?.type || null,
    },
    approval: pendingApproval
      ? {
        requestId: pendingApproval.requestId,
        actionSummary: pendingApproval.data?.actionSummary || null,
        state: isInterrupting ? 'cancelling' : 'pending',
      }
      : null,
    workflow: {
      planActive,
      planReviewPending,
      goalStatus: goalState?.status || null,
      goalObjective: goalState?.objective || null,
    },
    executionSettings: settings,
    process: {
      turnActive: hasActiveTurn,
      processOnline: connection === 'online' || connection === 'reconnecting',
      processLabel: hasActiveTurn ? '运行中' : '待命',
    },
    sessionReadOnly,
  };
}
