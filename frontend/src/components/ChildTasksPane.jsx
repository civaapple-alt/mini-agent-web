import React, { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, GitBranch, RefreshCw, X } from 'lucide-react';
import {
  childTaskStatusLabels,
  formatChildTaskDuration,
  formatChildTaskTimestamp,
  getChildTaskAttemptLabel,
  getChildTaskAttemptGroups,
  getChildTaskCounts,
  getChildTaskPhaseLabel,
  getChildTaskStatus,
  getChildTaskWaitingReason,
  getChildExecutionRecovery,
  getChildExecutionRecoveryStatus,
  getChildExecutionResumeRequestId,
  getChildTaskResultPreview,
  getLatestChildTaskReport,
  isCollapsedChildTask,
  orderChildTasksForRuntime,
} from '../utils/childTasks';
import ChildTaskAttemptHistory from './ChildTaskAttemptHistory';

const FINISHED_PAGE_SIZE = 5;

function ChildTaskRow({
  child,
  projectId,
  onOpenThread,
  onControl,
  sequenceCount = null,
  nowMs,
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [editorAction, setEditorAction] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [controlError, setControlError] = useState('');
  const [controlFeedback, setControlFeedback] = useState('');
  const status = getChildTaskStatus(child);
  const executionRecovery = getChildExecutionRecovery(child);
  const executionRecoveryStatus = getChildExecutionRecoveryStatus(child);
  const waitingForExecutionResume = executionRecoveryStatus === 'waiting_for_continue';
  const needsReconciliation = executionRecoveryStatus === 'needs_reconciliation';
  const executionRecoveryPending = waitingForExecutionResume || needsReconciliation;
  const statusLabel = waitingForExecutionResume
    ? '停滞待继续'
    : needsReconciliation
      ? '工具结果待核对'
      : childTaskStatusLabels[status] || status;
  const failureDetail = child.error || child.operation_error || child.last_turn_error;
  const waitingReason = getChildTaskWaitingReason(child);
  const latestReport = getLatestChildTaskReport(child);
  const resultPreview = getChildTaskResultPreview(child);
  const attempts = getChildTaskAttemptGroups(child);
  const currentAttempt = Number.isInteger(child.operation_attempt)
    ? child.operation_attempt
    : (attempts.at(-1)?.attempt || 1);
  const currentAttemptLabel = getChildTaskAttemptLabel(
    attempts.find((attempt) => attempt.attempt === currentAttempt)
      || { attempt: currentAttempt },
  );
  const phase = getChildTaskPhaseLabel(child);
  const currentAttemptGroup = attempts.find((attempt) => attempt.attempt === currentAttempt);
  const sequenceLabel = child.execution_mode === 'sequential'
    && Number.isInteger(child.group_sequence)
    ? `第 ${child.group_sequence + 1}${Number.isInteger(sequenceCount) ? `/${sequenceCount}` : ''} 步`
    : null;
  const active = !waitingForExecutionResume
    && ['running', 'in_progress', 'awaiting_approval', 'pausing', 'cancelling'].includes(status);
  const attemptStartedAtMs = currentAttemptGroup?.stages
    .filter((stage) => ['running', 'in_progress', 'awaiting_approval', 'pausing', 'cancelling'].includes(String(stage?.status || '').toLowerCase()))
    .map((stage) => Number(stage.timestamp_ms))
    .find((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  const startedAtMs = Number.isFinite(Number(child.started_at_ms)) && Number(child.started_at_ms) > 0
    ? Number(child.started_at_ms)
    : attemptStartedAtMs;
  const durationMs = active && Number.isFinite(startedAtMs) && Number.isFinite(nowMs)
    ? Math.max(0, nowMs - startedAtMs)
    : child.duration_ms;
  const duration = formatChildTaskDuration(durationMs);
  const queued = status === 'queued';
  const paused = status === 'paused';
  const retryable = !executionRecoveryPending && ['failed', 'cancelled', 'step_limit'].includes(status);
  const pendingFollowUp = child.pending_follow_up;
  const title = child.title || child.child_thread_id || '子代理任务';
  const canViewChildSession = Boolean(
    onOpenThread && child.child_thread_id && child.child_session_available === true,
  );
  const activity = child.recovery_required && !waitingForExecutionResume
    ? child.recovery_reason || '等待子 Session 恢复'
    : waitingForExecutionResume
      ? executionRecovery?.reason || '最近执行进度已保存，等待继续'
      : needsReconciliation
        ? executionRecovery?.reason || '有工具调用结果未知，需要先核对执行记录'
    : active
      ? [phase, latestReport ? `最新进展：${latestReport.text}` : null].filter(Boolean).join(' · ') || '正在执行'
    : queued
      ? failureDetail || waitingReason || sequenceLabel || '等待并发空位'
      : paused
        ? waitingReason || '等待继续'
        : failureDetail || childTaskStatusLabels[status] || status;

  const beginEditor = (action) => {
    setControlError('');
    setControlFeedback('');
    setDraft(action === 'update_queued' ? child.operation_prompt || '' : '');
    setEditorAction(action);
  };

  const submit = async (action, value) => {
    if (!onControl) return;
    setBusy(true);
    setControlError('');
    setControlFeedback('');
    try {
      const response = await onControl(child, action, value);
      const outcome = response?.outcome?.outcome;
      setControlFeedback(outcome === 'pending' ? '已提交，等待运行时确认' : '服务端已确认');
      setEditorAction(null);
      setConfirmStop(false);
    } catch (cause) {
      setControlError(cause?.message || '子任务操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`child-task-row ${status}${child.recovery_required ? ' recovery-required' : ''}${executionRecoveryPending ? ' execution-recovery-pending' : ''}`}>
      <div className="child-task-row-head">
        <button
          type="button"
          className="child-task-summary"
          aria-expanded={expanded}
          aria-label={`${expanded ? '收起' : '展开'}任务详情：${title}，${statusLabel}${duration ? `，${active ? '已运行' : '耗时'} ${duration}` : ''}`}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className={`child-task-status-dot ${status}`} aria-hidden="true" />
          <strong title={child.child_thread_id}>{title}</strong>
          <span className={`child-task-status ${waitingForExecutionResume || needsReconciliation ? 'attention' : status}`}>
            {statusLabel}
          </span>
          {duration && (
            <span className="child-task-duration font-mono" title={active ? `已运行 ${duration}` : `耗时 ${duration}`}>
              {duration}
            </span>
          )}
          <ChevronDown size={14} className="child-task-expand-icon" aria-hidden="true" />
        </button>
        {canViewChildSession && (
          <button
            type="button"
            className="btn-action-small child-task-open"
            onClick={() => onOpenThread(child.child_thread_id, child.project_id || projectId)}
            title={resultPreview ? '在子智能体标签中查看完整结果和会话活动' : '在子智能体标签中查看子会话活动'}
          >
            <ExternalLink size={12} />
            <span>{resultPreview ? '查看结果' : '查看'}</span>
          </button>
        )}
        {waitingForExecutionResume && onControl && (
          <button
            type="button"
            className="btn-action-small"
            disabled={busy}
            onClick={() => submit('resume', {
              requestId: getChildExecutionResumeRequestId(child),
            })}
          >
            {busy ? '继续中…' : '继续'}
          </button>
        )}
        {onControl && !child.recovery_required && !executionRecoveryPending && ['running', 'in_progress', 'awaiting_approval', 'queued', 'paused'].includes(status) && (
          <button
            type="button"
            className="child-task-stop-quick"
            aria-label={`停止${title}`}
            title="停止子任务"
            disabled={busy}
            onClick={() => setConfirmStop((value) => !value)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className={`child-task-activity ${child.recovery_required || executionRecoveryPending ? 'attention' : active ? 'active' : queued ? 'queued' : ''}`}>
        <span>{child.recovery_required || executionRecoveryPending ? '恢复状态' : active ? '阶段 / 进展' : queued ? '排队原因' : '进度'}</span>
        <span title={activity}>{activity}</span>
      </div>
      {confirmStop && (
        <div className="child-task-stop-confirm" role="group" aria-label={`停止${title}确认`}>
          <span>停止“{title}”？</span>
          <button type="button" className="btn-action-small" disabled={busy} onClick={() => setConfirmStop(false)}>
            暂不停止
          </button>
          <button type="button" className="btn-action-small danger" disabled={busy} onClick={() => submit('cancel')}>
            确认停止
          </button>
        </div>
      )}
      {(busy || controlFeedback || controlError) && (
        <div className="child-task-control-feedback" role={controlError ? 'alert' : undefined}>
          {busy ? '正在提交…' : controlError || controlFeedback}
        </div>
      )}
      {expanded && (
        <div className="child-task-details">
          <div className="child-task-meta font-mono">
            <span>{child.execution_mode === 'sequential'
              ? '顺序'
              : child.execution_mode === 'parallel' ? '并行' : '模式未知'}</span>
            {sequenceLabel && <span title={child.operation_group_id || undefined}>{sequenceLabel}</span>}
            <span>{currentAttemptLabel}</span>
            {phase && <span>阶段：{phase}</span>}
          </div>
          {child.recovery_required && !waitingForExecutionResume && (
            <div className="child-task-recovery">
              {child.recovery_reason || '子 Session 需要重新连接，当前运行状态可能尚未恢复。'}
            </div>
          )}
          {executionRecoveryPending && (
            <div className="child-task-recovery">
              <strong>{waitingForExecutionResume ? '执行检查点可继续' : '等待核对工具结果'}</strong>
              <span>{executionRecovery?.reason || '刷新或重连不会自动启动执行。'}</span>
              {executionRecovery?.last_progress_ms && (
                <time>{`最近进展 ${formatChildTaskTimestamp(executionRecovery.last_progress_ms)}`}</time>
              )}
            </div>
          )}
          {waitingReason && (
            <div className="child-task-waiting" aria-label="等待原因">
              <span>等待：</span>{waitingReason}
            </div>
          )}
          {pendingFollowUp && (
            <div className={`child-task-follow-up ${pendingFollowUp.status}`}>
              {pendingFollowUp.status === 'blocked' ? '后续指令受阻，重试成功后继续' : '已有一条后续指令排队'}
              {pendingFollowUp.prompt && <span title={pendingFollowUp.prompt}>{pendingFollowUp.prompt}</span>}
            </div>
          )}
          {resultPreview && (
            <div className="child-task-result" role="group" aria-label="本轮最终结果预览">
              <span>本轮结果：</span>
              <span>{resultPreview.text}{resultPreview.truncated ? '…' : ''}</span>
              {resultPreview.truncated && (
                <small>{canViewChildSession
                  ? '预览已截断；点击“查看结果”打开子会话查看完整回复。'
                  : '预览已截断；子会话当前不可用，无法查看完整回复。'}</small>
              )}
            </div>
          )}
          {latestReport && (
            <div className="child-task-report" aria-label="子代理进展">
              <span>{latestReport.attempt
                ? `${getChildTaskAttemptLabel(attempts.find((attempt) => attempt.attempt === latestReport.attempt) || { attempt: latestReport.attempt })}进展：`
                : '最新进展：'}</span>
              <span>{latestReport.text}</span>
              <span className={`child-task-report-delivery ${latestReport.delivery_status}`}>
                {latestReport.delivery_status === 'main_received' ? '主线程已收到' : '待主线程读取'}
              </span>
              {latestReport.timestamp_ms && (
                <time>{formatChildTaskTimestamp(latestReport.timestamp_ms)}</time>
              )}
            </div>
          )}
          <ChildTaskAttemptHistory task={child} />
          {[
            'queued',
            'cancelled',
            'failed',
            'not_started',
            'step_limit',
          ].includes(status) && failureDetail && (
            <div className="child-task-error" title={failureDetail}>
              {failureDetail}
            </div>
          )}
          {onControl && !executionRecoveryPending && !child.recovery_required && (active || queued || paused || retryable) && (
            <details className="child-task-actions">
              <summary>更多操作</summary>
              <div className="child-task-controls" aria-label="子任务控制">
                {active && (
                  <>
                    <button type="button" className="btn-action-small" disabled={busy} onClick={() => submit('pause')}>
                      暂停
                    </button>
                    <button type="button" className="btn-action-small" disabled={busy} onClick={() => beginEditor('steer')}>
                      发送指令
                    </button>
                    <button type="button" className="btn-action-small" disabled={busy || Boolean(pendingFollowUp)} onClick={() => beginEditor('queue_follow_up')}>
                      排队后续
                    </button>
                  </>
                )}
                {queued && (
                  <button type="button" className="btn-action-small" disabled={busy} onClick={() => beginEditor('update_queued')}>
                    修改任务
                  </button>
                )}
                {paused && (
                  <button type="button" className="btn-action-small" disabled={busy} onClick={() => submit('resume')}>
                    继续
                  </button>
                )}
                {retryable && (
                  <button type="button" className="btn-action-small" disabled={busy} onClick={() => submit('retry')}>
                    重试
                  </button>
                )}
                {editorAction && (
                  <div className="child-task-editor">
                    <textarea
                      aria-label="子任务指令"
                      value={draft}
                      maxLength={32768}
                      disabled={busy}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    {editorAction === 'steer' ? (
                      <button type="button" className="btn-action-small" disabled={busy || !draft.trim()} onClick={() => submit('steer', { text: draft.trim() })}>
                        发送到本轮
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-action-small"
                        disabled={busy || !draft.trim() || (editorAction === 'queue_follow_up' && Boolean(pendingFollowUp))}
                        onClick={() => submit(editorAction, { prompt: draft.trim() })}
                      >
                        {editorAction === 'update_queued' ? '保存修改' : '加入后续队列'}
                      </button>
                    )}
                    <button type="button" className="btn-action-small" disabled={busy} onClick={() => setEditorAction(null)}>
                      取消编辑
                    </button>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </article>
  );
}

export default function ChildTasksPane({
  projectId,
  onOpenThread,
  children = [],
  loading = false,
  error = null,
  onRefresh,
  onControl,
  sessionControl = { status: 'running' },
  onSessionControl,
  parentTurnActive = false,
  finishedVisibleCount: controlledFinishedVisibleCount,
  onFinishedVisibleCountChange,
}) {
  const [localFinishedVisibleCount, setLocalFinishedVisibleCount] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sessionControlBusy, setSessionControlBusy] = useState(false);
  const [sessionControlError, setSessionControlError] = useState('');
  const finishedVisibleCount = Number.isInteger(controlledFinishedVisibleCount)
    ? controlledFinishedVisibleCount
    : localFinishedVisibleCount;
  const setFinishedVisibleCount = onFinishedVisibleCountChange || setLocalFinishedVisibleCount;
  const orderedChildren = orderChildTasksForRuntime(children);
  const counts = getChildTaskCounts(children);
  const currentTasks = orderedChildren.filter((child) => !isCollapsedChildTask(child));
  const finishedTasks = orderedChildren.filter(isCollapsedChildTask);
  const visibleFinishedTasks = finishedTasks.slice(0, finishedVisibleCount);
  const sessionStatus = sessionControl?.status || 'running';
  const hasSessionActivity = parentTurnActive || counts.running > 0 || counts.queued > 0 || counts.needsAttention > 0;
  const hasRunningChildren = children.some((child) => (
    ['running', 'in_progress', 'awaiting_approval', 'pausing', 'cancelling'].includes(getChildTaskStatus(child))
  ));

  useEffect(() => {
    if (!hasRunningChildren) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunningChildren]);
  const controlSession = async (action) => {
    if (!onSessionControl) return;
    setSessionControlBusy(true);
    setSessionControlError('');
    try {
      await onSessionControl(action);
    } catch (cause) {
      setSessionControlError(cause?.message || '会话控制失败');
    } finally {
      setSessionControlBusy(false);
    }
  };
  const sequenceCounts = new Map();
  for (const child of children) {
    if (child.execution_mode !== 'sequential' || !child.operation_group_id) continue;
    const groupKey = `${child.parent_turn_id || ''}:${child.operation_group_id}`;
    sequenceCounts.set(
      groupKey,
      (sequenceCounts.get(groupKey) || 0) + 1,
    );
  }
  const sequenceCountFor = (child) => (
    child.execution_mode === 'sequential' && child.operation_group_id
      ? sequenceCounts.get(`${child.parent_turn_id || ''}:${child.operation_group_id}`) || null
      : null
  );

  return (
    <section className="child-tasks-pane" aria-label="子任务状态">
      <div className="pane-section-header">
        <span className="section-title">
          <GitBranch size={14} className="text-purple" />
          子智能体
          {children.length > 0 && (
            <span
              role="group"
              className="child-task-count"
              aria-label={`运行 ${counts.running}，排队 ${counts.queued}，待处理 ${counts.needsAttention}，已结束 ${counts.finished}，共 ${children.length}`}
            >
              <span className="running">运行 <strong>{counts.running}</strong></span>
              <span className="queued">排队 <strong>{counts.queued}</strong></span>
              <span className="attention">待处理 <strong>{counts.needsAttention}</strong></span>
              <span className="finished">已结束 <strong>{counts.finished}</strong></span>
              <span className="total">共 <strong>{children.length}</strong></span>
            </span>
          )}
        </span>
        <button type="button" className="btn-action-small" onClick={onRefresh} title="刷新子任务状态">
          <RefreshCw size={12} />
          <span>刷新</span>
        </button>
        {sessionStatus === 'frozen' ? (
          <button type="button" className="btn-action-small" disabled={sessionControlBusy} onClick={() => void controlSession('continue')}>
            {sessionControlBusy ? '恢复中…' : '继续整个会话'}
          </button>
        ) : sessionStatus === 'resuming' ? (
          <button
            type="button"
            className="btn-action-small"
            disabled={sessionControlBusy}
            onClick={() => void controlSession('continue')}
          >
            {sessionControlBusy ? '恢复中…' : '重试恢复'}
          </button>
        ) : sessionStatus === 'freezing' ? (
          <button type="button" className="btn-action-small" disabled>
            正在停止…
          </button>
        ) : hasSessionActivity ? (
          <button type="button" className="btn-action-small danger" disabled={sessionControlBusy} onClick={() => void controlSession('freeze')}>
            {sessionControlBusy ? '正在停止…' : '停止整个会话'}
          </button>
        ) : null}
      </div>

      {sessionControlError && (
        <div className="status-detail-alert error" role="alert">{sessionControlError}</div>
      )}
      {sessionStatus === 'frozen' && (
        <div className="child-task-waiting" role="status">
          会话已冻结；子任务与队列保持原位，点击“继续整个会话”恢复。
        </div>
      )}

      {loading && children.length === 0 ? (
        <div className="child-task-empty">正在加载子任务状态…</div>
      ) : error ? (
        <div className="status-detail-alert error"><span>{error}</span></div>
      ) : children.length === 0 ? (
        <div className="child-task-empty">当前 Turn 没有子任务</div>
      ) : (
        <div className="child-task-sections">
          {currentTasks.length > 0 && (
            <div className="child-task-list" aria-label="活动与失败的子任务">
              {currentTasks.map((child, index) => (
                <ChildTaskRow
                  key={child.operation_id || child.child_thread_id || `child-task-${index}`}
                  child={child}
                  projectId={projectId}
                  onOpenThread={onOpenThread}
                  onControl={onControl}
                  sequenceCount={sequenceCountFor(child)}
                  nowMs={nowMs}
                />
              ))}
            </div>
          )}
          {finishedTasks.length > 0 && (
            <div className="child-task-finished-section">
              {finishedVisibleCount === 0 ? (
                <button
                  type="button"
                  className="child-task-finished-toggle"
                  onClick={() => setFinishedVisibleCount(Math.min(FINISHED_PAGE_SIZE, finishedTasks.length))}
                  aria-expanded="false"
                >
                  显示已结束任务（{finishedTasks.length}）
                </button>
              ) : (
                <>
                  <div className="child-task-list" aria-label="已结束的子任务">
                    {visibleFinishedTasks.map((child, index) => (
                      <ChildTaskRow
                        key={child.operation_id || child.child_thread_id || `finished-child-task-${index}`}
                        child={child}
                        projectId={projectId}
                        onOpenThread={onOpenThread}
                        onControl={onControl}
                        sequenceCount={sequenceCountFor(child)}
                        nowMs={nowMs}
                      />
                    ))}
                  </div>
                  <div className="child-task-finished-actions">
                    {visibleFinishedTasks.length < finishedTasks.length && (
                      <button
                        type="button"
                        className="child-task-finished-toggle"
                        onClick={() => setFinishedVisibleCount((count) => (
                          Math.min(count + FINISHED_PAGE_SIZE, finishedTasks.length)
                        ))}
                      >
                        显示更多已结束任务（剩余 {finishedTasks.length - visibleFinishedTasks.length}）
                      </button>
                    )}
                    <button
                      type="button"
                      className="child-task-finished-toggle"
                      onClick={() => setFinishedVisibleCount(0)}
                      aria-expanded="true"
                    >
                      收起已结束任务
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
