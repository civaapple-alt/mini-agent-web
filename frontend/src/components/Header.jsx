import React from 'react';
import { GitBranch, ShieldAlert, Compass, Cpu, CheckCircle2, AlertCircle } from 'lucide-react';
import './Header.css';

export default function Header({
  currentThread,
  isConnected,
  planActive,
  onTogglePlan,
  onOpenWorld,
}) {
  return (
    <header className="app-header">
      <div className="header-left">
        <div className="app-logo">MA</div>
        <div className="app-title-group">
          <h1 className="app-title">Mini Agent Studio</h1>
          <span className="version-tag">v0.6.0</span>
        </div>
      </div>

      <div className="header-center">
        <div className="thread-badge">
          <GitBranch size={13} className="badge-icon text-sky" />
          <span>Thread: <strong className="thread-name">{currentThread}</strong></span>
        </div>

        {planActive && (
          <div className="plan-badge active">
            <ShieldAlert size={13} className="badge-icon text-amber" />
            <span>Plan Mode Active</span>
          </div>
        )}
      </div>

      <div className="header-right">
        <button
          className={`header-btn ${planActive ? 'active-plan' : ''}`}
          onClick={onTogglePlan}
          title="切换只读 Plan Mode"
        >
          <Compass size={14} />
          <span>Plan Mode</span>
        </button>

        <button
          className="header-btn"
          onClick={onOpenWorld}
          title="查看环境与工具"
        >
          <Cpu size={14} />
          <span>World & Tools</span>
        </button>

        <div
          className={`status-indicator ${isConnected ? 'online' : 'offline'}`}
          title={isConnected ? 'WebSocket Connected' : 'Disconnected'}
        >
          <span className="dot"></span>
        </div>
      </div>
    </header>
  );
}
