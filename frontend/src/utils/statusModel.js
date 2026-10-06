import { RUNTIME_PHASE_LABELS } from './sessionState.js';
import { approvalIdentity } from './messageState.js';

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
  if (['connecting', 'reconnecting', 'offline'].includes(connectionState)) {
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

function getRecoveryCalls(lastTurnResult) {
  const recovery = lastTurnResult?.recovery;
  if (recovery?.status !== 'needs_reconciliation') return [];
  return recovery.uncertain_tool_calls || recovery.uncertainToolCalls || [];
}

function getPendingApprovals(pendingApproval, pendingApprovals) {
  const approvals = [...(Array.isArray(pendingApprovals) ? pendingApprovals : [])];
  if (pendingApproval) approvals.unshift(pendingApproval);
  const seen = new Set();
  return approvals.filter((approval) => {
    const data = approval?.data || approval || {};
    if (!(approval?.requestId || approval?.request_id || data.requestId || data.request_id
      || data.callId || data.call_id)) return true;
    const key = approvalIdentity(approval);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function attentionTarget(projectId, threadId, turnId, fields = {}) {
  return Object.fromEntries(
    Object.entries({ projectId, threadId, turnId, ...fields })
      .filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
}

function getAttention({
  projectId,
  threadId,
  connection,
  lifecycle,
  sessionReadOnly,
  pendingApprovals,
  pendingUserQuestion,
  recoveryCalls,
  recoveryStatus,
  recoveryTurnId,
  planReviewPending,
  turnId,
}) {
  const questionIndex = pendingUserQuestion?.currentIndex
    ?? pendingUserQuestion?.current_index
    ?? 0;
  const questionCount = pendingUserQuestion
    && !pendingUserQuestion.isComplete
    && !pendingUserQuestion.is_complete
    ? Math.max(0, (pendingUserQuestion.questions?.length || 1) - questionIndex)
    : 0;
  const continueCount = recoveryStatus === 'waiting_for_continue' ? 1 : 0;
  const planCount = planReviewPending ? 1 : 0;
  const totalCount = recoveryCalls.length + pendingApprovals.length
    + questionCount + continueCount + planCount;

  if (totalCount === 0) return null;
  if (connection !== 'online') {
    return {
      type: 'sync',
      summary: connection === 'offline'
        ? '连接已中断，重连后核对待处理状态'
        : connection === 'connecting'
          ? '正在连接，连接后核对待处理状态'
          : '连接恢复中，正在核对待处理状态',
      count: totalCount,
      remainingCount: 0,
      target: null,
      actionLabel: null,
    };
  }
  if (sessionReadOnly) {
    return {
      type: 'read_only',
      summary: `当前会话只读，有 ${totalCount} 项待处理操作无法提交`,
      count: totalCount,
      remainingCount: 0,
      target: null,
      actionLabel: null,
    };
  }
  if (lifecycle === 'stopping') {
    return {
      type: 'stopping',
      summary: '当前 Turn 正在停止，等待运行时确认',
      count: totalCount,
      remainingCount: 0,
      target: null,
      actionLabel: null,
    };
  }

  let item = null;
  if (recoveryCalls.length > 0) {
    const call = recoveryCalls[0];
    const callId = call.tool_call_id || call.toolCallId || null;
    item = {
      type: 'reconciliation',
      label: '待核对工具结果',
      count: recoveryCalls.length,
      target: attentionTarget(projectId, threadId, recoveryTurnId || turnId, { callId }),
    };
  } else if (pendingApprovals.length > 0) {
    const approval = pendingApprovals[0];
    const data = approval?.data || approval || {};
    item = {
      type: 'approval',
      label: '待审批操作',
      count: pendingApprovals.length,
      target: attentionTarget(
        projectId,
        threadId,
        data.turnId || data.turn_id || turnId,
        {
          callId: data.callId || data.call_id || null,
          requestId: approval.requestId || approval.request_id || data.requestId || data.request_id || null,
        },
      ),
    };
  } else if (pendingUserQuestion) {
    item = {
      type: 'question',
      label: '待回答问题',
      count: questionCount,
      target: attentionTarget(
        projectId,
        threadId,
        pendingUserQuestion.turnId || pendingUserQuestion.turn_id || turnId,
        {
          callId: pendingUserQuestion.callId || pendingUserQuestion.call_id || null,
          interactionId: pendingUserQuestion.interactionId
            || pendingUserQuestion.interaction_id
            || null,
        },
      ),
    };
  } else if (continueCount > 0) {
    item = {
      type: 'continue',
      label: '等待继续当前 Turn',
      count: 1,
      target: attentionTarget(projectId, threadId, recoveryTurnId || turnId),
    };
  } else if (planCount > 0) {
    item = {
      type: 'plan_review',
      label: '计划等待确认',
      count: 1,
      target: attentionTarget(projectId, threadId, turnId),
    };
  }

  if (!item) return null;
  const remainingCount = Math.max(0, totalCount - item.count);
  return {
    ...item,
    summary: `${item.label} ${item.count} 项${remainingCount > 0 ? ` · 另有 ${remainingCount} 项待处理` : ''}`,
    remainingCount,
    actionLabel: item.type === 'plan_review' ? '打开计划' : '前往下一项',
  };
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
  pendingApprovals = [],
  pendingUserQuestion = null,
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
  const runtimeStopping = runtimeStatus?.phase === 'stopping';
  const hasActiveTurn = Boolean(isGenerating || activeTurnId || runtimeStatus?.active || runtimeStopping);
  const approvals = getPendingApprovals(pendingApproval, pendingApprovals);
  const hasApproval = approvals.length > 0;
  const recoveryCalls = getRecoveryCalls(lastTurnResult);
  const recoveryStatus = lastTurnResult?.recovery?.status || null;
  const recoveryTurnId = lastTurnResult?.recovery?.turnId
    || lastTurnResult?.recovery?.turn_id
    || lastTurnResult?.turnId
    || null;
  const turnResultStatus = getTurnResultStatus(lastTurnResult);

  let lifecycle = 'idle';
  if (connection === 'reconnecting' && hasActiveTurn) {
    lifecycle = 'running';
  } else if (isInterrupting || runtimeStopping) {
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
  const statusLabel = connection === 'connecting'
    ? '正在连接'
    : connection === 'reconnecting'
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
  const connectionSummary = connection === 'connecting'
    ? '正在连接服务并核对会话状态'
    : connection === 'reconnecting'
      ? '连接已断开，正在恢复并核对运行状态'
      : connection === 'offline'
        ? '连接中断，等待运行状态恢复'
        : runtimeError || getRuntimeSummary(runtimeStatus, lifecycle);
  const connectionNextAction = connection !== 'online'
    ? '等待状态回放'
    : null;
  const attention = getAttention({
    projectId,
    threadId,
    connection,
    lifecycle,
    sessionReadOnly,
    pendingApprovals: approvals,
    pendingUserQuestion,
    recoveryCalls,
    recoveryStatus,
    recoveryTurnId,
    planReviewPending: planActive && planReviewPending && !hasActiveTurn,
    turnId,
  });

  return {
    scope: { projectId, threadId, turnId },
    connection,
    lifecycle,
    label: statusLabel,
    summary: connectionSummary,
    nextAction: connectionNextAction || (lifecycle === 'approval'
      ? '在对应工具活动中授权'
      : lifecycle === 'plan_review'
        ? '打开计划详情进行确认'
        : lifecycle === 'failed'
          ? '打开详情查看失败原因'
          : lifecycle === 'stopping'
            ? '等待终止确认'
      : null),
    attention,
    phase: runtimeStatus?.phase || 'idle',
    runtime: {
      checkpointSeq: runtimeStatus?.checkpointSeq ?? runtimeStatus?.checkpoint_seq ?? null,
      operationId: runtimeStatus?.operationId || runtimeStatus?.operation_id || null,
      error: runtimeError,
      lastWorkflowEvent: lastWorkflowEvent
        ? {
          method: lastWorkflowEvent.method || lastWorkflowEvent.type || null,
          turnId: lastWorkflowEvent.turnId || lastWorkflowEvent.turn_id || null,
          checkpointSeq: lastWorkflowEvent.checkpointSeq
            ?? lastWorkflowEvent.checkpoint_seq
            ?? null,
          timestampMs: lastWorkflowEvent.timestampMs
            ?? lastWorkflowEvent.timestamp_ms
            ?? null,
        }
        : null,
    },
    approval: approvals[0]
      ? {
        requestId: approvals[0].requestId,
        actionSummary: approvals[0].data?.actionSummary || null,
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
