import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Plus,
  Square,
  Compass,
  Target,
  Sparkles,
  X,
  Image as ImageIcon,
  FileCode,
  FileText,
} from 'lucide-react';
import { api } from '../api';
import { getSlashCommandDraft, parseAndExecuteSlashCommand } from '../utils/slashCommands';
import {
  filterSkills,
  findSkillTrigger,
  parseSkillPrompt,
  parseWorkflowPrompt,
  skillDisplayName,
} from '../utils/skillTokens';
import PendingMessageDock from './PendingMessageDock';
import ApprovalDock from './input/ApprovalDock';
import {
  createPastedTextAttachment,
  MAX_PASTED_TEXT_ATTACHMENT_BYTES,
  MAX_PASTED_TEXT_ATTACHMENTS,
  normalizeTextAttachments,
  shouldCapturePastedText,
  utf8ByteLength,
} from '../utils/pasteAttachments.js';
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
  pendingApprovalCount = 0,
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
  availableSkills = [],
  skillGroups = [],
  skillsLoading = false,
  skillsError = null,
  skillInsertion = null,
  onSkillInsertionApplied,
}) {
  const [prompt, setPrompt] = useState('');
  const [showSlashPopup, setShowSlashPopup] = useState(false);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [showSkillPopup, setShowSkillPopup] = useState(false);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [skillCursor, setSkillCursor] = useState(null);
  const [skillQuery, setSkillQuery] = useState('');
  const [workflowSelection, setWorkflowSelection] = useState(null);
  const [showPluginPopup, setShowPluginPopup] = useState(false);

  // Image & File Attachments
  const [attachedImages, setAttachedImages] = useState([]);
  const [attachedTextAttachments, setAttachedTextAttachments] = useState([]);
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
    const draftSkills = Array.isArray(composerDraft.selectedSkills)
      ? composerDraft.selectedSkills
      : [];
    const draftPrompt = [
      composerDraft.prompt || '',
      ...draftSkills.map((name) => `$${name}`),
    ].filter(Boolean).join(' ');
    setPrompt(draftPrompt);
    setWorkflowSelection(composerDraft.workflow || null);
    setAttachedImages(
      (composerDraft.images || []).map((dataUrl, index) => ({
        id: `restored_${Date.now()}_${index}`,
        name: `附件 ${index + 1}`,
        dataUrl,
        size: 0,
      })),
    );
    setAttachedTextAttachments(normalizeTextAttachments(composerDraft.textAttachments));
    setReferencedFiles(composerDraft.referencedFiles || []);
    onComposerDraftApplied?.();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [composerDraft, onComposerDraftApplied]);

  const removeSelectedSkill = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const token = new RegExp(`(^|\\s)\\$${escaped}(?=$|\\s|[.,!?;:)])`, 'gi');
    setPrompt((current) => current.replace(token, '$1').replace(/[ \\t]{2,}/g, ' ').trimStart());
  };

  useEffect(() => {
    if (!skillInsertion?.name) return;
    setPrompt((current) => `${current}${current && !/\s$/.test(current) ? ' ' : ''}$${skillInsertion.name} `);
    onSkillInsertionApplied?.();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [skillInsertion, onSkillInsertionApplied]);

  // Close every composer popup when the pointer leaves its surface. Checking
  // the nearest popup keeps clicks on rows and buttons from dismissing before
  // their selection handlers run.
  useEffect(() => {
    if (!showMentionPopup && !showSkillPopup && !showPluginPopup && !showSlashPopup) {
      return undefined;
    }
    const handleDocumentPointerDown = (event) => {
      const target = event.target;
      if (target?.closest?.(
        '.mention-popup-menu, .skill-popup-menu, .plugin-popup-menu, .slash-popup-menu',
      )) return;
      setShowSlashPopup(false);
      setShowMentionPopup(false);
      setShowSkillPopup(false);
      setShowPluginPopup(false);
    };
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
    };
  }, [showMentionPopup, showSkillPopup, showPluginPopup, showSlashPopup]);

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
          setShowSkillPopup(false);
          setShowPluginPopup(false);
          setSelectedMentionIndex(0);
          loadWorkspaceFiles(query);
          return;
        }
      }
    }
    setShowMentionPopup(false);
  };

  const checkSkillTrigger = (text, cursorPos) => {
    const trigger = findSkillTrigger(text, cursorPos);
    if (!trigger || sessionReadOnly) {
      setShowSkillPopup(false);
      return;
    }
    setSkillCursor(trigger.start);
    setSkillQuery(trigger.query);
    setSelectedSkillIndex(0);
    setShowSkillPopup(true);
    setShowMentionPopup(false);
    setShowPluginPopup(false);
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
    checkSkillTrigger(val, pos);
  };

  const handleSelectSkill = (skill) => {
    if (skillCursor === null) return;
    const end = textareaRef.current?.selectionEnd || prompt.length;
    const name = skillDisplayName(skill);
    const newText = prompt.slice(0, skillCursor) + '$' + name + ' ' + prompt.slice(end);
    const newPos = skillCursor + name.length + 2;
    setPrompt(newText);
    setShowSkillPopup(false);
    setShowMentionPopup(false);
    setShowPluginPopup(false);
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(newPos, newPos);
    }, 10);
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
    setShowSkillPopup(false);
    setShowPluginPopup(false);
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
        textAttachments: attachedTextAttachments,
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
    if (items) for (let i = 0; i < items.length; i++) {
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
        return;
      }
    }

    const pastedText = e.clipboardData?.getData('text/plain') || '';
    if (!shouldCapturePastedText(pastedText)) return;
    e.preventDefault();
    const size = utf8ByteLength(pastedText);
    if (size > MAX_PASTED_TEXT_ATTACHMENT_BYTES) {
      onToast?.('粘贴内容超过 128 KiB，无法作为临时文本附件。', 'warning');
      return;
    }
    if (attachedTextAttachments.length >= MAX_PASTED_TEXT_ATTACHMENTS) {
      onToast?.(`最多暂存 ${MAX_PASTED_TEXT_ATTACHMENTS} 个文本附件。`, 'warning');
      return;
    }
    setAttachedTextAttachments((previous) => [
      ...previous,
      createPastedTextAttachment(pastedText, previous.length),
    ]);
    onToast?.('大段粘贴内容已暂存为文本附件，发送时随当前消息提交。', 'info', 2600);
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
    const parsedWorkflow = parseWorkflowPrompt(text, skillGroups);
    if (parsedWorkflow.unknownWorkflows.length > 0) {
      onToast?.(
        '未知或已关闭插件技能组: '
          + parsedWorkflow.unknownWorkflows.map((name) => '+ ' + name).join('、'),
        'warning',
      );
      return;
    }
    const workflow = parsedWorkflow.workflow || workflowSelection;
    if (
      !parsedWorkflow.prompt
      && attachedImages.length === 0
      && attachedTextAttachments.length === 0
      && !workflow
    ) return;

    const parsedSkills = parseSkillPrompt(parsedWorkflow.prompt, availableSkills);
    if (parsedSkills.unknownSkills.length > 0) {
      onToast?.(`未知或已禁用技能: ${parsedSkills.unknownSkills.map((name) => `$${name}`).join('、')}`, 'warning');
      return;
    }
    if (parsedSkills.selectedSkills.length > 8) {
      onToast?.('每个 Turn 最多加载 8 个技能', 'warning');
      return;
    }

    if (text.startsWith('/')) {
      const handled = executeSlashCommand(text);
      if (handled) {
        setShowSlashPopup(false);
        setAttachedImages([]);
        setAttachedTextAttachments([]);
        setReferencedFiles([]);
        return;
      }
    }

    const payload = {
      prompt: parsedSkills.prompt,
      images: attachedImages.map((img) => img.dataUrl),
      textAttachments: attachedTextAttachments.map(({ name, content }) => ({ name, content })),
      referencedFiles,
      selectedSkills: parsedSkills.selectedSkills,
      workflow,
    };

    if (isGenerating) {
      onQueueMessage?.(payload);
    } else {
      onSendMessage(payload);
    }

    setPrompt('');
    setAttachedImages([]);
    setAttachedTextAttachments([]);
    setReferencedFiles([]);
    setWorkflowSelection(null);
    setShowSlashPopup(false);
    setShowMentionPopup(false);
    setShowSkillPopup(false);
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

    if (showSkillPopup) {
      const skills = filterSkills(availableSkills, skillQuery);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSkillIndex((prev) => (prev + 1) % Math.max(skills.length, 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSkillIndex((prev) => (prev - 1 + Math.max(skills.length, 1)) % Math.max(skills.length, 1));
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && skills[selectedSkillIndex]) {
        e.preventDefault();
        handleSelectSkill(skills[selectedSkillIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setShowSkillPopup(false);
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

      {showPluginPopup && (
        <div className="plugin-popup-menu custom-scrollbar" onClick={(e) => e.stopPropagation()}>
          <div className="skill-popup-header">
            <span>插件工作流 (+)</span>
            <span className="mention-popup-count font-mono">仅当前 Turn</span>
          </div>
          {skillGroups.map((group) => (
            <button
              type="button"
              key={group.id}
              className={'plugin-item ' + (group.enabled === false ? 'disabled' : '')}
              disabled={group.enabled === false}
              onClick={() => {
                setWorkflowSelection({ kind: 'skill_group', id: group.id, mode: 'auto' });
                setShowPluginPopup(false);
                textareaRef.current?.focus();
              }}
            >
              <Sparkles size={13} />
              <span className="font-mono">+ {group.id}</span>
              <span className="skill-desc">
                {'v' + (group.version || 'unknown') + ' · '
                  + (group.enabled === false ? '已关闭' : 'Engineering agent workflows')}
              </span>
            </button>
          ))}
          {skillGroups.length === 0 && <div className="composer-popup-note">没有可用插件技能组</div>}
        </div>
      )}

      <ApprovalDock
        pendingApproval={pendingApproval}
        pendingApprovalCount={pendingApprovalCount}
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

      {showSkillPopup && (
        <div className="skill-popup-menu custom-scrollbar" onClick={(e) => e.stopPropagation()}>
          <div className="skill-popup-header">
            <span>加载技能 ($)</span>
            <span className="mention-popup-count font-mono">Enter / Tab 确认</span>
          </div>
          {skillsLoading && <div className="composer-popup-note">技能目录加载中...</div>}
          {skillsError && <div className="composer-popup-note skill-error">{skillsError}</div>}
          {!skillsLoading && !skillsError && filterSkills(availableSkills, skillQuery).map((skill, idx) => (
            <div
              key={skill.name}
              className={`skill-item ${idx === selectedSkillIndex ? 'active' : ''}`}
              onClick={() => handleSelectSkill(skill)}
            >
              <Sparkles size={13} />
              <span className="skill-name font-mono">${skillDisplayName(skill)}</span>
              <span className="skill-desc">{skill.description}</span>
            </div>
          ))}
          {!skillsLoading && !skillsError && filterSkills(availableSkills, skillQuery).length === 0 && (
            <div className="composer-popup-note">没有匹配的可用技能</div>
          )}
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

        {attachedTextAttachments.length > 0 && (
          <div className="attached-text-bar" aria-label="暂存文本附件">
            {attachedTextAttachments.map((attachment, index) => (
              <div
                className="attached-text-card"
                key={attachment.id || `${attachment.name}_${index}`}
                title={attachment.content.slice(0, 240)}
              >
                <FileText size={15} className="attached-text-icon" />
                <div className="attached-image-meta">
                  <span className="attached-image-name">{attachment.name}</span>
                  <span className="attached-image-size font-mono">
                    文本附件 · {(attachment.size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-remove-attached-image"
                  onClick={() => setAttachedTextAttachments((previous) => previous.filter((_, i) => i !== index))}
                  title="移除文本附件"
                  aria-label={`移除文本附件 ${attachment.name}`}
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

        {parseSkillPrompt(prompt, availableSkills).selectedSkills.length > 0 && (
          <div className="selected-skills-bar">
            {parseSkillPrompt(prompt, availableSkills).selectedSkills.map((name) => (
              <span key={name} className="selected-skill-chip font-mono">
                <Sparkles size={10} /> ${name}
                <button
                  type="button"
                  onClick={() => removeSelectedSkill(name)}
                  title={`移除技能 ${name}`}
                  aria-label={`移除技能 ${name}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        {workflowSelection && (
          <div className="selected-skills-bar">
            <span className="selected-skill-chip font-mono">
              <Sparkles size={10} /> + {workflowSelection.id}
              <button
                type="button"
                onClick={() => setWorkflowSelection(null)}
                title={'移除工作流 ' + workflowSelection.id}
                aria-label={'移除工作流 ' + workflowSelection.id}
              >
                <X size={10} />
              </button>
            </span>
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
                : '输入任务、指令或问题... (支持 $ 加载技能、@ 引用文件、/ 快捷命令)'
            }
            className="chat-textarea"
          />
        </div>

        {/* Bottom Composer Footer */}
        <div className="input-footer-bar">
          {/* Bottom-Left Controls: attachments and keyboard hint */}
          <div className="input-hints">
            <button
              type="button"
              className="composer-icon-btn"
              onClick={() => {
                setShowPluginPopup((visible) => !visible);
                setShowSlashPopup(false);
                setShowMentionPopup(false);
                setShowSkillPopup(false);
              }}
              disabled={sessionReadOnly || skillGroups.length === 0}
              title="选择当前 Turn 的插件工作流"
            >
              <Plus size={15} />
            </button>
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
                disabled={(
                  !prompt.trim()
                  && !workflowSelection
                  && attachedImages.length === 0
                  && attachedTextAttachments.length === 0
                ) || !!pendingApproval}
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
