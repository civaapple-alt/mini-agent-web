import React, { useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight } from 'lucide-react';
import './AssistantTextBlock.css';

export default function AssistantTextBlock({
  content,
  isCurrentBlock = false,
  isRunActive = false,
}) {
  const startsFolded = isRunActive && !isCurrentBlock;
  const [isOpen, setIsOpen] = useState(!startsFolded);
  const [hasBeenFolded, setHasBeenFolded] = useState(startsFolded);
  const wasCurrentBlockRef = useRef(Boolean(isCurrentBlock));
  const wasRunActiveRef = useRef(Boolean(isRunActive));

  useLayoutEffect(() => {
    if (isRunActive && isCurrentBlock) {
      setIsOpen(true);
    } else if (
      isRunActive &&
      !isCurrentBlock &&
      (wasCurrentBlockRef.current || !wasRunActiveRef.current)
    ) {
      setIsOpen(false);
      setHasBeenFolded(true);
    }

    wasCurrentBlockRef.current = Boolean(isCurrentBlock);
    wasRunActiveRef.current = Boolean(isRunActive);
  }, [isCurrentBlock, isRunActive]);

  if (!content && !isRunActive) return null;

  const preview = (content || '').trim().replace(/\s+/g, ' ').slice(0, 180);

  if (!isOpen) {
    return (
      <button
        type="button"
        className="assistant-text-folded"
        aria-label="展开已收起的助手内容"
        aria-expanded={false}
        onClick={() => setIsOpen(true)}
      >
        <span className="assistant-text-folded-preview">
          {preview || '助手内容'}
        </span>
        <ChevronRight size={13} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="assistant-text-block">
      <div className="markdown-content assistant-answer">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content || ''}
        </ReactMarkdown>
        {isRunActive && isCurrentBlock && <span className="cursor-blink" />}
      </div>
      {hasBeenFolded && (
        <div className="assistant-text-folded-action">
          <button
            type="button"
            className="assistant-text-fold-toggle"
            aria-label="收起助手内容"
            aria-expanded={true}
            onClick={() => setIsOpen(false)}
          >
            收起
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
