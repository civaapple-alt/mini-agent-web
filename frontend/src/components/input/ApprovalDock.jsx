import React, { useState } from 'react';
import { Check, ShieldAlert, X } from 'lucide-react';

export default function ApprovalDock({
  pendingApproval,
  isInterrupting,
  onRespondApproval,
}) {
  const [denyReason, setDenyReason] = useState('');
  const [showDenyInput, setShowDenyInput] = useState(false);
  if (!pendingApproval) return null;

  const approvalActionText =
    typeof pendingApproval.data === 'object' && pendingApproval.data !== null
      ? pendingApproval.data.actionSummary || JSON.stringify(pendingApproval.data, null, 2)
      : String(pendingApproval.data);

  const handleApprove = (scope = 'once') => {
    onRespondApproval?.(pendingApproval.requestId, 'approve', '', scope);
    setShowDenyInput(false);
    setDenyReason('');
  };

  const handleDeny = () => {
    if (!showDenyInput) {
      setShowDenyInput(true);
      return;
    }
    onRespondApproval?.(
      pendingApproval.requestId,
      'deny',
      denyReason.trim(),
      null,
    );
    setShowDenyInput(false);
    setDenyReason('');
  };

  const allowedGrantScopes = pendingApproval.data?.allowedGrantScopes || ['once'];

  return (
    <div className={`composer-approval-dock ${isInterrupting ? 'is-cancelling' : ''}`} role="alert" aria-live="polite">
      <div className="dock-header">
        <div className="dock-title-group">
          <ShieldAlert size={14} className="dock-alert-icon" />
        <span className="dock-title font-mono">
          {isInterrupting ? '审批正在失效' : '待审批操作'}
        </span>
        </div>
        <span className="dock-request-id font-mono">
          ID: {pendingApproval.requestId}
        </span>
      </div>

      <div className="dock-action-content font-mono custom-scrollbar">
        <pre>{approvalActionText}</pre>
      </div>

      {showDenyInput && (
        <div className="dock-deny-box">
          <input
            type="text"
            className="dock-deny-input font-mono"
            placeholder="输入拒绝原因 (可选，模型将根据此原因调整计划)..."
            value={denyReason}
            onChange={(event) => setDenyReason(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && handleDeny()}
            autoFocus
          />
        </div>
      )}

      <div className="dock-actions-row">
        <span className="dock-left-hint">
          {isInterrupting ? '当前轮次正在停止，不会继续执行此工具' : '该操作需要您的授权方可执行'}
        </span>

        <div className="dock-btn-group">
          <button
            type="button"
            className="btn-dock-approve"
            onClick={() => handleApprove('once')}
            disabled={isInterrupting}
            title="允许执行本次操作"
          >
            <Check size={12} />
            <span>允许本次 (Once)</span>
          </button>

          {allowedGrantScopes.includes('session') && (
            <button
              type="button"
              className="btn-dock-scope"
              onClick={() => handleApprove('session')}
              disabled={isInterrupting}
              title="在当前会话中记住此操作的授权"
            >
              <Check size={12} />
              <span>会话记住 (Session)</span>
            </button>
          )}

          {allowedGrantScopes.includes('project') && (
            <button
              type="button"
              className="btn-dock-scope"
              onClick={() => handleApprove('project')}
              disabled={isInterrupting}
              title="在当前项目中记住此操作的授权"
            >
              <Check size={12} />
              <span>项目记住 (Project)</span>
            </button>
          )}

          <button
            type="button"
            className="btn-dock-deny"
            onClick={handleDeny}
            disabled={isInterrupting}
            title="拒绝执行"
          >
            <X size={12} />
            <span>{showDenyInput ? '确认拒绝' : '拒绝 (Deny)'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
