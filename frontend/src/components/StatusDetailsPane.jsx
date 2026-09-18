import React, { useEffect, useState } from 'react';
import { Activity, ShieldAlert, X } from 'lucide-react';
import { threadApi } from '../api/threads.js';
import ChildTasksPane from './ChildTasksPane';

function formatBytes(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

function formatTaskAge(startedAt) {
  if (!Number.isFinite(startedAt) || startedAt <= 0) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

const taskStateLabels = {
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  stopped: '已停止',
  failed: '失败',
  lost: '已丢失',
};

export default function StatusDetailsPane({
  status,
  sessionMeta = null,
  threadId = 'default',
  projectId = null,
  onOpenThread,
}) {
  const [backgroundTasks, setBackgroundTasks] = useState([]);
  const [backgroundTaskError, setBackgroundTaskError] = useState(null);
  const [expandedLogs, setExpandedLogs] = useState({});
  const isChild = Boolean(sessionMeta?.parentSessionId);
  const hasSession = Boolean(sessionMeta?.sessionId);
  const hasForkMetrics = hasSession && (
    sessionMeta.parentSessionId
    || sessionMeta.contextBeforeBytes !== null
    || sessionMeta.contextAfterBytes !== null
    || sessionMeta.sessionBytes !== null
  );

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await threadApi.listBackgroundTasks(threadId, { projectId });
        if (active) {
          setBackgroundTasks(result?.data || []);
          setBackgroundTaskError(null);
        }
      } catch (error) {
        if (active) setBackgroundTaskError(error.message || '无法读取后台任务');
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [projectId, threadId]);

  const refreshBackgroundTasks = async () => {
    const result = await threadApi.listBackgroundTasks(threadId, { projectId });
    setBackgroundTasks(result?.data || []);
  };

  const handleTaskAction = async (taskId, action) => {
    try {
      if (action === 'stop') await threadApi.stopBackgroundTask(threadId, taskId, { projectId });
      else await threadApi.restartBackgroundTask(threadId, taskId, { projectId });
      await refreshBackgroundTasks();
    } catch (error) {
      setBackgroundTaskError(error.message || '后台任务操作失败');
    }
  };

  const toggleLogs = async (taskId) => {
    if (expandedLogs[taskId]) {
      setExpandedLogs((current) => ({ ...current, [taskId]: null }));
      return;
    }
    try {
      const result = await threadApi.readBackgroundTaskLogs(threadId, taskId, { projectId });
      setExpandedLogs((current) => ({ ...current, [taskId]: result }));
    } catch (error) {
      setBackgroundTaskError(error.message || '无法读取后台日志');
    }
  };

  return (
    <div className="tab-pane status-details-pane">
      <div className="pane-section-header">
        <span className="section-title">
          <Activity size={14} className="text-sky" />
          当前运行状态
        </span>
        <span className={`status-detail-badge ${status?.lifecycle || 'idle'} connection-${status?.connection || 'offline'}`}>
          {status?.label || '空闲'}
        </span>
      </div>

      <div className="status-scope-card">
        <div>
          <span className="card-label">当前作用域</span>
          <strong>{status?.scope?.projectId || '默认项目'} / {status?.scope?.threadId || 'default'}</strong>
        </div>
        <span className={`status-detail-connection ${status?.connection || 'offline'}`}>
          {status?.connection === 'online'
            ? '已连接'
            : status?.connection === 'reconnecting'
              ? '正在恢复'
              : '连接中断'}
        </span>
      </div>

      {hasSession && (
        <div className="status-detail-section">
          <span className="card-label">Session 身份</span>
          <div className="status-detail-grid">
            <div className="detail-card">
              <span className="card-label">Session ID</span>
              <span className="card-val font-mono" title={sessionMeta.sessionId}>
                {sessionMeta.sessionId}
              </span>
            </div>
            {sessionMeta.parentSessionId && (
              <div className="detail-card">
                <span className="card-label">派生自</span>
                <span className="card-val font-mono" title={sessionMeta.parentSessionId}>
                  {sessionMeta.parentSessionId}
                </span>
              </div>
            )}
            {hasForkMetrics && (
              <>
                <div className="detail-card">
                  <span className="card-label">父 checkpoint</span>
                  <span className="card-val font-mono">
                    {sessionMeta.parentCheckpointSeq ?? '—'}
                  </span>
                </div>
                <div className="detail-card">
                  <span className="card-label">Session 大小</span>
                  <span className="card-val font-mono">
                    {formatBytes(sessionMeta.sessionBytes)}
                  </span>
                </div>
                <div className="detail-card">
                  <span className="card-label">上下文</span>
                  <span className="card-val font-mono">
                    {formatBytes(sessionMeta.contextBeforeBytes)} → {formatBytes(sessionMeta.contextAfterBytes)}
                  </span>
                </div>
                <div className="detail-card">
                  <span className="card-label">派生处理</span>
                  <span className="card-val">
                    {sessionMeta.compacted ? `已压缩 · ${sessionMeta.compactionMethod || '已处理'}` : '原样 checkpoint'}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="status-detail-grid">
        <div className="detail-card">
          <span className="card-label">当前阶段</span>
          <span className="card-val font-mono">{status?.summary || '空闲'}</span>
        </div>
        <div className="detail-card">
          <span className="card-label">Turn</span>
          <span className="card-val font-mono">{status?.scope?.turnId || '—'}</span>
        </div>
        <div className="detail-card">
          <span className="card-label">Checkpoint</span>
          <span className="card-val font-mono">{status?.runtime?.checkpointSeq ?? '—'}</span>
        </div>
        <div className="detail-card">
          <span className="card-label">Operation</span>
          <span className="card-val font-mono" title={status?.runtime?.operationId || ''}>
            {status?.runtime?.operationId || '—'}
          </span>
        </div>
      </div>

      <div className="status-detail-section">
        <span className="card-label">运行设置</span>
        <div className="status-detail-settings font-mono">
          {status?.executionSettings?.summary || '—'}
        </div>
        {status?.workflow?.goalStatus === 'active' && (
          <p className="status-detail-note">Goal 正在接管当前会话的推进方式。</p>
        )}
      </div>

      {status?.approval && (
        <div className="status-detail-alert approval">
          <ShieldAlert size={14} />
          <div>
            <strong>{status.approval.state === 'cancelling' ? '审批正在失效' : '等待审批'}</strong>
            <span>{status.approval.actionSummary || '敏感工具操作等待人工授权'}</span>
            <small className="font-mono">{status.approval.requestId}</small>
          </div>
        </div>
      )}

      {status?.runtime?.error && (
        <div className="status-detail-alert error">
          <X size={14} />
          <div>
            <strong>运行异常</strong>
            <span>{status.runtime.error}</span>
          </div>
        </div>
      )}

      <div className="status-detail-section">
        <span className="card-label">最近事件</span>
        <div className="status-detail-event font-mono">
          {status?.runtime?.lastWorkflowEvent || '暂无新的工作流事件'}
        </div>
      </div>

      <div className="status-detail-section background-tasks-section">
        <div className="pane-section-header">
          <span className="card-label">后台 Shell 任务</span>
          {isChild && <span className="background-task-readonly">Child 只读</span>}
        </div>
        {backgroundTaskError && (
          <div className="background-task-error">{backgroundTaskError}</div>
        )}
        {backgroundTasks.length === 0 && !backgroundTaskError && (
          <div className="status-detail-event">暂无后台 Shell 任务</div>
        )}
        <div className="background-task-list">
          {backgroundTasks.map((task) => {
            const state = task.state || 'lost';
            const logs = expandedLogs[task.task_id];
            return (
              <div className="background-task-card" key={task.task_id}>
                <div className="background-task-heading">
                  <strong className="font-mono">{task.task_id}</strong>
                  <span className={`background-task-state ${state}`}>
                    {taskStateLabels[state] || state}
                  </span>
                </div>
                <div className="background-task-command" title={task.command_summary}>
                  {task.command_summary || '—'}
                </div>
                <div className="background-task-meta font-mono">
                  PID {task.process_id || '—'} · {formatTaskAge(task.started_at)} · 日志 {formatBytes(task.log_bytes)} · hash {task.command_hash || '—'}
                </div>
                <div className="background-task-meta" title={task.working_directory}>
                  {task.working_directory || '—'}
                </div>
                <div className="background-task-actions">
                  <button type="button" className="btn-action-small" onClick={() => toggleLogs(task.task_id)}>
                    {logs ? '收起日志' : '查看日志'}
                  </button>
                  {!isChild && state !== 'stopped' && state !== 'failed' && state !== 'lost' && (
                    <button type="button" className="btn-action-small" onClick={() => handleTaskAction(task.task_id, 'stop')}>
                      停止
                    </button>
                  )}
                  {!isChild && (state === 'stopped' || state === 'failed' || state === 'lost') && (
                    <button type="button" className="btn-action-small" onClick={() => handleTaskAction(task.task_id, 'restart')}>
                      重启
                    </button>
                  )}
                </div>
                {logs && (
                  <pre className="background-task-logs">{logs.text || '暂无输出'}</pre>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ChildTasksPane
        threadId={threadId}
        projectId={projectId}
        onOpenThread={onOpenThread}
      />
    </div>
  );
}
