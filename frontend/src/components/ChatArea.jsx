import React, { useRef, useEffect } from 'react';
import { Bot } from 'lucide-react';
import MessageItem from './MessageItem';
import './ChatArea.css';

export default function ChatArea({
  messages,
  isGenerating,
  onQuickPrompt,
}) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating]);

  return (
    <div className="chat-area" ref={scrollRef}>
      {messages.length === 0 ? (
        <div className="welcome-container">
          <div className="welcome-icon-box">
            <Bot size={28} />
          </div>
          <h2 className="welcome-title">Mini Agent 交互控制台</h2>
          <p className="welcome-subtitle">
            连接底层 Mini Agent Harness 与 Rust App Server，支持多轮交互、思维链 (Thinking) 流式呈现、工具执行卡片与安全权限审批。
          </p>

          <div className="quick-prompts-grid">
            <button
              className="quick-chip"
              onClick={() => onQuickPrompt('检查当前工作区文件与结构，给出简短摘要')}
            >
              🔍 检查工作区文件与结构
            </button>
            <button
              className="quick-chip"
              onClick={() => onQuickPrompt('开启只读 Plan Mode 探索架构设计')}
            >
              📋 开启只读 Plan Mode 探索架构
            </button>
            <button
              className="quick-chip"
              onClick={() => onQuickPrompt('运行自动化单元测试并总结测试覆盖情况')}
            >
              🧪 运行单元测试套件
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
