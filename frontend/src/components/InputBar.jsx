import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Navigation,
  Compass,
  Target,
  Sparkles,
  Command,
  ShieldAlert,
  Check,
  CheckCheck,
  X,
} from 'lucide-react';
import './InputBar.css';

const SLASH_COMMANDS = [
  { cmd: '/plan', desc: '开启/切换只读规划探索模式', icon: <Compass size={13} className="text-amber" /> },
  { cmd: '/goal', desc: '启动目标驱动多里程碑收敛模式', icon: <Target size={13} className="text-green" /> },
  { cmd: '/clear', desc: '清空当前页面消息', icon: <Sparkles size={13} className="text-sky" /> },
  { cmd: '/steer', desc: '发送运行时纠偏指令', icon: <Navigation size={13} className="text-purple" /> },
  { cmd: '/status', desc: '查看环境探测与状态', icon: <Command size={13} className="text-emerald" /> },
];

export default function InputBar({
  isGenerating,
  planActive,
  pendingApproval,
  onRespondApproval,
  onSendMessage,
  onSteerMessage,
  onInterrupt,
  onTogglePlan,
}) {
  const [prompt, setPrompt] = useState('');
  const [showSlashPopup, setShowSlashPopup] = useState(false);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [denyReason, setDenyReason] = useState('');
  const [showDenyInput, setShowDenyInput] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [prompt]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setPrompt(val);

    if (val.startsWith('/') && !val.includes(' ') && !isGenerating) {
      setShowSlashPopup(true);
      setSelectedSlashIndex(0);
    } else {
      setShowSlashPopup(false);
    }
  };

  const handleSelectSlashCommand = (cmdObj) => {
    if (cmdObj.cmd === '/plan') {
      onTogglePlan();
      setPrompt('');
    } else {
      setPrompt(`${cmdObj.cmd} `);
    }
    setShowSlashPopup(false);
    if (textareaRef.current) textareaRef.current.focus();
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    const text = prompt.trim();
    if (!text) return;

    if (text === '/plan') {
      onTogglePlan();
      setPrompt('');
      return;
    }

    if (isGenerating) {
      onSteerMessage(text);
    } else {
      onSendMessage(text);
    }
    setPrompt('');
    setShowSlashPopup(false);
  };

  const handleKeyDown = (e) => {
    if (showSlashPopup) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev + 1) % SLASH_COMMANDS.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectSlashCommand(SLASH_COMMANDS[selectedSlashIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setShowSlashPopup(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleApprove = (remember = false) => {
    if (onRespondApproval && pendingApproval) {
      onRespondApproval(pendingApproval.requestId, 'approved', '', remember);
      setShowDenyInput(false);
      setDenyReason('');
    }
  };

  const handleDeny = () => {
    if (!showDenyInput) {
      setShowDenyInput(true);
      return;
    }
    if (onRespondApproval && pendingApproval) {
      onRespondApproval(pendingApproval.requestId, 'denied', denyReason.trim(), false);
      setShowDenyInput(false);
      setDenyReason('');
    }
  };

  // Format pending approval action text
  const approvalActionText = pendingApproval
    ? typeof pendingApproval.data === 'object' && pendingApproval.data !== null
      ? pendingApproval.data.action || JSON.stringify(pendingApproval.data, null, 2)
      : String(pendingApproval.data)
    : '';

  return (
    <div className="input-bar-container">
      {/* Attached Composer Approval Dock */}
      {pendingApproval && (
        <div className="composer-approval-dock">
          <div className="dock-header">
            <div className="dock-title-group">
              <ShieldAlert size={14} className="dock-alert-icon" />
              <span className="dock-title font-mono">待审批操作 (Action Intercepted)</span>
            </div>
            <span className="dock-request-id font-mono">
              ID: {pendingApproval.requestId}
            </span>
          </div>

          <div className="dock-action-content font-mono custom-scrollbar">
            <pre>{approvalActionText}</pre>
          </div>

          {showDenyInput && (
            <div className="dock-deny-box">
              <input
                type="text"
                className="dock-deny-input font-mono"
                placeholder="输入拒绝原因 (可选，模型将根据此原因调整计划)..."
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleDeny()}
                autoFocus
              />
            </div>
          )}

          <div className="dock-actions-row">
            <span className="dock-left-hint">该操作需要您的授权方可执行</span>

            <div className="dock-btn-group">
              <button
                type="button"
                className="btn-dock-approve"
                onClick={() => handleApprove(false)}
                title="允许执行本次操作"
              >
                <Check size={12} />
                <span>允许 (Allow)</span>
              </button>

              <button
                type="button"
                className="btn-dock-remember"
                onClick={() => handleApprove(true)}
                title="在此会话中始终允许此类操作"
              >
                <CheckCheck size={12} />
                <span>始终允许 (Always)</span>
              </button>

              <button
                type="button"
                className="btn-dock-deny"
                onClick={handleDeny}
                title="拒绝执行"
              >
                <X size={12} />
                <span>{showDenyInput ? '确认拒绝' : '拒绝 (Deny)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Steer instruction banner */}
      {isGenerating && !pendingApproval && (
        <div className="steer-hint-banner">
          <div className="steer-hint-text">
            <Navigation size={13} className="steer-icon pulse" />
            <span>Agent 正在执行... 您可以在下方直接输入指令进行实时纠偏 (Steer)</span>
          </div>
          <button className="btn-interrupt-small" onClick={onInterrupt}>
            中断当前轮次
          </button>
        </div>
      )}

      {/* Slash command popup */}
      {showSlashPopup && (
        <div className="slash-popup-menu custom-scrollbar">
          <div className="slash-popup-title">快捷斜杠命令 (Slash Commands)</div>
          {SLASH_COMMANDS.map((item, idx) => (
            <div
              key={item.cmd}
              className={`slash-item ${idx === selectedSlashIndex ? 'active' : ''}`}
              onClick={() => handleSelectSlashCommand(item)}
            >
              <div className="slash-icon">{item.icon}</div>
              <span className="slash-cmd font-mono">{item.cmd}</span>
              <span className="slash-desc">{item.desc}</span>
            </div>
          ))}
        </div>
      )}

      <form className="input-form" onSubmit={handleSubmit}>
        <div className="textarea-wrapper">
          <textarea
            ref={textareaRef}
            rows={1}
            value={prompt}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              pendingApproval
                ? '⚠️ 等待上方安全权限审批确认后继续...'
                : isGenerating
                ? 'Agent 执行中... 输入内容并按回车可动态纠偏 (Steer)'
                : planActive
                ? '📋 Plan Mode: 输入规划任务需求... (只读探索与计划制定)'
                : '输入任务、指令或问题... (输入 / 查看快捷命令)'
            }
            className="chat-textarea"
          />
        </div>

        <div className="input-footer-bar">
          <div className="input-hints">
            {planActive && (
              <span className="hint-pill plan">
                <Compass size={11} /> Plan Mode Active
              </span>
            )}
            <span className="hint-kbd font-mono">Enter 发送 · Shift+Enter 换行</span>
          </div>

          <div className="input-actions">
            {isGenerating ? (
              <button
                type="button"
                className="btn-action stop"
                onClick={onInterrupt}
                title="中断生成"
              >
                <Square size={13} />
                <span>停止</span>
              </button>
            ) : (
              <button
                type="submit"
                className="btn-action send"
                disabled={!prompt.trim() || !!pendingApproval}
                title="发送"
              >
                <Send size={13} />
                <span>发送</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
