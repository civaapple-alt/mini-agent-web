import React from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import './AssistantTextBlock.css';

export default function AssistantTextBlock({
  content,
  isCurrentBlock = false,
  isRunActive = false,
}) {
  if (!content && !isRunActive) return null;

  return (
    <div className="assistant-text-block">
      <div className="markdown-content assistant-answer">
        <MarkdownRenderer>{content || ''}</MarkdownRenderer>
        {isRunActive && isCurrentBlock && <span className="cursor-blink" />}
      </div>
    </div>
  );
}
