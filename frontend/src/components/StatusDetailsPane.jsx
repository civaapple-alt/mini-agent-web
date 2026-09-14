import React from 'react';
import { Activity, ShieldAlert, X } from 'lucide-react';

export default function StatusDetailsPane({ status }) {
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
