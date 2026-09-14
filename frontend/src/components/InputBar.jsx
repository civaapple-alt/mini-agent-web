import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Compass,
  Target,
  Sparkles,
  X,
  Image as ImageIcon,
  FileCode,
} from 'lucide-react';
import { api } from '../api';
import { getSlashCommandDraft, parseAndExecuteSlashCommand } from '../utils/slashCommands';
import PendingMessageDock from './PendingMessageDock';
import ApprovalDock from './input/ApprovalDock';
import './InputBar.css';

const SLASH_COMMANDS = [
  { cmd: '/plan', desc: '开启/切换 Plan 规划探索模式', icon: <Compass size={13} className="text-amber" /> },
  { cmd: '/goal', desc: '填入目标后启动跨回合 Goal', icon: <Target size={13} className="text-green" /> },
  { cmd: '/clear', desc: '仅清空当前界面显示，不删除会话历史', icon: <Sparkles size={13} className="text-sky" /> },
];

export default function InputBar({
  isGenerating,
  isInterrupting = false,
  sessionReadOnly = false,
  projectId = null,
  pendingApproval,
  onRespondApproval,
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
    const handleDocumentClick = () => setShowMentionPopup(false);
    if (showMentionPopup) {
      window.addEventListener('click', handleDocumentClick);
    }
    return () => {
      window.removeEventListener('click', handleDocumentClick);
    };
  }, [showMentionPopup]);

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

      <ApprovalDock
        pendingApproval={pendingApproval}
        isInterrupting={isInterrupting}
        onRespondApproval={onRespondApproval}
      />

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
          {/* Bottom-Left Controls: attachments and keyboard hint */}
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
