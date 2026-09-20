import React, { useState } from 'react';
import { ExternalLink, GitBranch, RefreshCw } from 'lucide-react';
import {
  childTaskStatusLabels,
  formatChildTaskDuration,
  formatChildTaskTimestamp,
  getChildTaskAttemptGroups,
  getChildTaskCounts,
  getChildTaskPhaseLabel,
  getChildTaskStatus,
  getChildTaskWaitingReason,
  getLatestChildTaskReport,
  isCollapsedChildTask,
  orderChildTasksForRuntime,
} from '../utils/childTasks';
import ChildTaskAttemptHistory from './ChildTaskAttemptHistory';

const FINISHED_PAGE_SIZE = 5;

function ChildTaskRow({ child, projectId, onOpenThread, sequenceCount = null }) {
  const status = getChildTaskStatus(child);
  const failureDetail = child.error || child.operation_error || child.last_turn_error;
  const waitingReason = getChildTaskWaitingReason(child);
  const latestReport = getLatestChildTaskReport(child);
  const attempts = getChildTaskAttemptGroups(child);
  const currentAttempt = Number.isInteger(child.operation_attempt)
    ? child.operation_attempt
    : (attempts.at(-1)?.attempt || 1);
  const phase = getChildTaskPhaseLabel(child);
  const duration = formatChildTaskDuration(child.duration_ms);
  const sequenceLabel = child.execution_mode === 'sequential'
    && Number.isInteger(child.group_sequence)
    ? `第 ${child.group_sequence + 1}${Number.isInteger(sequenceCount) ? `/${sequenceCount}` : ''} 步`
    : null;

  return (
    <article className={`child-task-row ${status}${child.recovery_required ? ' recovery-required' : ''}`}>
      <div className="child-task-main">
        <strong title={child.child_thread_id}>{child.title || child.child_thread_id || '子代理任务'}</strong>
        <span className={`child-task-status ${status}`} aria-label={`状态：${childTaskStatusLabels[status] || status}`}>
          {childTaskStatusLabels[status] || status}
        </span>
      </div>
      <div className="child-task-meta font-mono">
        <span>{child.execution_mode === 'sequential'
          ? '顺序'
          : child.execution_mode === 'parallel' ? '并行' : '模式未知'}</span>
        {sequenceLabel && <span title={child.operation_group_id || undefined}>{sequenceLabel}</span>}
        <span>第 {currentAttempt} 次</span>
        {duration && <span>{duration}</span>}
      </div>
      {phase && <div className="child-task-phase">当前阶段：{phase}</div>}
      {child.recovery_required && (
        <div className="child-task-recovery">
          子 Session 需要重新连接，当前运行状态可能尚未恢复。
        </div>
      )}
      {waitingReason && (
        <div className="child-task-waiting" aria-label="等待原因">
          <span>等待：</span>{waitingReason}
        </div>
      )}
      {latestReport && (
        <div className="child-task-report" aria-label="子代理进展">
          <span>{latestReport.attempt ? `第 ${latestReport.attempt} 次进展：` : '最新进展：'}</span>
          <span>{latestReport.text}</span>
          {latestReport.timestamp_ms && (
            <time>{formatChildTaskTimestamp(latestReport.timestamp_ms)}</time>
          )}
        </div>
      )}
      <ChildTaskAttemptHistory task={child} />
      {['failed', 'not_started', 'step_limit'].includes(status) && failureDetail && (
        <div className="child-task-error" title={failureDetail}>
          {failureDetail}
        </div>
      )}
      {onOpenThread && child.child_thread_id && child.child_session_available === true && (
        <button
          type="button"
          className="btn-action-small child-task-open"
          onClick={() => onOpenThread(child.child_thread_id, child.project_id || projectId)}
          title="在子智能体标签中查看子会话活动"
        >
          <ExternalLink size={12} />
          <span>查看</span>
        </button>
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
}) {
  const [finishedVisibleCount, setFinishedVisibleCount] = useState(0);
  const orderedChildren = orderChildTasksForRuntime(children);
  const counts = getChildTaskCounts(children);
  const currentTasks = orderedChildren.filter((child) => !isCollapsedChildTask(child));
  const finishedTasks = orderedChildren.filter(isCollapsedChildTask);
  const visibleFinishedTasks = finishedTasks.slice(0, finishedVisibleCount);
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
            <span className="child-task-count">
              运行 {counts.running} · 排队 {counts.queued} · 待处理 {counts.needsAttention} · 共 {children.length}
            </span>
          )}
        </span>
        <button type="button" className="btn-action-small" onClick={onRefresh} title="刷新子任务状态">
          <RefreshCw size={12} />
          <span>刷新</span>
        </button>
      </div>

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
                  sequenceCount={sequenceCountFor(child)}
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
                        sequenceCount={sequenceCountFor(child)}
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
