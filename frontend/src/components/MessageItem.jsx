import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ThinkingBlock from './ThinkingBlock';
import ToolCard from './ToolCard';

export default function MessageItem({ message, isLast, isGenerating }) {
  const { role, text, thinking, tools = [] } = message;

  if (role === 'user') {
    return (
      <div className="message-row user">
        <div className="user-bubble">
          {text}
        </div>
      </div>
    );
  }

  const isStreamingThis = isLast && isGenerating;

  return (
    <div className="message-row assistant">
      <div className="avatar-bot">MA</div>

      <div className="assistant-container">
        {/* Thinking Accordion */}
        {(thinking || (isStreamingThis && !text && tools.length === 0)) && (
          <ThinkingBlock
            content={thinking}
            isStreaming={isStreamingThis && !text}
          />
        )}

        {/* Tools */}
        {tools.length > 0 && (
          <div className="tools-list">
            {tools.map((t, idx) => (
              <ToolCard key={t.id || idx} tool={t} />
            ))}
          </div>
        )}

        {/* Text Content */}
        {(text || isStreamingThis) && (
          <div className={`markdown-content ${isStreamingThis ? 'cursor-blink' : ''}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {text || ''}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
