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
  Shield,
  Check,
  CheckCheck,
  X,
  ChevronDown,
  MessageSquare,
} from 'lucide-react';
import './InputBar.css';

const SLASH_COMMANDS = [
  { cmd: '/plan', desc: '开启/切换只读规划探索模式', icon: <Compass size={13} className="text-amber" /> },
  { cmd: '/goal', desc: '启动目标驱动多里程碑收敛模式', icon: <Target size={13} className="text-green" /> },
  { cmd: '/clear', desc: '清空当前页面消息', icon: <Sparkles size={13} className="text-sky" /> },
  { cmd: '/steer', desc: '发送运行时纠偏指令', icon: <Navigation size={13} className="text-purple" /> },
  { cmd: '/status', desc: '查看环境探测与状态', icon: <Command size={13} className="text-emerald" /> },
];

const PROFILES = [
  { id: 'interactive', label: '交互协作 (Interactive)', icon: <MessageSquare size={11} className="text-sky" />, desc: '日常人机结对对话与单步工具把控 (推荐)' },
  { id: 'autonomous', label: '自治目标 (Autonomous)', icon: <Target size={11} className="text-green" />, desc: '目标驱动多里程碑无人值守收敛' },
  { id: 'strict', label: '严格只读 (Strict)', icon: <Compass size={11} className="text-amber" />, desc: '只读规划探索与高安全审计，禁止写操作' },
];

const APPROVAL_POLICIES = [
  { id: 'per_action', label: '每次确认 (Per-Action)', desc: '每次敏感操作单独弹窗确认 (推荐)' },
  { id: 'auto_approve', label: '自动放行 (Auto-Approve)', desc: '全自动放行工具执行 (Dev/高速)' },
  { id: 'strict', label: '严格拒绝 (Strict Deny)', desc: '严格拒绝一切敏感写操作' },
];

export default function InputBar({
  isGenerating,
  profile = 'interactive',
  approvalPolicy = 'per_action',
  pendingApproval,
  onRespondApproval,
  onChangeProfile,
  onChangeApprovalPolicy,
  onSendMessage,
  onSteerMessage,
  onInterrupt,
}) {
  const [prompt, setPrompt] = useState('');
  const [showSlashPopup, setShowSlashPopup] = useState(false);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showPolicyMenu, setShowPolicyMenu] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const [showDenyInput, setShowDenyInput] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [prompt]);

  // Close popup menus when clicking outside
  useEffect(() => {
    const handleDocumentClick = () => {
      setShowProfileMenu(false);
      setShowPolicyMenu(false);
    };
    if (showProfileMenu || showPolicyMenu) {
      window.addEventListener('click', handleDocumentClick);
    }
    return () => {
      window.removeEventListener('click', handleDocumentClick);
    };
  }, [showProfileMenu, showPolicyMenu]);

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
      if (onChangeProfile) onChangeProfile(profile === 'strict' ? 'interactive' : 'strict');
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
      if (onChangeProfile) onChangeProfile(profile === 'strict' ? 'interactive' : 'strict');
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

  const currentProfileObj = PROFILES.find((p) => p.id === profile) || PROFILES[0];
  const currentPolicyObj = APPROVAL_POLICIES.find((p) => p.id === approvalPolicy) || APPROVAL_POLICIES[0];

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

      {/* Main Composer Box */}
      <form className="input-form" onSubmit={handleSubmit}>
        {/* Textarea Input: Direct, Spacious & Uncluttered */}
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
                : profile === 'strict'
                ? '📋 Strict Mode: 输入规划任务需求... (只读探索与计划制定)'
                : profile === 'autonomous'
                ? '🎯 Autonomous Mode: 输入宏观目标需求... (多里程碑无人值守收敛)'
                : '输入任务、指令或问题... (输入 / 查看快捷命令)'
            }
            className="chat-textarea"
          />
        </div>

        {/* Bottom Composer Footer */}
        <div className="input-footer-bar">
          {/* Bottom-Left Controls: Profile Selector + Approval Policy Selector */}
          <div className="input-hints">
            {/* 1. Profile Dropdown Selector (Left of Approval Policy) */}
            <div className="composer-popover-wrapper" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="composer-pill-btn font-mono"
                onClick={() => {
                  setShowProfileMenu(!showProfileMenu);
                  setShowPolicyMenu(false);
                }}
                title="点击切换客户端运行 Profile"
              >
                {currentProfileObj.icon}
                <span>{currentProfileObj.label.split(' ')[0]}</span>
                <ChevronDown size={10} className="text-muted" />
              </button>

              {showProfileMenu && (
                <div className="composer-popup-menu custom-scrollbar">
                  <div className="composer-popup-title">运行 Profile (Profile)</div>
                  {PROFILES.map((p) => (
                    <div
                      key={p.id}
                      className={`composer-popup-item ${p.id === profile ? 'active' : ''}`}
                      onClick={() => {
                        if (onChangeProfile) onChangeProfile(p.id);
                        setShowProfileMenu(false);
                      }}
                    >
                      <div className="item-header">
                        <div className="item-title-wrap">
                          {p.icon}
                          <span className="item-name font-mono">{p.label}</span>
                        </div>
                        {p.id === profile && <Check size={12} className="text-green" />}
                      </div>
                      <span className="item-desc">{p.desc}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 2. Approval Policy Dropdown Selector */}
            <div className="composer-popover-wrapper" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="composer-pill-btn font-mono"
                onClick={() => {
                  setShowPolicyMenu(!showPolicyMenu);
                  setShowProfileMenu(false);
                }}
                title="点击切换安全审批策略"
              >
                <Shield
                  size={11}
                  className={
                    approvalPolicy === 'auto_approve'
                      ? 'text-green'
                      : approvalPolicy === 'strict'
                      ? 'text-rose'
                      : 'text-amber'
                  }
                />
                <span>审批: {currentPolicyObj.label.split(' ')[0]}</span>
                <ChevronDown size={10} className="text-muted" />
              </button>

              {showPolicyMenu && (
                <div className="composer-popup-menu custom-scrollbar">
                  <div className="composer-popup-title">安全审批策略 (Approval Policy)</div>
                  {APPROVAL_POLICIES.map((item) => (
                    <div
                      key={item.id}
                      className={`composer-popup-item ${item.id === approvalPolicy ? 'active' : ''}`}
                      onClick={() => {
                        if (onChangeApprovalPolicy) onChangeApprovalPolicy(item.id);
                        setShowPolicyMenu(false);
                      }}
                    >
                      <div className="item-header">
                        <span className="item-name font-mono">{item.label}</span>
                        {item.id === approvalPolicy && <Check size={12} className="text-green" />}
                      </div>
                      <span className="item-desc">{item.desc}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <span className="hint-kbd font-mono">Enter 发送</span>
          </div>

          {/* Bottom-Right: Action Buttons */}
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
