import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Plus,
  Square,
  Compass,
  Target,
  Sparkles,
  X,
  Folder,
  FileCode,
  FileText,
  Settings,
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
import {
  MAX_FILE_ATTACHMENT_BYTES,
  MAX_FILE_ATTACHMENTS,
  createFileAttachment,
  createPathAttachment,
  dataTransferContainsDirectory,
  isImageFile,
  nativePathFromFile,
  nativePathsFromDataTransfer,
  normalizeFileAttachments,
  readFileAsDataUrl,
} from '../utils/fileAttachments.js';
import './InputBar.css';

const SLASH_COMMANDS = [
  { cmd: '/plan', desc: '开启/切换 Plan 规划探索模式', icon: <Compass size={13} className="text-amber" /> },
  { cmd: '/goal', desc: '填入目标后启动跨回合 Goal', icon: <Target size={13} className="text-green" /> },
  { cmd: '/clear', desc: '仅清空当前界面显示，不删除会话历史', icon: <Sparkles size={13} className="text-sky" /> },
];

const reasoningLevelLabel = (level) => (level === 'disabled' ? 'disabled（关闭）' : level);

export default function InputBar({
  isGenerating,
  isInterrupting = false,
  sessionReadOnly = false,
  currentThread = null,
  projectId = null,
  isNewSessionLanding = false,
  sessionActive = true,
  sessionControl = { status: 'running' },
  hasSessionActivity = false,
  onOpenSettings,
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
  onFreezeSession,
  onContinueSession,
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
  const [selectedSkillRefs, setSelectedSkillRefs] = useState([]);
  const [workflowSelection, setWorkflowSelection] = useState(null);
  const [composerDirective, setComposerDirective] = useState(null);
  const [showPluginPopup, setShowPluginPopup] = useState(false);
  const [modelCatalog, setModelCatalog] = useState({ providers: [], projectDefaults: {} });
  const [threadModelSettings, setThreadModelSettings] = useState({ model_selection: null, reasoning_selection: null });
  const [modelSettingsLoading, setModelSettingsLoading] = useState(false);
  const [modelSettingsSaving, setModelSettingsSaving] = useState(false);
  const [modelSettingsError, setModelSettingsError] = useState('');

  // Image & File Attachments
  const [attachedImages, setAttachedImages] = useState([]);
  const [attachedTextAttachments, setAttachedTextAttachments] = useState([]);
  const [attachedFileAttachments, setAttachedFileAttachments] = useState([]);
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
  const modelSettingsEpochRef = useRef(0);

  const loadModelSettings = useCallback(async () => {
    if (!currentThread) return;
    const epoch = ++modelSettingsEpochRef.current;
    setModelSettingsLoading(true);
    try {
      const [catalogResult, threadResult] = await Promise.all([
        api.getModelCatalog({ projectId }),
        api.getThreadModelSettings(currentThread, { projectId }),
      ]);
      if (epoch !== modelSettingsEpochRef.current) return;
      setModelCatalog(catalogResult?.catalog || catalogResult || { providers: [], projectDefaults: {} });
      setThreadModelSettings({
        model_selection: threadResult?.model_selection || null,
        reasoning_selection: threadResult?.reasoning_selection
          || (threadResult?.reasoning_effort
            ? { kind: 'level', value: threadResult.reasoning_effort }
            : null),
      });
      setModelSettingsError('');
    } catch (error) {
      if (epoch === modelSettingsEpochRef.current) {
        setModelSettingsError(error?.message || '模型设置加载失败');
      }
    } finally {
      if (epoch === modelSettingsEpochRef.current) setModelSettingsLoading(false);
    }
  }, [currentThread, projectId]);

  useEffect(() => {
    void loadModelSettings();
    return () => { modelSettingsEpochRef.current += 1; };
  }, [loadModelSettings]);

  useEffect(() => {
    const reload = () => { void loadModelSettings(); };
    window.addEventListener('mini-agent-model-catalog-updated', reload);
    return () => window.removeEventListener('mini-agent-model-catalog-updated', reload);
  }, [loadModelSettings]);

  const modelEntries = (modelCatalog.providers || []).flatMap((provider) => (
    (provider.models || []).map((model) => ({
      key: `${provider.id}::${model.id}`,
      provider,
      model,
      selection: { providerId: provider.id, modelId: model.id },
    }))
  ));
  const selectionKey = (selection) => selection
    ? `${selection.providerId || selection.provider_id}::${selection.modelId || selection.model_id}`
    : '';
  const projectDefault = projectId ? modelCatalog.projectDefaults?.[projectId] : null;
  const inheritedSelection = projectDefault || modelCatalog.defaultModel || null;
  const inheritedEntry = modelEntries.find((entry) => entry.key === selectionKey(inheritedSelection)) || null;
  const effectiveSelection = threadModelSettings.model_selection || projectDefault || modelCatalog.defaultModel || null;
  const effectiveKey = selectionKey(effectiveSelection);
  const effectiveEntry = modelEntries.find((entry) => entry.key === effectiveKey) || null;
  const configuredModelCount = modelEntries.length;
  const effectiveModelProblem = !configuredModelCount || !effectiveSelection
    ? ''
    : !effectiveEntry
      ? '当前模型已从目录中删除，请重新选择模型。'
      : !effectiveEntry.provider.enabled || !effectiveEntry.model.enabled
        ? `模型 ${effectiveEntry.model.name || effectiveEntry.model.id} 已停用。`
        : !effectiveEntry.provider.baseUrl?.trim()
          ? `供应商 ${effectiveEntry.provider.name} 尚未填写 Base URL。`
          : !effectiveEntry.provider.apiKeyConfigured
            ? `供应商 ${effectiveEntry.provider.name} 尚未配置 API Key。`
            : '';
  const threadSelectionKey = selectionKey(threadModelSettings.model_selection);
  const reasoningLevels = effectiveEntry?.model.reasoningLevels || [];
  const globalDefaultReasoning = modelCatalog.defaultReasoningSelection || { kind: 'api_default' };
  const inheritedReasoning = !threadModelSettings.model_selection
    && !projectDefault
    && selectionKey(effectiveSelection) === selectionKey(modelCatalog.defaultModel)
    ? globalDefaultReasoning
    : { kind: 'api_default' };
  const effectiveReasoningSelection = threadModelSettings.reasoning_selection || inheritedReasoning;
  const reasoningValue = effectiveReasoningSelection.kind === 'level'
    ? `level:${effectiveReasoningSelection.value}`
    : 'api_default';

  const saveThreadModelSettings = async (selection, reasoningSelection) => {
    if (!currentThread) return;
    setModelSettingsSaving(true);
    try {
      const result = await api.updateThreadModelSettings(currentThread, selection, reasoningSelection, { projectId });
      setThreadModelSettings({
        model_selection: result?.model_selection ?? result?.modelSelection ?? selection,
        reasoning_selection: result?.reasoning_selection
          ?? result?.reasoningSelection
          ?? reasoningSelection,
      });
      setModelSettingsError('');
    } catch (error) {
      onToast?.(`模型切换失败：${error?.message || '请求失败'}`, 'error');
    } finally {
      setModelSettingsSaving(false);
    }
  };

  const modelSelectionDisabled = !currentThread || modelSettingsLoading || modelSettingsSaving
    || isGenerating || Boolean(pendingApproval) || sessionReadOnly || !sessionActive
    || ['freezing', 'frozen', 'resuming'].includes(sessionControl?.status);
  const sessionFrozen = sessionControl?.status === 'frozen';
  const sessionTransitioning = ['freezing', 'resuming'].includes(sessionControl?.status);

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
    const parsedDraft = parseSkillPrompt(composerDraft.prompt || '', availableSkills);
    setPrompt(parsedDraft.prompt);
    setSelectedSkillRefs([...new Set([...draftSkills, ...parsedDraft.selectedSkills])]);
    setWorkflowSelection(composerDraft.workflow || null);
    setComposerDirective(composerDraft.directive || null);
    setAttachedImages(
      (composerDraft.images || []).map((dataUrl, index) => ({
        id: `restored_${Date.now()}_${index}`,
        name: `附件 ${index + 1}`,
        dataUrl,
        size: 0,
      })),
    );
    setAttachedTextAttachments(normalizeTextAttachments(composerDraft.textAttachments));
    setAttachedFileAttachments(normalizeFileAttachments(composerDraft.fileAttachments));
    setReferencedFiles(composerDraft.referencedFiles || []);
    onComposerDraftApplied?.();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [composerDraft, onComposerDraftApplied, availableSkills]);

  const removeSelectedSkill = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const token = new RegExp(`(^|\\s)\\$${escaped}(?=$|\\s|[.,!?;:)])`, 'gi');
    setSelectedSkillRefs((current) => current.filter((skill) => skill !== name));
    setPrompt((current) => current.replace(token, '$1').replace(/[ \\t]{2,}/g, ' ').trimStart());
  };

  useEffect(() => {
    if (!skillInsertion?.name) return;
    setSelectedSkillRefs((current) => (
      current.includes(skillInsertion.name) ? current : [...current, skillInsertion.name]
    ));
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
    const left = prompt.slice(0, skillCursor).replace(/[ \t]+$/, '');
    const right = prompt.slice(end).replace(/^[ \t]+/, '');
    const separator = left && right ? ' ' : '';
    const newText = `${left}${separator}${right}`;
    const newPos = left.length + separator.length;
    setSelectedSkillRefs((current) => (
      current.includes(name) ? current : [...current, name]
    ));
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
        fileAttachments: attachedFileAttachments,
        referencedFiles,
      }),
      onStartGoal,
      onClearChat,
      onToast,
    });

    if (handled) {
      setPrompt('');
      setSelectedSkillRefs([]);
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

  const addPathAttachments = (paths) => {
    const next = paths
      .map((path, index) => createPathAttachment(path, index))
      .filter(Boolean);
    if (next.length === 0) return;
    setAttachedFileAttachments((previous) => {
      const known = new Set(previous.map((attachment) => attachment.path));
      return [
        ...previous,
        ...next.filter((attachment) => !known.has(attachment.path)),
      ];
    });
    onToast?.('已记录本地路径，发送后当前 Session 可按需读取。', 'info', 2400);
  };

  const addFileObjects = async (files) => {
    const candidates = Array.from(files || []);
    if (candidates.length === 0) return;
    if (candidates.some((file) => Number(file.size) > MAX_FILE_ATTACHMENT_BYTES)) {
      onToast?.('单个文件超过 8 MiB，无法添加。', 'warning');
    }
    const accepted = candidates.filter((file) => Number(file.size) <= MAX_FILE_ATTACHMENT_BYTES);
    const remaining = Math.max(
      0,
      MAX_FILE_ATTACHMENTS - attachedFileAttachments.length - attachedImages.length,
    );
    if (accepted.length > remaining) {
      onToast?.('当前消息最多添加 16 个文件。', 'warning');
    }
    for (const [index, file] of accepted.slice(0, remaining).entries()) {
      const nativePath = nativePathFromFile(file);
      if (nativePath) {
        addPathAttachments([nativePath]);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        if (isImageFile(file)) {
          setAttachedImages((previous) => [
            ...previous,
            {
              id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              name: file.name,
              dataUrl,
              size: file.size,
            },
          ]);
        } else {
          setAttachedFileAttachments((previous) => [
            ...previous,
            createFileAttachment(file, dataUrl.split(',', 2)[1] || '', index),
          ]);
        }
      } catch {
        onToast?.(`读取文件失败：${file.name || '未命名文件'}`, 'warning');
      }
    }
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

    const nativePaths = nativePathsFromDataTransfer(e.clipboardData);
    if (nativePaths.length > 0) {
      e.preventDefault();
      addPathAttachments(nativePaths);
      return;
    }

    const clipboardFiles = Array.from(e.clipboardData?.files || []);
    if (dataTransferContainsDirectory(e.clipboardData)) {
      e.preventDefault();
      onToast?.('当前浏览器未提供文件夹物理路径，请使用支持本地路径桥接的窗口拖入。', 'warning');
      return;
    }
    if (clipboardFiles.length > 0) {
      e.preventDefault();
      void addFileObjects(clipboardFiles);
      return;
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
    void addFileObjects(files);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (sessionReadOnly) return;
    if (sessionFrozen || sessionTransitioning) return;
    const nativePaths = nativePathsFromDataTransfer(e.dataTransfer);
    if (nativePaths.length > 0) {
      addPathAttachments(nativePaths);
      return;
    }
    if (dataTransferContainsDirectory(e.dataTransfer)) {
      onToast?.('当前浏览器未提供文件夹物理路径，请使用支持本地路径桥接的窗口拖入。', 'warning');
      return;
    }
    void addFileObjects(e.dataTransfer?.files);
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (sessionReadOnly) return;
    if (!sessionActive) {
      onToast?.(
        isNewSessionLanding
          ? '请先选择项目，创建空白会话后再发送。'
          : '会话正在加载，请稍候再发送。',
        'info',
      );
      return;
    }
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
    if (composerDirective && !parsedWorkflow.prompt.trim()) {
      onToast?.('请先输入目标或任务内容，再启用计划/目标。', 'warning');
      return;
    }
    if (
      !parsedWorkflow.prompt
      && attachedImages.length === 0
      && attachedTextAttachments.length === 0
      && attachedFileAttachments.length === 0
      && selectedSkillRefs.length === 0
      && !workflow
    ) return;

    const parsedSkills = parseSkillPrompt(parsedWorkflow.prompt, availableSkills);
    const selectedSkills = [...new Set([
      ...selectedSkillRefs,
      ...parsedSkills.selectedSkills,
    ])];
    if (parsedSkills.unknownSkills.length > 0) {
      onToast?.(`未知或已禁用技能: ${parsedSkills.unknownSkills.map((name) => `$${name}`).join('、')}`, 'warning');
      return;
    }
    if (selectedSkills.length > 8) {
      onToast?.('每个 Turn 最多加载 8 个技能', 'warning');
      return;
    }

    if (text.startsWith('/')) {
      const handled = executeSlashCommand(text);
      if (handled) {
        setShowSlashPopup(false);
        setAttachedImages([]);
        setAttachedTextAttachments([]);
        setAttachedFileAttachments([]);
        setReferencedFiles([]);
        return;
      }
    }

    const payload = {
      prompt: parsedSkills.prompt,
      images: attachedImages.map((img) => img.dataUrl),
      textAttachments: attachedTextAttachments.map(({ name, content }) => ({ name, content })),
      fileAttachments: attachedFileAttachments,
      referencedFiles,
      selectedSkills,
      workflow,
      directive: composerDirective,
    };

    let accepted = true;
    if (isGenerating) {
      onQueueMessage?.(payload);
    } else if (composerDirective?.kind === 'plan') {
      accepted = onStartPlanTask ? await onStartPlanTask(payload) : false;
    } else if (composerDirective?.kind === 'goal') {
      accepted = onStartGoal ? await onStartGoal(payload) : false;
    } else {
      accepted = onSendMessage ? onSendMessage(payload) !== false : false;
    }

    if (accepted === false) return;

    setPrompt('');
    setSelectedSkillRefs([]);
    setAttachedImages([]);
    setAttachedTextAttachments([]);
    setAttachedFileAttachments([]);
    setReferencedFiles([]);
    setWorkflowSelection(null);
    setComposerDirective(null);
    setShowSlashPopup(false);
    setShowMentionPopup(false);
    setShowSkillPopup(false);
  };

  const visibleSelectedSkills = [...new Set([
    ...selectedSkillRefs,
    ...parseSkillPrompt(prompt, availableSkills).selectedSkills,
  ])];

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
      void handleSubmit();
    }
  };

  const runSessionControl = (handler) => {
    if (typeof handler !== 'function') return;
    void Promise.resolve(handler()).catch((cause) => {
      onToast?.(cause?.message || '会话控制失败', 'error', 4000);
    });
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
            <span>添加 (+)</span>
            <span className="mention-popup-count font-mono">仅当前 Turn</span>
          </div>
          <button
            type="button"
            className="plugin-item composer-add-item"
            onClick={() => {
              fileInputRef.current?.click();
              setShowPluginPopup(false);
            }}
            disabled={sessionReadOnly}
          >
            <FileCode size={13} />
            <span>文件</span>
            <span className="skill-desc">选择文件；文件夹请直接复制或拖入</span>
          </button>
          <button
            type="button"
            className={'plugin-item composer-add-item ' + (composerDirective?.kind === 'goal' ? 'selected' : '')}
            onClick={() => {
              setComposerDirective({ kind: 'goal' });
              setShowPluginPopup(false);
              textareaRef.current?.focus();
            }}
            disabled={sessionReadOnly}
          >
            <Target size={13} className="text-green" />
            <span>目标</span>
            <span className="skill-desc">提交后设置 Goal 并发送当前任务</span>
          </button>
          <button
            type="button"
            className={'plugin-item composer-add-item ' + (composerDirective?.kind === 'plan' ? 'selected' : '')}
            onClick={() => {
              setComposerDirective({ kind: 'plan' });
              setShowPluginPopup(false);
              textareaRef.current?.focus();
            }}
            disabled={sessionReadOnly}
          >
            <Compass size={13} className="text-amber" />
            <span>计划模式</span>
            <span className="skill-desc">提交后进入 Plan Mode 并发送当前任务</span>
          </button>
          <div className="composer-popup-section-label">插件工作流</div>
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
      <form
        className="input-form"
        onSubmit={handleSubmit}
        onDragOver={(e) => {
          const types = Array.from(e.dataTransfer?.types || []);
          if (!sessionReadOnly && types.includes('Files')) e.preventDefault();
        }}
        onDrop={handleDrop}
      >
        {/* Hidden file input; folders use path-aware drag/paste instead. */}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept="*/*"
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
                  <span className="attached-image-size font-mono">
                    图片 · {(img.size / 1024).toFixed(1)} KB
                  </span>
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

        {attachedFileAttachments.length > 0 && (
          <div className="attached-files-bar" aria-label="文件附件">
            {attachedFileAttachments.map((attachment, index) => {
              const isPath = Boolean(attachment.path);
              return (
                <div
                  className="attached-file-card"
                  key={attachment.id || `${attachment.name}_${index}`}
                  title={isPath ? attachment.path : attachment.name}
                >
                  {isPath ? <Folder size={15} /> : <FileCode size={15} />}
                  <div className="attached-image-meta">
                    <span className="attached-image-name">{attachment.name}</span>
                    <span className="attached-image-size font-mono">
                      {isPath ? '本地路径 · 当前 Session 可读' : '文件附件'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-remove-attached-image"
                    onClick={() => setAttachedFileAttachments((previous) => previous.filter((_, i) => i !== index))}
                    title="移除文件附件"
                    aria-label={`移除文件附件 ${attachment.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
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

        {visibleSelectedSkills.length > 0 && (
          <div className="selected-skills-bar">
            {visibleSelectedSkills.map((name) => (
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
        {composerDirective && (
          <div className="selected-skills-bar">
            <span className="selected-skill-chip composer-directive-chip font-mono">
              {composerDirective.kind === 'goal'
                ? <Target size={10} className="text-green" />
                : <Compass size={10} className="text-amber" />}
              {composerDirective.kind === 'goal' ? '目标' : '计划'}
              <button
                type="button"
                onClick={() => setComposerDirective(null)}
                title="取消临时任务模式"
                aria-label="取消临时任务模式"
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
            disabled={sessionReadOnly || sessionFrozen || sessionTransitioning}
            placeholder={
              sessionReadOnly
                ? '只读查看：该会话由其他进程运行，结束后可重新接管'
                : sessionFrozen
                  ? '会话已冻结；点击“继续整个会话”恢复原进度'
                  : sessionTransitioning
                    ? sessionControl?.status === 'freezing' ? '正在停止整个会话并等待结算…' : '正在恢复整个会话…'
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
              disabled={sessionReadOnly}
              title="添加文件、目标、计划或当前 Turn 的插件工作流"
            >
              <Plus size={15} />
            </button>
            <span className="hint-kbd font-mono">Enter 发送</span>
          </div>

          {/* Bottom-Right: Action Buttons */}
          <div className="input-actions">
            {currentThread && (
              <div className="composer-model-controls">
                <label className="composer-model-select-wrap" title={effectiveModelProblem || '切换当前 Thread 的模型'}>
                  <span>模型</span>
                  <select
                    aria-label="当前会话模型"
                    value={threadSelectionKey || '__default__'}
                    disabled={modelSelectionDisabled}
                    onChange={(event) => {
                      const selected = modelEntries.find((entry) => entry.key === event.target.value);
                      if (!selected) {
                        void saveThreadModelSettings(null, null);
                        return;
                      }
                      const current = effectiveReasoningSelection;
                      const remainsSupported = current.kind !== 'level'
                        || selected.model.reasoningLevels?.includes(current.value);
                      void saveThreadModelSettings(
                        selected.selection,
                        remainsSupported ? current : { kind: 'api_default' },
                      );
                    }}
                  >
                    <option value="__default__">
                      {inheritedEntry
                        ? `默认 · ${inheritedEntry.provider.name} / ${inheritedEntry.model.name || inheritedEntry.model.id}`
                        : '使用项目 / 全局默认'}
                    </option>
                    {modelCatalog.providers.map((provider) => (
                      <optgroup key={provider.id} label={provider.name}>
                        {(provider.models || []).map((model) => {
                          const key = `${provider.id}::${model.id}`;
                          const disabledReason = !provider.enabled
                            ? '供应商已停用'
                            : !model.enabled
                              ? '模型已停用'
                              : !provider.baseUrl?.trim()
                                ? '未填写 Base URL'
                                : !provider.apiKeyConfigured
                                  ? '未配置 API Key'
                                  : '';
                          return (
                            <option key={key} value={key} disabled={Boolean(disabledReason)}>
                              {model.name || model.id}{disabledReason ? `（${disabledReason}）` : ''}
                            </option>
                          );
                        })}
                      </optgroup>
                    ))}
                  </select>
                </label>
                {reasoningLevels.length > 0 && (
                  <label className="composer-reasoning-select-wrap" title="设置当前 Thread 的推理等级">
                    <span>推理</span>
                    <select
                      aria-label="当前会话推理等级"
                      value={reasoningValue}
                      disabled={modelSelectionDisabled}
                      onChange={(event) => void saveThreadModelSettings(
                        threadModelSettings.model_selection,
                        event.target.value === 'api_default'
                          ? { kind: 'api_default' }
                          : { kind: 'level', value: event.target.value.slice('level:'.length) },
                      )}
                    >
                      <option value="api_default">使用 API 默认</option>
                      {reasoningLevels.map((level) => <option key={level} value={`level:${level}`}>{reasoningLevelLabel(level)}</option>)}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="composer-model-settings"
                  onClick={() => onOpenSettings?.('models')}
                  title="管理供应商和模型"
                  aria-label="管理模型设置"
                >
                  <Settings size={14} />
                </button>
                {(modelSettingsError || effectiveModelProblem) && (
                  <span className="composer-model-warning" role="status">
                    {modelSettingsError || effectiveModelProblem}
                  </span>
                )}
              </div>
            )}
            {sessionReadOnly ? (
              <span className="readonly-session-label">只读查看</span>
            ) : sessionFrozen ? (
              <button
                type="button"
                className="btn-action send"
                onClick={() => runSessionControl(onContinueSession)}
                title="恢复主线程与主线程冻结的子任务"
              >
                <Send size={13} />
                <span>继续整个会话</span>
              </button>
            ) : sessionTransitioning ? (
              <button type="button" className="btn-action stop" disabled>
                <Square size={13} />
                <span>{sessionControl?.status === 'freezing' ? '停止中' : '恢复中'}</span>
              </button>
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
            ) : isGenerating || hasSessionActivity ? (
              <button
                type="button"
                className="btn-action stop"
                onClick={() => runSessionControl(isGenerating ? onInterrupt : onFreezeSession)}
                title="冻结当前会话、活动子任务和子任务队列"
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
                   && attachedFileAttachments.length === 0
                 ) || !!pendingApproval || modelSettingsSaving || Boolean(effectiveModelProblem)}
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
