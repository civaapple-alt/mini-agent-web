import React, { useState, useEffect, useRef } from 'react';
import { Brain, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import './ThinkingBlock.css';

export default function ThinkingBlock({ content, isStreaming }) {
  const [isOpen, setIsOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const startTimeRef = useRef(Date.now());
  const finalTimeRef = useRef(null);

  useEffect(() => {
    let interval = null;
    if (isStreaming) {
      interval = setInterval(() => {
        const secs = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
        setElapsedSec(secs);
      }, 100);
    } else if (finalTimeRef.current === null && elapsedSec > 0) {
      finalTimeRef.current = elapsedSec;
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isStreaming, elapsedSec]);

  if (!content && !isStreaming) return null;

  const charCount = (content || '').length;
  const timeDisplay = finalTimeRef.current || elapsedSec;

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const previewSnippet = (content || '').split('\n')[0].slice(0, 60);

  return (
    <div
      className={`thinking-container notranslate ${isStreaming ? 'streaming' : ''}`}
      translate="no"
    >
      <div
        className="thinking-header"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="thinking-title">
          <Brain
            size={14}
            className={`thinking-icon ${isStreaming ? 'pulse' : ''}`}
          />
          <span className="thinking-label">
            {isStreaming ? 'Reasoning Process (思考中...)' : 'Reasoning Process (思考完毕)'}
          </span>
          <span className="thinking-meta font-mono">
            {isStreaming
              ? `${timeDisplay}s`
              : `${timeDisplay > 0 ? `${timeDisplay}s · ` : ''}${charCount} 字符`}
          </span>
        </div>

        <div className="thinking-controls" onClick={(e) => e.stopPropagation()}>
          {content && (
            <button
              className="btn-copy-micro"
              onClick={handleCopy}
              title="复制思考过程"
            >
              {copied ? <Check size={12} className="text-green" /> : <Copy size={12} />}
            </button>
          )}
          <button className="btn-toggle-micro" onClick={() => setIsOpen(!isOpen)}>
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </div>

      {!isOpen && previewSnippet && (
        <div className="thinking-preview font-mono notranslate" translate="no" onClick={() => setIsOpen(true)}>
          <span>{previewSnippet}...</span>
        </div>
      )}

      {isOpen && (
        <div className="thinking-body font-mono notranslate" translate="no">
          {content}
          {isStreaming && <span className="cursor-blink"></span>}
        </div>
      )}
    </div>
  );
}
