import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Navigation } from 'lucide-react';
import './InputBar.css';

export default function InputBar({
  isGenerating,
  onSendMessage,
  onSteerMessage,
  onInterrupt,
}) {
  const [prompt, setPrompt] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [prompt]);

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    const text = prompt.trim();
    if (!text) return;

    if (isGenerating) {
      onSteerMessage(text);
    } else {
      onSendMessage(text);
    }
    setPrompt('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="input-bar-container">
      {isGenerating && (
        <div className="steer-hint-banner">
          <div className="steer-hint-text">
            <Navigation size={13} className="steer-icon pulse" />
            <span>Agent 正在执行... 您可以在下方输入指令实时纠偏 (Steer)</span>
          </div>
          <button className="btn-interrupt-small" onClick={onInterrupt}>
            中断当前轮次
          </button>
        </div>
      )}

      <form className="input-form" onSubmit={handleSubmit}>
        <div className="textarea-wrapper">
          <textarea
            ref={textareaRef}
            rows={1}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isGenerating
                ? 'Agent 执行中... 输入内容并回车可动态纠偏 (Steer)'
                : '输入任务或问题... (Enter 发送, Shift+Enter 换行)'
            }
            className="chat-textarea"
          />
        </div>

        <div className="input-actions">
          {isGenerating ? (
            <button
              type="button"
              className="btn-action stop"
              onClick={onInterrupt}
              title="中断生成"
            >
              <Square size={14} />
              <span>停止</span>
            </button>
          ) : (
            <button
              type="submit"
              className="btn-action send"
              disabled={!prompt.trim()}
              title="发送"
            >
              <Send size={14} />
              <span>发送</span>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
