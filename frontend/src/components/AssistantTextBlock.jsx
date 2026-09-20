import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content || ''}
        </ReactMarkdown>
        {isRunActive && isCurrentBlock && <span className="cursor-blink" />}
      </div>
    </div>
  );
}
