import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, Sparkles, User, RotateCcw } from 'lucide-react';
import ThinkingBlock from './ThinkingBlock';
import ToolCard from './ToolCard';

export default function MessageItem({ message, isLast, isGenerating, onRetryPrompt }) {
  const { role, text, thinking, tools = [], blocks = [], usage } = message;
  const [copied, setCopied] = useState(false);

  const handleCopyText = (content) => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (role === 'user') {
    return (
      <div className="message-row user">
        <div className="user-bubble-container">
          <div className="user-bubble">{text}</div>
          <div className="user-actions">
            <button
              className="msg-action-btn"
              onClick={() => handleCopyText(text)}
              title="复制提问"
            >
              {copied ? <Check size={11} className="text-green" /> : <Copy size={11} />}
            </button>
            {onRetryPrompt && (
              <button
                className="msg-action-btn"
                onClick={() => onRetryPrompt(text)}
                title="重新发送此提示词"
              >
                <RotateCcw size={11} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isStreamingThis = isLast && isGenerating;

  // Extract all text content from blocks or fallback text
  const fullResponseText = blocks.length > 0
    ? blocks.filter((b) => b.type === 'text').map((b) => b.content).join('\n\n')
    : text;

  return (
    <div className="message-row assistant">
      <div className="avatar-bot">
        <Sparkles size={14} />
      </div>

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

        {/* Footer actions & usage */}
        {!isStreamingThis && fullResponseText && (
          <div className="assistant-footer">
            <button
              className="msg-action-btn"
              onClick={() => handleCopyText(fullResponseText)}
              title="复制回复 Markdown"
            >
              {copied ? <Check size={11} className="text-green" /> : <Copy size={11} />}
              <span>{copied ? '已复制' : '复制回答'}</span>
            </button>

            {usage && (
              <div className="token-usage-meta font-mono">
                <span>Tokens: In {usage.input_tokens || 0} · Out {usage.output_tokens || 0}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
