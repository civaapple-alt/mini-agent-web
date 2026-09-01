import React, { useState } from 'react';
import {
  Terminal,
  FileText,
  Folder,
  Cpu,
  Wrench,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Loader2,
  ShieldAlert,
  CheckCheck,
  X,
} from 'lucide-react';
import './ToolCard.css';

export default function ToolCard({
  tool,
  pendingApproval,
  onRespondApproval,
}) {
  const [showOutput, setShowOutput] = useState(false);
  const [copied, setCopied] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const [showDenyInput, setShowDenyInput] = useState(false);

  const { name, status, arguments: args, output, error, id } = tool;
  const isRunning = status === 'running';
  const isFailed = status === 'failed' || !!error;

  // Check if this tool is currently awaiting human approval
  const isAwaitingApproval =
    Boolean(pendingApproval) &&
    isRunning &&
    (pendingApproval.data?.action?.includes(name) ||
      pendingApproval.data?.tool === name ||
      pendingApproval.requestId === id ||
      true); // If pendingApproval exists and this tool is running, bind to it

  const getToolIcon = (toolName) => {
    const n = (toolName || '').toLowerCase();
    if (n === 'shell' || n === 'bash' || n === 'exec') {
      return <Terminal size={12} className="tool-type-icon text-amber" />;
    }
    if (n.includes('file') || n === 'view_file' || n === 'edit_file') {
      return <FileText size={12} className="tool-type-icon text-sky" />;
    }
    if (n.includes('dir') || n.includes('path')) {
      return <Folder size={12} className="tool-type-icon text-emerald" />;
    }
    if (n.includes('mcp')) {
      return <Cpu size={12} className="tool-type-icon text-purple" />;
    }
    return <Wrench size={12} className="tool-type-icon" />;
  };

  // Format arguments summary
  let argsSummary = '';
  if (typeof args === 'object' && args !== null) {
    if (args.command) {
      argsSummary = args.command;
    } else if (args.path || args.file_path || args.AbsolutePath) {
      argsSummary = args.path || args.file_path || args.AbsolutePath;
    } else {
      argsSummary = JSON.stringify(args);
    }
  } else if (typeof args === 'string') {
    argsSummary = args;
  }

  let displayOutput = error || output;
  if (displayOutput === null || displayOutput === undefined) {
    displayOutput = isRunning ? '等待工具执行结果...' : '(无返回内容)';
  } else if (typeof displayOutput === 'object') {
    displayOutput = JSON.stringify(displayOutput, null, 2);
  } else if (typeof displayOutput === 'string' && displayOutput.trim() === '') {
    displayOutput = '(空输出)';
  }

  const handleCopyOutput = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(displayOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApprove = (remember = false) => {
    if (onRespondApproval && pendingApproval) {
      onRespondApproval(pendingApproval.requestId, 'approved', '', remember);
    }
  };

  const handleDeny = () => {
    if (!showDenyInput) {
      setShowDenyInput(true);
      return;
    }
    if (onRespondApproval && pendingApproval) {
      onRespondApproval(pendingApproval.requestId, 'denied', denyReason.trim(), false);
    }
  };

  return (
    <div className={`tool-card ${status || 'running'} ${isFailed ? 'has-error' : ''} ${isAwaitingApproval ? 'awaiting-approval' : ''}`}>
      {/* Top Tool Header */}
      <div className="tool-header">
        <div className="tool-left-info">
          {getToolIcon(name)}
          <span className="tool-tag font-mono">{name || 'tool'}</span>
          {argsSummary && (
            <span className="tool-args-snippet font-mono" title={argsSummary}>
              {argsSummary}
            </span>
          )}
        </div>

        <div className="tool-right-badge">
          {isAwaitingApproval ? (
            <span className="badge-approval-pending font-mono">
              <ShieldAlert size={11} className="inline mr-1" />
              等待授权
            </span>
          ) : isRunning ? (
            <span className="badge running font-mono">
              <Loader2 size={11} className="animate-spin inline mr-1" />
              运行中
            </span>
          ) : isFailed ? (
            <span className="badge failed font-mono">
              <AlertTriangle size={11} className="inline mr-1" />
              失败
            </span>
          ) : (
            <span className="badge completed font-mono">
              <CheckCircle size={11} className="inline mr-1" />
              已完成
            </span>
          )}
        </div>
      </div>

      {/* Inline Security Approval Strip (Codex Native Style) */}
      {isAwaitingApproval && (
        <div className="tool-inline-approval">
          <div className="approval-callout">
            <ShieldAlert size={14} className="callout-icon" />
            <div className="callout-text">
              <span className="callout-title font-mono">安全权限审批 (Security Approval)</span>
              <p className="callout-desc">
                {pendingApproval.data?.action || `执行敏感操作: ${name}`}
              </p>
            </div>
          </div>

          {showDenyInput && (
            <div className="deny-reason-inline">
              <input
                type="text"
                className="deny-inline-input font-mono"
                placeholder="输入拒绝原因 (可选，回车确认)..."
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleDeny()}
                autoFocus
              />
            </div>
          )}

          <div className="inline-approval-btn-group">
            <button
              className="btn-approve-primary"
              onClick={() => handleApprove(false)}
              title="允许执行本次操作"
            >
              <Check size={12} />
              <span>允许一次 (Allow)</span>
            </button>

            <button
              className="btn-approve-remember"
              onClick={() => handleApprove(true)}
              title="在此会话中记住并允许此类操作"
            >
              <CheckCheck size={12} />
              <span>本会话始终允许 (Always)</span>
            </button>

            <button
              className="btn-deny-inline"
              onClick={handleDeny}
              title="拒绝执行"
            >
              <X size={12} />
              <span>{showDenyInput ? '确认拒绝' : '拒绝 (Deny)'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Output Section (Foldable) */}
      {(!isAwaitingApproval || !isRunning) && (
        <div className="tool-output-section">
          <div className="output-bar">
            <button
              className="toggle-output-btn font-mono"
              onClick={() => setShowOutput(!showOutput)}
            >
              <Terminal size={11} />
              <span>执行输出 (Output)</span>
              {showOutput ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>

            {showOutput && (
              <button
                className="btn-copy-output"
                onClick={handleCopyOutput}
                title="复制输出结果"
              >
                {copied ? <Check size={11} className="text-green" /> : <Copy size={11} />}
                <span>{copied ? '已复制' : '复制'}</span>
              </button>
            )}
          </div>

          {showOutput && (
            <div className="tool-output-box font-mono custom-scrollbar">
              <pre className={isFailed ? 'text-rose-400' : ''}>{displayOutput}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
