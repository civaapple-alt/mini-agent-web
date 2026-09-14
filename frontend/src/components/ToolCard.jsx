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
} from 'lucide-react';
import './ToolCard.css';

export default function ToolCard({
  tool,
  pendingApproval,
}) {
  const [showOutput, setShowOutput] = useState(false);
  const [copied, setCopied] = useState(false);

  const { status, output, error, id } = tool;
  const name = tool.name || tool.toolName || tool.tool || tool.tool_name || '';
  const args = tool.arguments ?? tool.args;
  const normalizedStatus = status === 'inProgress' ? 'running' : status;
  const isRunning = normalizedStatus === 'running';
  const isFailed = normalizedStatus === 'failed' || !!error;
  const approvalState = tool.approval?.state || null;
  const pendingCallId = pendingApproval?.data?.callId || pendingApproval?.data?.call_id;
  const pendingRequestId = pendingApproval?.requestId;
  const pendingToolName = pendingApproval?.data?.toolName || pendingApproval?.data?.tool_name;

  // Check if this tool is currently awaiting human approval
  const isAwaitingApproval =
    isRunning && (
      approvalState === 'pending' || (
        Boolean(pendingApproval) &&
        Boolean(
          (pendingCallId && pendingCallId === id) ||
            (!pendingCallId && pendingRequestId === id) ||
            (!pendingCallId && !id && pendingToolName === name)
        )
      )
    );

  const approvalResult = approvalState && approvalState !== 'pending'
    ? tool.approval
    : null;
  const approvalScopeLabels = {
    once: '本次',
    session: '会话',
    project: '项目',
  };
  const approvalResultText = approvalResult?.state === 'approved'
    ? `用户已允许${approvalScopeLabels[approvalResult.grantScope] || ''}执行${approvalResult.source === 'other_window' ? ' · 其他窗口已处理' : ''}`
    : approvalResult?.state === 'denied'
      ? `用户已拒绝执行${approvalResult.reason ? ` · ${approvalResult.reason}` : ''}`
      : `审批已失效${approvalResult?.source === 'interrupted' ? ' · Turn 已停止' : ''}`;

  const getToolIcon = (toolName) => {
    const n = (toolName || '').toLowerCase();
    if (n === 'shell' || n === 'bash' || n === 'exec' || n === 'run_command') {
      return <Terminal size={12} className="tool-type-icon text-amber" />;
    }
    if (
      n.includes('file') ||
      n.includes('read') ||
      n.includes('write') ||
      n.includes('edit')
    ) {
      return <FileText size={12} className="tool-type-icon text-sky" />;
    }
    if (n.includes('dir') || n.includes('path') || n.includes('list') || n.includes('find')) {
      return <Folder size={12} className="tool-type-icon text-emerald" />;
    }
    if (n.includes('mcp') || n.includes('fetch') || n.includes('web')) {
      return <Cpu size={12} className="tool-type-icon text-purple" />;
    }
    return <Wrench size={12} className="tool-type-icon" />;
  };

  // Format arguments summary
  let argsSummary = '';
  if (typeof args === 'object' && args !== null) {
    if (args.command) {
      argsSummary = args.command;
    } else if (args.path || args.file_path || args.target_file || args.TargetFile || args.AbsolutePath) {
      argsSummary = args.path || args.file_path || args.target_file || args.TargetFile || args.AbsolutePath;
    } else if (args.query || args.pattern || args.url) {
      argsSummary = args.query || args.pattern || args.url;
    } else if (Object.keys(args).length > 0) {
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

  return (
    <div
      className={`tool-card notranslate ${normalizedStatus || 'running'} ${isFailed ? 'has-error' : ''} ${isAwaitingApproval ? 'awaiting-approval' : ''}`}
      translate="no"
    >
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

      {approvalResult && (
        <div
          className={`tool-approval-result ${approvalResult.state}`}
          role="status"
          title={approvalResult.reason || undefined}
        >
          {approvalResult.state === 'approved' ? (
            <CheckCircle size={12} />
          ) : approvalResult.state === 'denied' ? (
            <AlertTriangle size={12} />
          ) : (
            <ShieldAlert size={12} />
          )}
          <span>{approvalResultText}</span>
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
