import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, GitBranch, RefreshCw } from 'lucide-react';
import { api } from '../api';

const STATUS_LABELS = {
  queued: '排队中',
  running: '运行中',
  in_progress: '运行中',
  awaiting_approval: '等待审批',
  cancelling: '正在取消',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  step_limit: '达到步数限制',
};

export default function ChildTasksPane({
  threadId,
  projectId,
  onOpenThread,
}) {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const result = await api.listChildTasks(threadId, { projectId });
      setChildren(Array.isArray(result) ? result : result?.children || []);
      setError(null);
    } catch (err) {
      setError(err.message || '子任务状态加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, threadId]);

  useEffect(() => {
    setLoading(true);
    void load();
    const timer = window.setInterval(load, 3000);
    const handleUpdate = () => void load();
    window.addEventListener('mini-agent:child-operation-updated', handleUpdate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('mini-agent:child-operation-updated', handleUpdate);
    };
  }, [load]);

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
        <button type="button" className="btn-action-small" onClick={load} title="刷新子任务状态">
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
          {children.map((child) => {
            const status = child.status || 'queued';
            return (
              <div className="child-task-row" key={child.operation_id || child.child_thread_id}>
                <div className="child-task-main">
                  <strong title={child.child_thread_id}>{child.title || child.child_thread_id}</strong>
                  <span className={`child-task-status ${status}`}>
                    {STATUS_LABELS[status] || status}
                  </span>
                </div>
                <div className="child-task-meta font-mono">
                  {child.execution_mode || 'parallel'}
                  {child.operation_group_id ? ` · ${child.operation_group_id}` : ''}
                </div>
                {onOpenThread && child.child_thread_id && (
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
