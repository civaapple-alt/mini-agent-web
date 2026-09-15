import React from 'react';
import { Activity, ShieldAlert, X } from 'lucide-react';

function formatBytes(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

export default function StatusDetailsPane({ status, sessionMeta = null }) {
  const hasSession = Boolean(sessionMeta?.sessionId);
  const hasForkMetrics = hasSession && (
    sessionMeta.parentSessionId
    || sessionMeta.contextBeforeBytes !== null
    || sessionMeta.contextAfterBytes !== null
    || sessionMeta.sessionBytes !== null
  );

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
    </div>
  );
}
