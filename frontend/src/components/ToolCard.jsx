import React, { useState } from 'react';
import { Wrench, CheckCircle, AlertTriangle, ChevronDown, ChevronRight, Terminal } from 'lucide-react';
import './ToolCard.css';

export default function ToolCard({ tool }) {
  const [showOutput, setShowOutput] = useState(false);

  const { name, status, arguments: args, output, error } = tool;
  const isRunning = status === 'running';
  const isFailed = status === 'failed' || !!error;

  const formattedArgs = typeof args === 'object' ? JSON.stringify(args, null, 2) : args;
  const formattedOutput = typeof output === 'object' ? JSON.stringify(output, null, 2) : output;

  return (
    <div className={`tool-card ${status}`}>
      <div className="tool-header">
        <div className="tool-info">
          <Wrench size={13} className={`tool-icon ${isRunning ? 'spinning' : ''}`} />
          <span className="tool-name">{name || 'tool'}</span>
        </div>

        <div className="tool-status-badge">
          {isRunning && <span className="badge running">Running...</span>}
          {!isRunning && !isFailed && <span className="badge completed">Completed</span>}
          {isFailed && <span className="badge failed">Failed</span>}
        </div>
      </div>

      {formattedArgs && (
        <div className="tool-args font-mono">
          <pre>{formattedArgs}</pre>
        </div>
      )}

      {(formattedOutput || error) && (
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
              <pre>{error || formattedOutput}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
