import React from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import './Toast.css';

export default function Toast({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((t) => {
        const icons = {
          success: <CheckCircle2 size={16} className="toast-icon text-emerald" />,
          warning: <AlertTriangle size={16} className="toast-icon text-amber" />,
          error: <XCircle size={16} className="toast-icon text-rose" />,
          info: <Info size={16} className="toast-icon text-sky" />,
        };
        const icon = icons[t.type] || icons.info;

        return (
          <div key={t.id} className={`toast-card toast-${t.type || 'info'}`}>
            <div className="toast-content">
              {icon}
              <span className="toast-message">{t.message}</span>
            </div>
            <button
              className="toast-close-btn"
              onClick={() => onDismiss(t.id)}
              aria-label="关闭通知"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
