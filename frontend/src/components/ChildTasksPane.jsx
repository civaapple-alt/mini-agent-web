import React from 'react';
import { ExternalLink, GitBranch, RefreshCw } from 'lucide-react';
import {
  childTaskLifecycleLabels,
  childTaskStatusLabels,
  formatChildTaskDuration,
  formatChildTaskTimestamp,
} from '../utils/childTasks';

export default function ChildTasksPane({
  projectId,
  onOpenThread,
  children = [],
  loading = false,
  error = null,
  onRefresh,
}) {
  const activeCount = children.filter((child) => (
    ['queued', 'running', 'in_progress', 'awaiting_approval', 'cancelling']
      .includes(child.status)
  )).length;

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
        <div className="child-task-list">
          {children.map((child, index) => {
            const status = child.status || 'queued';
            const failureDetail = child.error || child.operation_error || child.last_turn_error;
            return (
              <div className="child-task-row" key={child.operation_id || child.child_thread_id || `child-task-${index}`}>
                <div className="child-task-main">
                  <strong title={child.child_thread_id}>{child.title || child.child_thread_id}</strong>
                  <span className={`child-task-status ${status}`}>
                  {childTaskStatusLabels[status] || status}
                  </span>
                </div>
                <div className="child-task-meta font-mono">
                  {child.execution_mode || 'parallel'}
                  {child.operation_group_id ? ` · ${child.operation_group_id}` : ''}
                  {formatChildTaskDuration(child.duration_ms)
                    ? ` · ${formatChildTaskDuration(child.duration_ms)}`
                    : ''}
                </div>
                {child.status === 'failed' && failureDetail && (
                  <div
                    className="child-task-error"
                    title={failureDetail}
                  >
                    {failureDetail}
                  </div>
                )}
                {Array.isArray(child.lifecycle) && child.lifecycle.length > 0 && (
                  <ol className="child-task-lifecycle" aria-label={`${child.title || '子任务'}生命周期`}>
                    {child.lifecycle.map((stage, index) => {
                      const timestamp = formatChildTaskTimestamp(stage.timestamp_ms);
                      const label = childTaskLifecycleLabels[stage.status] || stage.status;
                      return (
                        <li key={`${stage.status}-${stage.attempt ?? 0}-${index}`}>
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
          })}
        </div>
      )}
    </section>
  );
}
