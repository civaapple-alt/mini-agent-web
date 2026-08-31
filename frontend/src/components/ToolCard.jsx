import React, { useState } from 'react';
import { Wrench, CheckCircle, AlertTriangle, ChevronDown, ChevronRight, Terminal, Loader2 } from 'lucide-react';
import './ToolCard.css';

export default function ToolCard({ tool }) {
  const [showOutput, setShowOutput] = useState(false);

  const { name, status, arguments: args, output, error } = tool;
  const isRunning = status === 'running';
  const isFailed = status === 'failed' || !!error;

  const formattedArgs = typeof args === 'object' ? JSON.stringify(args, null, 2) : args;

  let displayOutput = error || output;
  if (displayOutput === null || displayOutput === undefined) {
    displayOutput = isRunning ? '等待工具执行结果...' : '(无返回内容)';
  } else if (typeof displayOutput === 'object') {
    displayOutput = JSON.stringify(displayOutput, null, 2);
  } else if (typeof displayOutput === 'string' && displayOutput.trim() === '') {
    displayOutput = '(空输出)';
  }

  return (
    <div className={`tool-card ${status || 'running'}`}>
      <div className="tool-header">
        <div className="tool-info">
          <Wrench size={13} className="tool-icon" />
          <span className="tool-name">{name || 'tool'}</span>
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

      {formattedArgs && (
        <div className="tool-args font-mono">
          <pre>{formattedArgs}</pre>
        </div>
      )}

      <div className="tool-output-section">
        <button
          className="toggle-output-btn"
          onClick={() => setShowOutput(!showOutput)}
        >
          <Terminal size={12} />
          <span>执行结果 (Output)</span>
          {showOutput ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {showOutput && (
          <div className="tool-output-box font-mono">
            <pre className={isFailed ? 'text-rose-400' : ''}>{displayOutput}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
