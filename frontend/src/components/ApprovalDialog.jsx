import React, { useState } from 'react';
import { ShieldAlert, Check, X, CheckCheck, Terminal, AlertTriangle } from 'lucide-react';
import './ApprovalDialog.css';

export default function ApprovalDialog({ request, onRespond }) {
  const [denyReason, setDenyReason] = useState('');
  const [showDenyReasonInput, setShowDenyReasonInput] = useState(false);

  if (!request) return null;

  const { requestId, data } = request;
  const actionText = typeof data === 'object' && data !== null
    ? data.action || JSON.stringify(data, null, 2)
    : String(data);

  const handleDeny = () => {
    if (!showDenyReasonInput) {
      setShowDenyReasonInput(true);
      return;
    }
    onRespond(requestId, 'denied', denyReason.trim(), false);
  };

  return (
    <div className="approval-modal-overlay">
      <div className="approval-dialog">
        <div className="approval-header">
          <div className="approval-icon-box">
            <ShieldAlert size={20} className="approval-icon" />
          </div>
          <div className="approval-header-text">
            <h4>安全权限审批请求 (Security Approval Required)</h4>
            <span className="request-id font-mono">Request ID: {requestId}</span>
          </div>
        </div>

        <div className="approval-body">
          <div className="action-warning-banner">
            <AlertTriangle size={14} className="text-amber" />
            <span>Agent 尝试在系统环境中执行敏感工具或 Shell 命令，请审阅下方操作：</span>
          </div>

          <div className="approval-code-box font-mono custom-scrollbar">
            <pre>{actionText}</pre>
          </div>

          {showDenyReasonInput && (
            <div className="deny-reason-box">
              <input
                type="text"
                className="deny-input font-mono"
                placeholder="输入拒绝原因 (可选，模型将根据此原因调整行动)..."
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="approval-actions">
          <button
            className="btn-decision deny"
            onClick={handleDeny}
            title="拒绝该操作"
          >
            <X size={14} />
            <span>{showDenyReasonInput ? '确认拒绝 (Confirm Deny)' : '拒绝 (Deny)'}</span>
          </button>

          <div className="allow-group">
            <button
              className="btn-decision allow-remember"
              onClick={() => onRespond(requestId, 'approved', '', true)}
              title="允许并在此会话中记住此操作放行"
            >
              <CheckCheck size={14} />
              <span>始终允许 (Always Allow)</span>
            </button>

            <button
              className="btn-decision allow-primary"
              onClick={() => onRespond(requestId, 'approved', '', false)}
              title="仅允许执行本次操作"
            >
              <Check size={14} />
              <span>允许一次 (Allow)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
