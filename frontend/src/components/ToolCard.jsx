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
} from 'lucide-react';
import './ToolCard.css';

export default function ToolCard({ tool }) {
  const [showOutput, setShowOutput] = useState(false);
  const [copied, setCopied] = useState(false);

  const { name, status, arguments: args, output, error } = tool;
  const isRunning = status === 'running';
  const isFailed = status === 'failed' || !!error;

  const getToolIcon = (toolName) => {
    const n = (toolName || '').toLowerCase();
    if (n === 'shell' || n === 'bash' || n === 'exec') {
      return <Terminal size={13} className="tool-icon text-amber" />;
    }
    if (n.includes('file') || n === 'view_file' || n === 'edit_file') {
      return <FileText size={13} className="tool-icon text-sky" />;
    }
    if (n.includes('dir') || n.includes('path')) {
      return <Folder size={13} className="tool-icon text-emerald" />;
    }
    if (n.includes('mcp')) {
      return <Cpu size={13} className="tool-icon text-purple" />;
    }
    return <Wrench size={13} className="tool-icon" />;
  };

  // Format arguments summary
  let argsSummary = '';
  if (typeof args === 'object' && args !== null) {
    if (args.command) {
      argsSummary = args.command;
    } else if (args.path || args.file_path || args.AbsolutePath) {
      argsSummary = args.path || args.file_path || args.AbsolutePath;
    } else {
      argsSummary = JSON.stringify(args, null, 2);
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
    <div className={`tool-card ${status || 'running'} ${isFailed ? 'has-error' : ''}`}>
      <div className="tool-header">
        <div className="tool-info">
          {getToolIcon(name)}
          <span className="tool-name font-mono">{name || 'tool'}</span>
          {argsSummary && (
            <span className="tool-args-preview font-mono" title={argsSummary}>
              {argsSummary.length > 80 ? `${argsSummary.slice(0, 80)}...` : argsSummary}
            </span>
          )}
        </div>

        <div className="tool-status-badge">
          {isRunning && (
            <span className="badge running">
              <Loader2 size={11} className="animate-spin inline-block mr-1" />
              执行中...
            </span>
          )}
          {!isRunning && !isFailed && (
            <span className="badge completed">
              <CheckCircle size={11} className="inline-block mr-1" />
              已完成
            </span>
          )}
          {isFailed && (
            <span className="badge failed">
              <AlertTriangle size={11} className="inline-block mr-1" />
              失败
            </span>
          )}
        </div>
      </div>

      <div className="tool-output-section">
        <div className="output-header-bar">
          <button
            className="toggle-output-btn"
            onClick={() => setShowOutput(!showOutput)}
          >
            <Terminal size={12} />
            <span>执行结果 (Output)</span>
            {showOutput ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
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
    </div>
  );
}
