import React, { useRef, useEffect } from 'react';
import { Sparkles, Terminal, Compass, TestTube2, GitBranch } from 'lucide-react';
import MessageItem from './MessageItem';
import './ChatArea.css';

export default function ChatArea({
  messages,
  isGenerating,
  pendingApproval,
  onRespondApproval,
  onQuickPrompt,
  onRetryPrompt,
}) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating, pendingApproval]);

  return (
    <div className="chat-area custom-scrollbar" ref={scrollRef}>
      {messages.length === 0 ? (
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
              key={index}
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
    </div>
  );
}
