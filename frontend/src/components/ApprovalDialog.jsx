import React, { useState } from 'react';
import { ShieldAlert, Check, CheckCheck, X, ChevronRight } from 'lucide-react';
import './ApprovalDialog.css';

export default function ApprovalDialog({ request, onRespond }) {
  if (!request) return null;

  const { requestId, data } = request;
  const actionText =
    typeof data === 'object' && data !== null
      ? data.action || JSON.stringify(data)
      : String(data);

  return (
    <div className="approval-floating-toast">
      <div className="toast-left">
        <ShieldAlert size={15} className="toast-icon" />
        <div className="toast-info">
          <span className="toast-title font-mono">待审批操作 (Approval Required)</span>
          <span className="toast-action font-mono" title={actionText}>
            {actionText.length > 60 ? `${actionText.slice(0, 60)}...` : actionText}
          </span>
        </div>
      </div>

      <div className="toast-actions">
        <button
          className="toast-btn allow"
          onClick={() => onRespond(requestId, 'approved', '', false)}
          title="允许执行本次操作"
        >
          <Check size={12} />
          <span>允许 (Allow)</span>
        </button>
        <button
          className="toast-btn always"
          onClick={() => onRespond(requestId, 'approved', '', true)}
          title="本会话始终允许此类操作"
        >
          <CheckCheck size={12} />
          <span>始终允许</span>
        </button>
        <button
          className="toast-btn deny"
          onClick={() => onRespond(requestId, 'denied', 'Denied by user', false)}
          title="拒绝执行"
        >
          <X size={12} />
          <span>拒绝</span>
        </button>
      </div>
    </div>
  );
}
