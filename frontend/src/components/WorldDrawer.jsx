import React from 'react';
import { X, Server, RotateCw, CheckCircle2, Shield } from 'lucide-react';
import './WorldDrawer.css';

export default function WorldDrawer({
  isOpen,
  onClose,
  worldState,
  mcpStatus,
  onRetryMcp,
}) {
  if (!isOpen) return null;

  const status = worldState?.status || {};
  const tools = status.available_commands || [];
  const enabledMcp = mcpStatus?.enabled_servers || [];

  return (
    <div className="world-drawer-overlay" onClick={onClose}>
      <div className="world-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title">
            <Server size={16} className="title-icon" />
            <h3>环境状态与工具集 (World State)</h3>
          </div>
          <button className="btn-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="drawer-body">
          {/* Section 1: System info */}
          <div className="drawer-section">
            <h4 className="section-title">系统环境 (Environment)</h4>
            <div className="info-box font-mono">
              <div className="info-row">
                <span className="info-key">OS / Arch:</span>
                <span className="info-val">{status.os || 'windows'} ({status.arch || 'x86_64'})</span>
              </div>
              <div className="info-row">
                <span className="info-key">Shell:</span>
                <span className="info-val">{status.shell || 'pwsh'}</span>
              </div>
              <div className="info-row">
                <span className="info-key">Approval Policy:</span>
                <span className="info-val">{status.approval || 'per_action'}</span>
              </div>
              <div className="info-row">
                <span className="info-key">Working Dir:</span>
                <span className="info-val truncate">{status.cwd || '.'}</span>
              </div>
            </div>
          </div>

          {/* Section 2: Detected Toolchain */}
          <div className="drawer-section">
            <h4 className="section-title">可用工具链 (Detected Tools)</h4>
            <div className="tools-grid">
              {tools.map((t) => (
                <span key={t} className="tool-badge font-mono">
                  {t}
                </span>
              ))}
              {tools.length === 0 && <span className="text-muted">无可用工具</span>}
            </div>
          </div>

          {/* Section 3: MCP Servers */}
          <div className="drawer-section">
            <div className="section-header-row">
              <h4 className="section-title">MCP 服务器状态</h4>
              <button className="btn-retry" onClick={onRetryMcp}>
                <RotateCw size={12} />
                <span>重试连接</span>
              </button>
            </div>

            <div className="info-box font-mono">
              {enabledMcp.length > 0 ? (
                enabledMcp.map((srv) => (
                  <div key={srv} className="mcp-row">
                    <CheckCircle2 size={12} className="text-emerald" />
                    <span>{srv}</span>
                  </div>
                ))
              ) : (
                <div className="text-muted">
                  无活跃的外部 MCP 服务器 (内置工具数: {mcpStatus?.tool_count || 0})
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
