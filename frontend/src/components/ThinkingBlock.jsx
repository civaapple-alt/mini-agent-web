import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import './ThinkingBlock.css';

export default function ThinkingBlock({ content, isStreaming }) {
  const [isOpen, setIsOpen] = useState(true);

  if (!content && !isStreaming) return null;

  return (
    <div className="thinking-container">
      <div
        className="thinking-header"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="thinking-title">
          <Brain
            size={14}
            className={`thinking-icon ${isStreaming ? 'pulse' : ''}`}
          />
          <span>
            {isStreaming ? 'Reasoning Process (思考中...)' : 'Reasoning Process (思考完毕)'}
          </span>
        </div>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>

      {isOpen && (
        <div className="thinking-body font-mono">
          {content}
          {isStreaming && <span className="cursor-blink"></span>}
        </div>
      )}
    </div>
  );
}
