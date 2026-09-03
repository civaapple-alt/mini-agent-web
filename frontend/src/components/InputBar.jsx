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
  X,
  ChevronDown,
  Image as ImageIcon,
  FileCode,
} from 'lucide-react';
import { api } from '../api';
import { parseAndExecuteSlashCommand } from '../utils/slashCommands';
import './InputBar.css';

const SLASH_COMMANDS = [
  { cmd: '/plan', desc: '开启/切换 Plan 规划探索模式', icon: <Compass size={13} className="text-amber" /> },
  { cmd: '/goal', desc: '创建并启动一个跨回合 Goal', icon: <Target size={13} className="text-green" /> },
  { cmd: '/clear', desc: '清空当前聊天记录', icon: <Sparkles size={13} className="text-sky" /> },
  { cmd: '/status', desc: '打开工作区探测与环境状态面板', icon: <Command size={13} className="text-emerald" /> },
  { cmd: '/copy', desc: '复制模型最新回复/文档 Markdown 到剪贴板', icon: <Sparkles size={13} className="text-purple" /> },
  { cmd: '/steer', desc: '向运行中的 Agent 发送实时纠偏指令', icon: <Navigation size={13} className="text-purple" /> },
];

const ACCESS_SCOPES = [
  { id: 'project', label: '项目范围 (Project)', desc: '仅当前 Project 的工作区范围' },
  { id: 'full_machine', label: '完全访问 (Full access)', desc: '整机路径范围；不会绕过 Deny 或沙箱' },
];

const APPROVAL_MODES = [
  { id: 'per_action', label: '逐次批准 (Per-Action)', desc: '每次敏感操作单独确认' },
  { id: 'current_session', label: '当前会话 (Current Session)', desc: '本 Session 内复用精确批准' },
  { id: 'current_project', label: '当前项目 (Current Project)', desc: 'Project 内匹配 Workspace 版本的 Session 复用' },
];

export default function InputBar({
  isGenerating,
  accessScope = 'project',
  approvalMode = 'per_action',
  pendingApproval,
  onRespondApproval,
  onChangeExecution,
  onStartGoal,
  onSendMessage,
  onSteerMessage,
  onInterrupt,
  onClearChat,
  onOpenStatus,
  onCopyLastResponse,
  onTogglePlanMode,
  onToast,
}) {
  const [prompt, setPrompt] = useState('');
  const [showSlashPopup, setShowSlashPopup] = useState(false);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [showAccessMenu, setShowAccessMenu] = useState(false);
  const [showApprovalMenu, setShowApprovalMenu] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const [showDenyInput, setShowDenyInput] = useState(false);

  // Image & File Attachments
  const [attachedImages, setAttachedImages] = useState([]);
  const [referencedFiles, setReferencedFiles] = useState([]);
  const fileInputRef = useRef(null);

  // @ Mention Autocomplete
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionFiles, setMentionFiles] = useState([]);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [mentionCursorPos, setMentionCursorPos] = useState(null);

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
      setShowAccessMenu(false);
      setShowApprovalMenu(false);
      setShowMentionPopup(false);
    };
    if (showAccessMenu || showApprovalMenu || showMentionPopup) {
      window.addEventListener('click', handleDocumentClick);
    }
    return () => {
      window.removeEventListener('click', handleDocumentClick);
    };
  }, [showAccessMenu, showApprovalMenu, showMentionPopup]);

  const loadWorkspaceFiles = async (q) => {
    try {
      const data = await api.getWorkspaceFiles(q);
      setMentionFiles(data?.files || []);
    } catch (err) {
      console.warn('Failed to load workspace files:', err);
    }
  };

  const checkMentionTrigger = (text, cursorPos) => {
    const textBeforeCursor = text.slice(0, cursorPos);
    const lastAtIdx = textBeforeCursor.lastIndexOf('@');
    if (lastAtIdx !== -1) {
      const charBeforeAt = lastAtIdx > 0 ? textBeforeCursor[lastAtIdx - 1] : ' ';
      if (charBeforeAt === ' ' || charBeforeAt === '\n' || charBeforeAt === '\t') {
        const query = textBeforeCursor.slice(lastAtIdx + 1);
        if (!query.includes(' ') && !query.includes('\n')) {
          setMentionCursorPos(lastAtIdx);
          setShowMentionPopup(true);
          setSelectedMentionIndex(0);
          loadWorkspaceFiles(query);
          return;
        }
      }
    }
    setShowMentionPopup(false);
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    setPrompt(val);

    if (val.startsWith('/') && !val.includes(' ') && !isGenerating) {
      setShowSlashPopup(true);
      setSelectedSlashIndex(0);
    } else {
      setShowSlashPopup(false);
    }

    checkMentionTrigger(val, pos);
  };

  const handleSelectMentionFile = (file) => {
    if (mentionCursorPos === null) return;
    const textBeforeAt = prompt.slice(0, mentionCursorPos);
    const textAfterCursor = prompt.slice(textareaRef.current?.selectionEnd || prompt.length);
    const newText = `${textBeforeAt}@${file.path} ${textAfterCursor}`;
    setPrompt(newText);
    if (!referencedFiles.includes(file.path)) {
      setReferencedFiles((prev) => [...prev, file.path]);
    }
    setShowMentionPopup(false);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newPos = mentionCursorPos + file.path.length + 2;
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 10);
  };

  const executeSlashCommand = (cmdStr) => {
    const cleanCmd = (cmdStr || '').trim();
    if (cleanCmd.toLowerCase() === '/steer' && isGenerating) {
      setPrompt('/steer ');
      return true;
    }

    const handled = parseAndExecuteSlashCommand(cleanCmd, {
      isGenerating,
      onTogglePlanMode,
      onStartGoal,
      onClearChat,
      onOpenStatus,
      onCopyLastResponse,
      onSteerMessage,
      onToast,
    });

    if (handled) {
      setPrompt('');
      return true;
    }
    return false;
  };

  const handleSelectSlashCommand = (cmdObj) => {
    if (cmdObj.cmd === '/steer') {
      setPrompt('/steer ');
    } else {
      executeSlashCommand(cmdObj.cmd);
    }
    setShowSlashPopup(false);
    if (textareaRef.current) textareaRef.current.focus();
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (uploadEvent) => {
            const dataUrl = uploadEvent.target.result;
            setAttachedImages((prev) => [
              ...prev,
              {
                id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: file.name || `剪贴板截图_${new Date().toLocaleTimeString().replace(/:/g, '-')}.png`,
                dataUrl,
                size: file.size,
              },
            ]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleFileInputChange = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (uploadEvent) => {
          setAttachedImages((prev) => [
            ...prev,
            {
              id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              name: file.name,
              dataUrl: uploadEvent.target.result,
              size: file.size,
            },
          ]);
        };
        reader.readAsDataURL(file);
      }
    });
    e.target.value = '';
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    const text = prompt.trim();
    if (!text && attachedImages.length === 0) return;

    if (text.startsWith('/')) {
      const handled = executeSlashCommand(text);
      if (handled) {
        setShowSlashPopup(false);
        return;
      }
    }

    const payload = {
      prompt: text,
      images: attachedImages.map((img) => img.dataUrl),
      referencedFiles,
    };

    if (isGenerating) {
      onSteerMessage(text);
    } else {
      onSendMessage(payload);
    }

    setPrompt('');
    setAttachedImages([]);
    setReferencedFiles([]);
    setShowSlashPopup(false);
    setShowMentionPopup(false);
  };

  const handleKeyDown = (e) => {
    // Guard against IME composition on Enter (e.g. Chinese/Japanese candidate selection)
    if (e.nativeEvent?.isComposing || e.keyCode === 229) {
      return;
    }

    if (showMentionPopup && mentionFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIndex((prev) => (prev + 1) % mentionFiles.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIndex((prev) => (prev - 1 + mentionFiles.length) % mentionFiles.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectMentionFile(mentionFiles[selectedMentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setShowMentionPopup(false);
        return;
      }
    }

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

  const handleApprove = (scope = approvalMode) => {
    if (onRespondApproval && pendingApproval) {
      onRespondApproval(pendingApproval.requestId, 'approve', '', scope);
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
      onRespondApproval(pendingApproval.requestId, 'deny', denyReason.trim(), approvalMode);
      setShowDenyInput(false);
      setDenyReason('');
    }
  };

  const currentAccessObj = ACCESS_SCOPES.find((item) => item.id === accessScope) || ACCESS_SCOPES[0];
  const currentApprovalObj = APPROVAL_MODES.find((item) => item.id === approvalMode) || APPROVAL_MODES[0];

  // Format pending approval action text
  const approvalActionText = pendingApproval
    ? typeof pendingApproval.data === 'object' && pendingApproval.data !== null
      ? pendingApproval.data.actionSummary || JSON.stringify(pendingApproval.data, null, 2)
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
                onClick={() => handleApprove('per_action')}
                title="允许执行本次操作"
              >
                <Check size={12} />
                <span>允许 (Allow)</span>
              </button>

              <button
                type="button"
                className="btn-dock-scope"
                onClick={() => handleApprove(approvalMode)}
                title={`按当前设置复用：${currentApprovalObj.label}`}
              >
                <Check size={12} />
                <span>{currentApprovalObj.label.split(' ')[0]} (Apply)</span>
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

      {/* @ Mention Autocomplete Popup */}
      {showMentionPopup && mentionFiles.length > 0 && (
        <div className="mention-popup-menu custom-scrollbar" onClick={(e) => e.stopPropagation()}>
          <div className="mention-popup-header">
            <span>工作区文件引用 (@)</span>
            <span className="mention-popup-count font-mono">{mentionFiles.length} 个匹配</span>
          </div>
          {mentionFiles.map((file, idx) => (
            <div
              key={file.path}
              className={`mention-item ${idx === selectedMentionIndex ? 'active' : ''}`}
              onClick={() => handleSelectMentionFile(file)}
            >
              <FileCode size={13} className="mention-icon" />
              <div className="mention-info">
                <span className="mention-name font-mono">{file.name}</span>
                <span className="mention-path font-mono">{file.path}</span>
              </div>
            </div>
          ))}
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
        {/* Hidden Image File Input */}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept="image/*"
          multiple
          onChange={handleFileInputChange}
        />

        {/* Attached Images Preview Bar */}
        {attachedImages.length > 0 && (
          <div className="attached-images-bar custom-scrollbar">
            {attachedImages.map((img, idx) => (
              <div key={img.id} className="attached-image-card">
                <img src={img.dataUrl} alt={img.name} className="attached-image-thumb" />
                <div className="attached-image-meta">
                  <span className="attached-image-name" title={img.name}>{img.name}</span>
                  <span className="attached-image-size font-mono">{(img.size / 1024).toFixed(1)} KB</span>
                </div>
                <button
                  type="button"
                  className="btn-remove-attached-image"
                  onClick={() => setAttachedImages((prev) => prev.filter((_, i) => i !== idx))}
                  title="移除截图"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Referenced Files Chips */}
        {referencedFiles.length > 0 && (
          <div className="referenced-files-bar">
            {referencedFiles.map((path, idx) => (
              <div key={path} className="referenced-file-chip font-mono">
                <FileCode size={11} className="chip-file-icon" />
                <span className="chip-file-name" title={path}>@{path}</span>
                <button
                  type="button"
                  className="btn-remove-chip"
                  onClick={() => setReferencedFiles((prev) => prev.filter((_, i) => i !== idx))}
                  title="移除引用"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Textarea Input: Direct, Spacious & Uncluttered */}
        <div className="textarea-wrapper">
          <textarea
            ref={textareaRef}
            rows={1}
            value={prompt}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              pendingApproval
                ? '⚠️ 等待上方安全权限审批确认后继续...'
                : isGenerating
                ? 'Agent 执行中... 输入内容并按回车可动态纠偏 (Steer)'
                : '输入任务、指令或问题... (支持 Ctrl+V 粘贴截图、输入 @ 引用文件、输入 / 查看快捷命令)'
            }
            className="chat-textarea"
          />
        </div>

        {/* Bottom Composer Footer */}
        <div className="input-footer-bar">
          {/* Bottom-Left Controls: access, approval, and image upload */}
          <div className="input-hints">
            {/* Image Upload Button */}
            <button
              type="button"
              className="composer-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              title="上传图片或截图 (支持直接在输入框按 Ctrl+V 粘贴截图)"
            >
              <ImageIcon size={14} />
            </button>
            {/* 1. Access scope selector */}
            <div className="composer-popover-wrapper" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="composer-pill-btn font-mono"
                onClick={() => {
                  setShowAccessMenu(!showAccessMenu);
                  setShowApprovalMenu(false);
                }}
                title="设置文件系统访问范围"
              >
                <Shield size={11} className={accessScope === 'full_machine' ? 'text-rose' : 'text-sky'} />
                <span>{currentAccessObj.label.split(' ')[0]}</span>
                <ChevronDown size={10} className="text-muted" />
              </button>

              {showAccessMenu && (
                <div className="composer-popup-menu custom-scrollbar">
                  <div className="composer-popup-title">访问范围 (Access)</div>
                  {ACCESS_SCOPES.map((item) => (
                    <div
                      key={item.id}
                      className={`composer-popup-item ${item.id === accessScope ? 'active' : ''}`}
                      onClick={() => {
                        if (
                          item.id === 'full_machine' &&
                          accessScope !== 'full_machine' &&
                          !window.confirm(
                            '完全访问将允许 Agent 访问整机路径范围，但仍受 Deny、Plan 锁、工具可用性和高风险确认约束。继续吗？'
                          )
                        ) {
                          return;
                        }
                        if (onChangeExecution) onChangeExecution(item.id, approvalMode);
                        setShowAccessMenu(false);
                      }}
                    >
                      <div className="item-header">
                        <div className="item-title-wrap">
                          <Shield size={11} className="text-sky" />
                          <span className="item-name font-mono">{item.label}</span>
                        </div>
                        {item.id === accessScope && <Check size={12} className="text-green" />}
                      </div>
                      <span className="item-desc">{item.desc}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 2. Approval lifetime selector */}
            <div className="composer-popover-wrapper" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="composer-pill-btn font-mono"
                onClick={() => {
                  setShowApprovalMenu(!showApprovalMenu);
                  setShowAccessMenu(false);
                }}
                title="设置批准生命周期"
              >
                <Shield size={11} className="text-amber" />
                <span>批准: {currentApprovalObj.label.split(' ')[0]}</span>
                <ChevronDown size={10} className="text-muted" />
              </button>

              {showApprovalMenu && (
                <div className="composer-popup-menu custom-scrollbar">
                  <div className="composer-popup-title">批准生命周期 (Approval)</div>
                  {APPROVAL_MODES.map((item) => (
                    <div
                      key={item.id}
                      className={`composer-popup-item ${item.id === approvalMode ? 'active' : ''}`}
                      onClick={() => {
                        if (onChangeExecution) onChangeExecution(accessScope, item.id);
                        setShowApprovalMenu(false);
                      }}
                    >
                      <div className="item-header">
                        <span className="item-name font-mono">{item.label}</span>
                        {item.id === approvalMode && <Check size={12} className="text-green" />}
                      </div>
                      <span className="item-desc">{item.desc}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <span className="hint-kbd font-mono">Enter 发送</span>
            {accessScope === 'full_machine' && approvalMode === 'current_project' && (
              <span className="hint-kbd font-mono" title="Goal + 当前配置可形成 Auto Copilot">
                Auto Copilot 就绪
              </span>
            )}
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
