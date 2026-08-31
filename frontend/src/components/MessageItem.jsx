import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ThinkingBlock from './ThinkingBlock';
import ToolCard from './ToolCard';

export default function MessageItem({ message, isLast, isGenerating }) {
  const { role, text, thinking, tools = [], blocks = [] } = message;

  if (role === 'user') {
    return (
      <div className="message-row user">
        <div className="user-bubble">{text}</div>
      </div>
    );
  }

  const isStreamingThis = isLast && isGenerating;

  return (
    <div className="message-row assistant">
      <div className="avatar-bot">MA</div>

      <div className="assistant-container">
        {/* Render sequential blocks if present */}
        {blocks.length > 0 ? (
          blocks.map((block, idx) => {
            if (block.type === 'thinking') {
              return (
                <ThinkingBlock
                  key={`thinking_${idx}`}
                  content={block.content}
                  isStreaming={Boolean(block.isStreaming && isStreamingThis)}
                />
              );
            }
            if (block.type === 'tool') {
              return (
                <ToolCard
                  key={block.id || `tool_${idx}`}
                  tool={block}
                />
              );
            }
            if (block.type === 'text') {
              return (
                <div
                  key={`text_${idx}`}
                  className={`markdown-content ${isStreamingThis && idx === blocks.length - 1 ? 'cursor-blink' : ''}`}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {block.content || ''}
                  </ReactMarkdown>
                </div>
              );
            }
            return null;
          })
        ) : (
          /* Backward compatibility fallback */
          <>
            {thinking && (
              <ThinkingBlock
                content={thinking}
                isStreaming={isStreamingThis && !text}
              />
            )}

            {tools.length > 0 && (
              <div className="tools-list">
                {tools.map((t, idx) => (
                  <ToolCard key={t.id || idx} tool={t} />
                ))}
              </div>
            )}

            {(text || isStreamingThis) && (
              <div className={`markdown-content ${isStreamingThis ? 'cursor-blink' : ''}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {text || ''}
                </ReactMarkdown>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
