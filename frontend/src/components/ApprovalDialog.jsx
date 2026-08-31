import React from 'react';
import { ShieldAlert, Check, X } from 'lucide-react';
import './ApprovalDialog.css';

export default function ApprovalDialog({ request, onRespond }) {
  if (!request) return null;

  const { requestId, data } = request;
  const formattedData = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);

  return (
    <div className="approval-dialog">
      <div className="approval-content">
        <div className="approval-icon-box">
          <ShieldAlert size={20} className="approval-icon" />
        </div>

        <div className="approval-details">
          <div className="approval-title-row">
            <h4>安全权限审批请求 (Security Approval Required)</h4>
            <span className="request-id font-mono">[{requestId}]</span>
          </div>
          <div className="approval-description font-mono">
            <pre>{formattedData}</pre>
          </div>
        </div>
      </div>

      <div className="approval-actions">
        <button
          className="btn-decision deny"
          onClick={() => onRespond(requestId, 'denied')}
        >
          <X size={14} />
          <span>拒绝 (Deny)</span>
        </button>

        <button
          className="btn-decision allow"
          onClick={() => onRespond(requestId, 'approved')}
        >
          <Check size={14} />
          <span>允许执行 (Allow)</span>
        </button>
      </div>
    </div>
  );
}
