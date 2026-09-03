import React, { useRef, useEffect, useState } from 'react';
import { Sparkles, Terminal, Compass, TestTube2, ArrowDown } from 'lucide-react';
import MessageItem from './MessageItem';
import './ChatArea.css';

export default function ChatArea({
  messages,
  isGenerating,
  pendingApproval,
  onRespondApproval,
  onQuickPrompt,
  onRetryPrompt,
  autoScroll = true,
  wordWrap = true,
  fontSize = 13,
  isLoadingHistory = false,
}) {
  const scrollRef = useRef(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setIsScrolledUp(distanceFromBottom > 80);
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
      setIsScrolledUp(false);
    }
  };

  useEffect(() => {
    if (autoScroll && !isScrolledUp && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating, pendingApproval, autoScroll, isScrolledUp]);

  return (
    <div
      className={`chat-area custom-scrollbar ${wordWrap ? 'wrap-content' : 'nowrap-content'}`}
      style={{ fontSize: fontSize ? `${fontSize}px` : undefined }}
      ref={scrollRef}
      onScroll={handleScroll}
    >
      {isLoadingHistory ? (
        <div className="history-loading-container" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '32px 16px', alignItems: 'center' }}>
          <div className="skeleton-line" style={{ width: '40%', height: '14px', borderRadius: '4px', background: 'var(--border-color)', opacity: 0.5, animation: 'pulse 1.5s infinite' }} />
          <div className="skeleton-bubble" style={{ width: '80%', height: '48px', borderRadius: '8px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', opacity: 0.6 }} />
          <div className="skeleton-bubble" style={{ width: '70%', height: '64px', borderRadius: '8px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', opacity: 0.6 }} />
        </div>
      ) : messages.length === 0 ? (
        <div className="welcome-container">
          <div className="welcome-icon-box">
            <Sparkles size={24} />
          </div>
          <h2 className="welcome-title">Codex Agent Studio</h2>
          <p className="welcome-subtitle">
            基于 Codex JSON-RPC 协议与 Mini Agent 运行时。支持多轮交互、思维链打字机流式呈现、工具内嵌安全审批与全套工作流。
          </p>

          <div className="quick-prompts-grid">
            <button
              className="quick-chip"
              onClick={() => onQuickPrompt('检查当前工作区文件与结构，给出简短摘要')}
            >
              <Terminal size={12} className="text-amber" />
              <span>检查工作区文件与结构</span>
            </button>
            <button
              className="quick-chip"
              onClick={() => onQuickPrompt('开启只读 Plan Mode 探索架构设计')}
            >
              <Compass size={12} className="text-sky" />
              <span>开启只读 Plan Mode 规划</span>
            </button>
            <button
              className="quick-chip"
              onClick={() => onQuickPrompt('运行自动化单元测试并总结测试覆盖情况')}
            >
              <TestTube2 size={12} className="text-emerald" />
              <span>运行单元测试套件</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="messages-list">
          {messages.map((msg, index) => (
            <MessageItem
              key={msg.id || `msg_${index}`}
              message={msg}
              isLast={index === messages.length - 1}
              isGenerating={isGenerating}
              pendingApproval={pendingApproval}
              onRespondApproval={onRespondApproval}
              onRetryPrompt={onRetryPrompt}
            />
          ))}
        </div>
      )}

      {/* Floating Scroll-to-Bottom Pill Button */}
      {isScrolledUp && (
        <button
          className="btn-scroll-bottom"
          onClick={scrollToBottom}
          title="回到底部最新消息"
        >
          <ArrowDown size={12} />
          <span>回到底部</span>
        </button>
      )}
    </div>
  );
}
