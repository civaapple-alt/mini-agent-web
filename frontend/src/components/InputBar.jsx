import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Navigation,
  Compass,
  Target,
  Sparkles,
  ShieldAlert,
  Shield,
  Check,
  X,
  ChevronDown,
  Image as ImageIcon,
  FileCode,
} from 'lucide-react';
import { api } from '../api';
import { getSlashCommandDraft, parseAndExecuteSlashCommand } from '../utils/slashCommands';
import PendingMessageDock from './PendingMessageDock';
import './InputBar.css';

const SLASH_COMMANDS = [
  { cmd: '/plan', desc: '开启/切换 Plan 规划探索模式', icon: <Compass size={13} className="text-amber" /> },
  { cmd: '/goal', desc: '填入目标后启动跨回合 Goal', icon: <Target size={13} className="text-green" /> },
  { cmd: '/clear', desc: '仅清空当前界面显示，不删除会话历史', icon: <Sparkles size={13} className="text-sky" /> },
];

const ACCESS_SCOPES = [
  { id: 'project', label: '项目范围 (Project)', desc: '仅当前 Project 的工作区范围' },
  { id: 'full_machine', label: '完全访问 (Full access)', desc: '整机路径范围；不会绕过 Deny 或沙箱' },
];

const POLICIES = [
  { id: 'interactive', label: '交互批准 (Interactive)', desc: '高风险敏感操作需要显式确认' },
  { id: 'automatic', label: '自动低风险 (Automatic)', desc: '受限只读检查自动放行，高风险或越界操作仍需显式确认' },
  { id: 'trusted', label: '信任执行 (Trusted)', desc: '普通工作区补丁直通；Shell、MCP、删除/移动和其他高风险操作仍需确认' },
];

const CONTINUATION_MODES = [
  { id: 'manual', label: '手动推进 (Manual)', shortLabel: '手动', desc: '每轮使用有界步数，达到上限后由用户继续' },
  { id: 'continuous', label: '连续执行 (Continuous)', shortLabel: '连续', desc: '普通 Chat 使用连续循环；仍受取消、超时和上下文边界约束' },
];

export default function InputBar({
  isGenerating,
  isInterrupting = false,
  sessionReadOnly = false,
  accessScope = 'project',
  policy = 'interactive',
  continuationMode = 'manual',
  goalState = null,
  projectId = null,
  pendingApproval,
  onRespondApproval,
  onChangeExecution,
  onChangeContinuation,
  onEnableAutoCopilot,
  onStartPlanTask,
  onStartGoal,
  onSendMessage,
  onQueueMessage,
  pendingMessages = [],
  onSteerQueuedMessage,
  onEditQueuedMessage,
  onUpdateQueuedMessage,
  onRemoveQueuedMessage,
  composerDraft,
  onComposerDraftApplied,
  onInterrupt,
  onClearChat,
  onTogglePlanMode,
  onToast,
}) {
  const [prompt, setPrompt] = useState('');
  const [showSlashPopup, setShowSlashPopup] = useState(false);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [showAccessMenu, setShowAccessMenu] = useState(false);
  const [showApprovalMenu, setShowApprovalMenu] = useState(false);
  const [showContinuationMenu, setShowContinuationMenu] = useState(false);
  const [showFullAccessConfirm, setShowFullAccessConfirm] = useState(false);
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
  const mentionRequestEpochRef = useRef(0);
  const mentionRequestControllerRef = useRef(null);

  useEffect(() => () => {
    mentionRequestControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    mentionRequestControllerRef.current?.abort();
    mentionRequestEpochRef.current += 1;
    setMentionFiles([]);
  }, [projectId]);

  useEffect(() => {
    if (!sessionReadOnly) return;
    setShowSlashPopup(false);
    setShowMentionPopup(false);
    setShowAccessMenu(false);
    setShowApprovalMenu(false);
    setShowContinuationMenu(false);
  }, [sessionReadOnly]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [prompt]);

  useEffect(() => {
    if (!composerDraft) return;
    setPrompt(composerDraft.prompt || '');
    setAttachedImages(
      (composerDraft.images || []).map((dataUrl, index) => ({
        id: `restored_${Date.now()}_${index}`,
        name: `附件 ${index + 1}`,
        dataUrl,
        size: 0,
      })),
    );
    setReferencedFiles(composerDraft.referencedFiles || []);
    onComposerDraftApplied?.();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [composerDraft, onComposerDraftApplied]);

  // Close popup menus when clicking outside
  useEffect(() => {
    const handleDocumentClick = () => {
      setShowAccessMenu(false);
      setShowApprovalMenu(false);
      setShowContinuationMenu(false);
      setShowMentionPopup(false);
    };
    if (showAccessMenu || showApprovalMenu || showContinuationMenu || showMentionPopup) {
      window.addEventListener('click', handleDocumentClick);
    }
    return () => {
      window.removeEventListener('click', handleDocumentClick);
    };
  }, [showAccessMenu, showApprovalMenu, showContinuationMenu, showMentionPopup]);

  useEffect(() => {
    if (!showFullAccessConfirm) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setShowFullAccessConfirm(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showFullAccessConfirm]);

  const loadWorkspaceFiles = async (q) => {
    mentionRequestControllerRef.current?.abort();
    const controller = new AbortController();
    mentionRequestControllerRef.current = controller;
    mentionRequestEpochRef.current += 1;
    const requestEpoch = mentionRequestEpochRef.current;
    try {
      const data = await api.getWorkspaceFiles(q, {
        projectId,
        signal: controller.signal,
      });
      if (requestEpoch === mentionRequestEpochRef.current) {
        setMentionFiles(data?.files || []);
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
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

    const handled = parseAndExecuteSlashCommand(cleanCmd, {
      onTogglePlanMode,
      onStartPlanTask: (task) => onStartPlanTask?.({
        prompt: task,
        images: attachedImages.map((img) => img.dataUrl),
        referencedFiles,
      }),
      onStartGoal,
      onClearChat,
      onToast,
    });

    if (handled) {
      setPrompt('');
      return true;
    }
    return false;
  };

  const handleSelectSlashCommand = (cmdObj) => {
    const draft = getSlashCommandDraft(cmdObj.cmd);
    if (draft) {
      setPrompt(draft);
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
    if (sessionReadOnly) return;
    const text = prompt.trim();
    if (!text && attachedImages.length === 0) return;

    if (text.startsWith('/')) {
      const handled = executeSlashCommand(text);
      if (handled) {
        setShowSlashPopup(false);
        setAttachedImages([]);
        setReferencedFiles([]);
        return;
      }
    }

    const payload = {
      prompt: text,
      images: attachedImages.map((img) => img.dataUrl),
      referencedFiles,
    };

    if (isGenerating) {
      onQueueMessage?.(payload);
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

  const handleApprove = (scope = 'once') => {
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
      onRespondApproval(pendingApproval.requestId, 'deny', denyReason.trim(), null);
      setShowDenyInput(false);
      setDenyReason('');
    }
  };

  const currentAccessObj = ACCESS_SCOPES.find((item) => item.id === accessScope) || ACCESS_SCOPES[0];
  const currentPolicyObj = POLICIES.find((item) => item.id === policy) || POLICIES[0];
  const currentContinuationObj = CONTINUATION_MODES.find((item) => item.id === continuationMode) || CONTINUATION_MODES[0];
  const goalIsActive = goalState?.status === 'active';

  const handleAccessScopeSelect = (nextScope) => {
    setShowAccessMenu(false);
    if (nextScope === 'full_machine' && accessScope !== 'full_machine') {
      setShowFullAccessConfirm(true);
      return;
    }
    if (onChangeExecution) onChangeExecution(nextScope, policy);
  };

  const confirmFullAccess = () => {
    if (onChangeExecution) onChangeExecution('full_machine', policy);
    setShowFullAccessConfirm(false);
  };

  // Format pending approval action text
  const approvalActionText = pendingApproval
    ? typeof pendingApproval.data === 'object' && pendingApproval.data !== null
      ? pendingApproval.data.actionSummary || JSON.stringify(pendingApproval.data, null, 2)
      : String(pendingApproval.data)
    : '';

  return (
    <div className="input-bar-container">
      {pendingMessages.length > 0 && (
        <PendingMessageDock
          messages={pendingMessages}
          onSteer={onSteerQueuedMessage}
          onEdit={onEditQueuedMessage}
          onUpdate={onUpdateQueuedMessage}
          onRemove={onRemoveQueuedMessage}
        />
      )}

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
                onClick={() => handleApprove('once')}
                disabled={isInterrupting}
                title="允许执行本次操作"
              >
                <Check size={12} />
                <span>允许本次 (Once)</span>
              </button>

              {(pendingApproval?.data?.allowedGrantScopes || ['once']).includes('session') && (
                <button
                  type="button"
                  className="btn-dock-scope"
                  onClick={() => handleApprove('session')}
                  disabled={isInterrupting}
                  title="在当前会话中记住此操作的授权"
                >
                  <Check size={12} />
                  <span>会话记住 (Session)</span>
                </button>
              )}

              {(pendingApproval?.data?.allowedGrantScopes || ['once']).includes('project') && (
                <button
                  type="button"
                  className="btn-dock-scope"
                  onClick={() => handleApprove('project')}
                  disabled={isInterrupting}
                  title="在当前项目中记住此操作的授权"
                >
                  <Check size={12} />
                  <span>项目记住 (Project)</span>
                </button>
              )}

              <button
                type="button"
                className="btn-dock-deny"
                onClick={handleDeny}
                disabled={isInterrupting}
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

      {showFullAccessConfirm && (
        <div
          className="access-confirm-overlay"
          role="presentation"
          onClick={() => setShowFullAccessConfirm(false)}
        >
          <div
            className="access-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="full-access-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="access-confirm-header">
              <div className="access-confirm-title-group">
                <ShieldAlert size={17} className="access-confirm-icon" />
                <h3 id="full-access-confirm-title">确认启用完全访问</h3>
              </div>
              <button
                type="button"
                className="access-confirm-close"
                onClick={() => setShowFullAccessConfirm(false)}
                aria-label="关闭确认框"
              >
                <X size={15} />
              </button>
            </div>

            <div className="access-confirm-body">
              <p>Agent 将获得整机路径范围的访问能力。</p>
              <ul>
                <li>Deny 规则、Plan 锁和工具可用性仍然有效。</li>
                <li>高风险操作仍需要单独的安全审批。</li>
                <li>只有明确需要访问项目外路径时才建议启用。</li>
              </ul>
            </div>

            <div className="access-confirm-actions">
              <button
                type="button"
                className="access-confirm-cancel"
                onClick={() => setShowFullAccessConfirm(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="access-confirm-submit"
                onClick={confirmFullAccess}
              >
                <Shield size={13} />
                确认启用
              </button>
            </div>
          </div>
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
          disabled={sessionReadOnly}
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
            disabled={sessionReadOnly}
            placeholder={
              sessionReadOnly
                ? '只读查看：该会话由其他进程运行，结束后可重新接管'
                : pendingApproval
                ? '⚠️ 等待上方安全权限审批确认后继续...'
                : isGenerating
                ? 'Agent 执行中... 按回车排队；本轮结束后可继续发送指令'
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
              disabled={sessionReadOnly}
              title="上传图片或截图 (支持直接在输入框按 Ctrl+V 粘贴截图)"
            >
              <ImageIcon size={14} />
            </button>
            {/* 1. Access scope selector */}
            <div className="composer-popover-wrapper" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="composer-pill-btn font-mono"
                disabled={sessionReadOnly}
                onClick={() => {
                  setShowAccessMenu(!showAccessMenu);
                  setShowApprovalMenu(false);
                  setShowContinuationMenu(false);
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
                      onClick={() => handleAccessScopeSelect(item.id)}
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

            {/* 2. Approval policy selector */}
            <div className="composer-popover-wrapper" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="composer-pill-btn font-mono"
                disabled={sessionReadOnly}
                onClick={() => {
                  setShowApprovalMenu(!showApprovalMenu);
                  setShowAccessMenu(false);
                  setShowContinuationMenu(false);
                }}
                title="设置批准策略"
              >
                <Shield size={11} className="text-amber" />
                <span>策略: {currentPolicyObj.label.split(' ')[0]}</span>
                <ChevronDown size={10} className="text-muted" />
              </button>

              {showApprovalMenu && (
                <div className="composer-popup-menu custom-scrollbar">
                  <div className="composer-popup-title">批准策略 (Policy)</div>
                  {POLICIES.map((item) => (
                    <div
                      key={item.id}
                      className={`composer-popup-item ${item.id === policy ? 'active' : ''}`}
                      onClick={() => {
                        if (onChangeExecution) onChangeExecution(accessScope, item.id);
                        setShowApprovalMenu(false);
                      }}
                    >
                      <div className="item-header">
                        <span className="item-name font-mono">{item.label}</span>
                        {item.id === policy && <Check size={12} className="text-green" />}
                      </div>
                      <span className="item-desc">{item.desc}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Explicit continuation / run preset selector */}
            <div className="composer-popover-wrapper" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="composer-pill-btn font-mono"
                disabled={sessionReadOnly}
                onClick={() => {
                  setShowContinuationMenu(!showContinuationMenu);
                  setShowAccessMenu(false);
                  setShowApprovalMenu(false);
                }}
                title="设置本轮之后的推进方式"
              >
                <Navigation size={11} className="text-purple" />
                <span>推进: {goalIsActive ? 'Goal Runtime' : currentContinuationObj.shortLabel}</span>
                <ChevronDown size={10} className="text-muted" />
              </button>

              {showContinuationMenu && (
                <div className="composer-popup-menu custom-scrollbar">
                  <div className="composer-popup-title">推进方式 (Continuation)</div>
                  {goalIsActive && (
                    <div className="composer-popup-note">
                      当前 Goal 接管连续循环与里程碑预算；下面的普通 Chat 设置暂不覆盖它。
                    </div>
                  )}
                  {CONTINUATION_MODES.map((item) => (
                    <div
                      key={item.id}
                      className={`composer-popup-item ${!goalIsActive && item.id === continuationMode ? 'active' : ''}`}
                      onClick={() => {
                        if (goalIsActive) return;
                        onChangeContinuation?.(item.id);
                        setShowContinuationMenu(false);
                      }}
                    >
                      <div className="item-header">
                        <span className="item-name font-mono">{item.label}</span>
                        {!goalIsActive && item.id === continuationMode && <Check size={12} className="text-green" />}
                      </div>
                      <span className="item-desc">{item.desc}</span>
                    </div>
                  ))}
                  <div
                    className="composer-popup-item composer-popup-item-preset"
                    onClick={() => {
                      onEnableAutoCopilot?.();
                      setShowContinuationMenu(false);
                    }}
                  >
                    <div className="item-header">
                      <span className="item-name font-mono">Auto Copilot (显式预设)</span>
                      <Sparkles size={12} className="text-purple" />
                    </div>
                    <span className="item-desc">连续执行 + 信任执行；高风险动作仍需审批，不由当前访问范围隐式触发。</span>
                  </div>
                </div>
              )}
            </div>

            <span className="hint-kbd font-mono">Enter 发送</span>
          </div>

          {/* Bottom-Right: Action Buttons */}
          <div className="input-actions">
            {sessionReadOnly ? (
              <span className="readonly-session-label">只读查看</span>
            ) : isInterrupting ? (
              <button
                type="button"
                className="btn-action stop"
                disabled
                title="正在等待任务停止并结算"
              >
                <Square size={13} />
                <span>停止中</span>
              </button>
            ) : isGenerating ? (
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
