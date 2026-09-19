import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Brain, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import './ThinkingBlock.css';

export default function ThinkingBlock({ content, isStreaming, isCurrentBlock = false }) {
  // Keep the current block open and collapse it when execution advances.
  const [isOpen, setIsOpen] = useState(Boolean(isStreaming || isCurrentBlock));
  const wasCurrentBlockRef = useRef(Boolean(isCurrentBlock));
  const [copied, setCopied] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const startTimeRef = useRef(Date.now());
  const finalTimeRef = useRef(null);
  const bodyRef = useRef(null);
  const followLatestRef = useRef(true);

  useLayoutEffect(() => {
    if (isCurrentBlock) setIsOpen(true);
    else if (wasCurrentBlockRef.current) setIsOpen(false);
    wasCurrentBlockRef.current = isCurrentBlock;
  }, [isCurrentBlock]);

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

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !followLatestRef.current) return;
    // The thinking body has its own bounded scroll area. Keep that viewport
    // pinned to the newest reasoning text while the user has not scrolled it
    // away from the bottom.
    body.scrollTop = body.scrollHeight;
  }, [content, isOpen, isStreaming]);

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

  const handleBodyScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight;
    followLatestRef.current = distanceFromBottom <= 24;
  };

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
            {isStreaming ? '思考中' : '思考'}
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
        <div
          ref={bodyRef}
          className="thinking-body font-mono notranslate"
          translate="no"
          onScroll={handleBodyScroll}
        >
          {content}
          {isStreaming && <span className="cursor-blink"></span>}
        </div>
      )}
    </div>
  );
}
