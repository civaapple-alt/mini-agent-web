import React, { useState } from 'react';
import { ExternalLink, GitBranch, RefreshCw } from 'lucide-react';
import {
  childTaskLifecycleLabels,
  childTaskStatusLabels,
  formatChildTaskDuration,
  formatChildTaskTimestamp,
  getChildTaskStatus,
  getChildTaskWaitingReason,
  getLatestChildTaskReport,
  isCollapsedChildTask,
  orderChildTasksForRuntime,
} from '../utils/childTasks';

const FINISHED_PAGE_SIZE = 5;

function ChildTaskRow({ child, projectId, onOpenThread }) {
  const status = getChildTaskStatus(child);
  const failureDetail = child.error || child.operation_error || child.last_turn_error;
  const waitingReason = getChildTaskWaitingReason(child);
  const latestReport = getLatestChildTaskReport(child);
  const duration = formatChildTaskDuration(child.duration_ms);

  return (
    <div className="child-task-row">
      <div className="child-task-main">
        <strong title={child.child_thread_id}>{child.title || child.child_thread_id || '子代理任务'}</strong>
        <span className={`child-task-status ${status}`}>
          {childTaskStatusLabels[status] || status}
        </span>
      </div>
      <div className="child-task-meta font-mono">
        {child.execution_mode || 'parallel'}
        {child.operation_group_id ? ` · ${child.operation_group_id}` : ''}
        {duration ? ` · ${duration}` : ''}
      </div>
      {waitingReason && (
        <div className="child-task-waiting" aria-label="等待原因">
          <span>等待：</span>{waitingReason}
        </div>
      )}
      {latestReport && (
        <div className="child-task-report" aria-label="子代理进展">
          <span>进展：</span>
          <span>{latestReport.text}</span>
          {latestReport.timestamp_ms && (
            <time>{formatChildTaskTimestamp(latestReport.timestamp_ms)}</time>
          )}
        </div>
      )}
      {status === 'failed' && failureDetail && (
        <div className="child-task-error" title={failureDetail}>
          {failureDetail}
        </div>
      )}
      {Array.isArray(child.lifecycle) && child.lifecycle.length > 0 && (
        <ol className="child-task-lifecycle" aria-label={`${child.title || '子任务'}生命周期`}>
          {child.lifecycle.map((stage, stageIndex) => {
            const timestamp = formatChildTaskTimestamp(stage.timestamp_ms);
            const label = childTaskLifecycleLabels[stage.status] || stage.status;
            return (
              <li key={`${stage.status}-${stage.attempt ?? 0}-${stageIndex}`}>
                <span>{label}</span>
                {timestamp && <time>{timestamp}</time>}
              </li>
            );
          })}
        </ol>
      )}
      {onOpenThread && child.child_thread_id && child.child_session_available === true && (
        <button
          type="button"
          className="btn-action-small"
          onClick={() => onOpenThread(child.child_thread_id, projectId)}
          title="打开子任务"
        >
          <ExternalLink size={12} />
          <span>打开</span>
        </button>
      )}
    </div>
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
  const activeCount = children.filter((child) => (
    ['queued', 'running', 'in_progress', 'awaiting_approval', 'cancelling']
      .includes(getChildTaskStatus(child))
  )).length;
  const currentTasks = orderedChildren.filter((child) => !isCollapsedChildTask(child));
  const finishedTasks = orderedChildren.filter(isCollapsedChildTask);
  const visibleFinishedTasks = finishedTasks.slice(0, finishedVisibleCount);

  return (
    <section className="child-tasks-pane" aria-label="子任务状态">
      <div className="pane-section-header">
        <span className="section-title">
          <GitBranch size={14} className="text-purple" />
          子任务
          {children.length > 0 && <span className="child-task-count">{activeCount}/{children.length}</span>}
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
