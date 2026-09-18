import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  X,
  RefreshCw,
  Cpu,
  Target,
  Layers,
  GitBranch,
  Play,
  Pause,
  Compass,
  FileText,
  Terminal,
  RotateCcw,
  Wrench,
  Activity,
  Sparkles,
  BookOpen,
  ChevronDown,
  Check,
  Copy,
} from 'lucide-react';
import { api } from '../api';
import { readStateRevision, shouldApplyStateRevision } from '../utils/revisionState';
import StatusDetailsPane from './StatusDetailsPane';
import SkillPanel from './SkillPanel';
import NotebookPane from './NotebookPane';
import './SidePanel.css';

const BUILTIN_TOOL_INFO = {
  read_file: { name: 'read_file', label: '读取文件', desc: '只读检查工作区文件与代码' },
  apply_patch: { name: 'apply_patch', label: '应用补丁', desc: '原子化添加、修改、移动或删除文件' },
  shell: { name: 'shell', label: '终端命令', desc: '执行命令行检查与自动化测试' },
  web_fetch: { name: 'web_fetch', label: '网页抓取', desc: '抓取外部 HTTP 与静态文档' },
  read_image: { name: 'read_image', label: '图像读取', desc: '读取并解析视觉/图像资源' },
  scheduled_task: { name: 'scheduled_task', label: '定时唤醒', desc: '安排有界延时，让下一轮继续查询远程状态' },
};

function PlanModeCard({ planActive, onTogglePlan }) {
  return (
    <div className="workflow-card">
      <div className="workflow-card-header">
        <div className="workflow-title-wrap">
          <Compass size={15} className="text-amber" />
          <div>
            <span className="workflow-title">规划模式 (Plan Mode)</span>
            <p className="workflow-sub">
              源码只读规划，可手动切换模式
            </p>
          </div>
        </div>
        <div className="plan-mode-controls">
          <span className={`plan-mode-badge ${planActive ? 'on' : 'off'}`}>
            {planActive ? '规划阶段' : '默认模式'}
          </span>
          <button
            type="button"
            className={`btn-toggle-switch ${planActive ? 'on' : 'off'}`}
            onClick={onTogglePlan}
            aria-pressed={planActive}
            title={planActive ? '关闭 Plan Mode，进入默认实施模式' : '开启 Plan Mode，进入只读规划阶段'}
          >
            <span>{planActive ? '关闭 Plan Mode' : '开启 Plan Mode'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function BuiltinToolsCard({ availableBuiltinTools, selectedBuiltinTools, onToggle }) {
  return (
    <div className="workflow-card">
      <div className="workflow-card-header">
        <div className="workflow-title-wrap">
          <Wrench size={15} className="text-sky" />
          <div>
            <span className="workflow-title">内置工具权限控制 (Builtin Tools)</span>
            <p className="workflow-sub">
              当前 Thread 可受控暴露的 5 种工具；默认仅启用 4 个核心工具，反选即可剥离调用能力
            </p>
          </div>
        </div>
      </div>

      <div className="builtin-tools-grid">
        {availableBuiltinTools.map((toolName) => {
          const info = BUILTIN_TOOL_INFO[toolName] || {
            name: toolName,
            label: toolName,
            desc: '',
          };
          const isChecked = selectedBuiltinTools.includes(toolName);
          return (
            <button
              type="button"
              key={toolName}
              className={`builtin-tool-chip ${isChecked ? 'active' : 'inactive'}`}
              onClick={() => onToggle(toolName)}
              title={info.desc}
            >
              <div className="chip-header">
                <span className="chip-name font-mono">{info.name}</span>
                <span className={`chip-badge ${isChecked ? 'enabled' : 'disabled'}`}>
                  {isChecked ? '已启用' : '已禁用'}
                </span>
              </div>
              <div className="chip-label">{info.label}</div>
              <div className="chip-desc">{info.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GoalWorkflowCard({
  goal,
  goalObjectiveInput,
  onGoalObjectiveInputChange,
  onStartGoal,
  onPauseGoal,
  onResumeGoal,
  onUpdateGoal,
  onClearGoal,
}) {
  const isGoalRunning = Boolean(goal);

  return (
    <div className="workflow-card">
      <div className="workflow-card-header">
        <div className="workflow-title-wrap">
          <Target size={15} className="text-green" />
          <div>
            <span className="workflow-title">线程目标 (Thread Goal)</span>
            <p className="workflow-sub">由 Goal Runtime 按预算自动推进，并实时报告状态</p>
          </div>
        </div>
      </div>

      {isGoalRunning ? (
        <div className="goal-status-box">
          <div className="goal-meta-row font-mono">
            <span>Thread: <strong>{goal.thread_id}</strong></span>
            <span className={`goal-badge ${goal.status}`}>
              {goal.status}
            </span>
          </div>
          <div className="goal-objective">{goal.objective}</div>
          <div className="milestone-text font-mono">
            Milestone: {goal.current_milestone || 0} / {goal.total_milestones || 0}
            {' · '}Loops: {goal.loop_count || 0}
            {' · '}
            Tokens: {goal.tokens_used} / {goal.token_budget ?? '∞'}
            {' · '}Time: {goal.time_used_seconds}s
          </div>
          <div className={`goal-verification-status ${goal.verification_status || 'idle'}`}>
            <strong>Verify</strong>
            <span>{goal.verification_status || 'idle'}</span>
          </div>
          {goal.last_error && (
            <div className="goal-error-detail" title={goal.last_error}>
              {goal.last_error}
            </div>
          )}
          <div className="goal-actions">
            {goal.status === 'paused' ? (
              <button className="btn-action-small" onClick={onResumeGoal}>
                <Play size={12} />
                <span>恢复</span>
              </button>
            ) : goal.status === 'active' ? (
              <button className="btn-action-small" onClick={onPauseGoal}>
                <Pause size={12} />
                <span>暂停</span>
              </button>
            ) : null}
            <button className="btn-action-small" onClick={onUpdateGoal}>
              <FileText size={12} />
              <span>更新</span>
            </button>
            <button className="btn-action-small" onClick={onClearGoal}>
              <RotateCcw size={12} />
              <span>删除</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="goal-input-box">
          <input
            type="text"
            className="goal-input font-mono"
            placeholder="输入 Thread Goal，例如: 完成前端重构并通过测试"
            value={goalObjectiveInput}
            onChange={(e) => onGoalObjectiveInputChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onStartGoal()}
          />
          <button className="btn-start-goal" onClick={onStartGoal}>
            <Play size={12} />
            <span>设置目标</span>
          </button>
        </div>
      )}
    </div>
  );
}

function normalizePanelTab(tab) {
  if (tab === 'world' || tab === 'workspace') return 'workspace_world';
  if (tab === 'mcp') return 'workspace_mcp';
  if (tab === 'git') return 'workspace_git';
  if (tab === 'skills') return 'workspace_skills';
  if (tab === 'tools' || tab === 'builtin_tools') return 'workspace_tools';
  if (tab === 'plan' || tab === 'plan_view') return 'plan_view';
  if (tab === 'plan_goal' || tab === 'goal') return 'goal';
  if (tab === 'notebook' || tab === 'memory') return 'notebook';
  return tab || 'status';
}

function isPlanArtifact(file) {
  const path = typeof file?.path === 'string' ? file.path.toLowerCase() : '';
  return path === 'plan.md' || path === 'plan/plan.md' || path === 'plan\\plan.md';
}

function isGoalArtifact(file) {
  const path = typeof file?.path === 'string' ? file.path.toLowerCase() : '';
  return path.startsWith('goal/') || path.startsWith('goal\\');
}

function WorkflowFileContent({ path, content, emptyMessage }) {
  if (!content) return <div className="no-content">{emptyMessage}</div>;

  const isMarkdown = /\.(md|markdown)$/i.test(path || '');
  return isMarkdown ? (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  ) : (
    <pre className="file-raw-content">{content}</pre>
  );
}

function formatXmlContext(context) {
  if (!context) return [];
  const separated = context
    .replace(/>\s*</g, '><')
    .replace(/></g, '>\n<')
    .replace(/>([^<\r\n]+)</g, '>\n$1\n<');
  let depth = 0;
  return separated
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const closing = /^<\//.test(line);
      const opening = /^<[A-Za-z_][\w:.-]*/.test(line)
        && !/^<\?/.test(line)
        && !/^<!/.test(line)
        && !/\/>$/.test(line);
      if (closing) depth = Math.max(0, depth - 1);
      const result = `${'  '.repeat(depth)}${line}`;
      if (opening) depth += 1;
      return result;
    });
}

function renderXmlLine(line, lineIndex) {
  const tagStart = line.indexOf('<');
  if (tagStart < 0) {
    return (
      <>
        <span className="xml-line-number" aria-hidden="true">{lineIndex + 1}</span>
        <span className="xml-line-text">{line}</span>
      </>
    );
  }

  const prefix = line.slice(0, tagStart);
  const tag = line.slice(tagStart);
  const parts = [];
  let cursor = 0;
  const tokenPattern = /(<\/?[A-Za-z_][\w:.-]*|\/?>|[A-Za-z_][\w:.-]*(?=\s*=)|"[^"\r\n]*"|'[^'\r\n]*')/g;
  tag.replace(tokenPattern, (match, _unused, offset) => {
    if (offset > cursor) parts.push(<span key={`text-${offset}`}>{tag.slice(cursor, offset)}</span>);
    const className = match.startsWith('<') || match.includes('>')
      ? 'xml-tag-token'
      : match.startsWith('"') || match.startsWith("'")
        ? 'xml-attribute-value'
        : 'xml-attribute-name';
    parts.push(<span className={className} key={`token-${offset}`}>{match}</span>);
    cursor = offset + match.length;
    return match;
  });
  if (cursor < tag.length) parts.push(<span key="tail">{tag.slice(cursor)}</span>);

  return (
    <>
      <span className="xml-line-number" aria-hidden="true">{lineIndex + 1}</span>
      <span className="xml-line-text">{prefix}{parts}</span>
    </>
  );
}

function XmlContextPreview({ context }) {
  const lines = formatXmlContext(context);
  return (
    <div className="xml-preview prompt-context-raw" role="region" aria-label="格式化 XML 上下文" tabIndex="0">
      {lines.length > 0 ? lines.map((line, index) => (
        <div className="xml-line" key={`${index}-${line}`}>
          {renderXmlLine(line, index)}
        </div>
      )) : (
        <div className="xml-empty">暂无注入内容</div>
      )}
    </div>
  );
}

export function PromptContextCard({ context, status = {}, workspace = '' }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const roots = Array.isArray(status.workspace_roots) ? status.workspace_roots : [];
  const sessionRoots = Array.isArray(status.session_read_roots)
    ? status.session_read_roots
    : [];
  const availableCommands = Array.isArray(status.available_commands)
    ? status.available_commands
    : [];
  const summary = [
    ['模式', status.mode || 'chat'],
    ['访问', status.access || 'default'],
    ['策略', status.policy || 'interactive'],
    ['文件范围', status.direct_file_scope || 'workspace'],
  ];

  const handleCopy = async () => {
    if (!context || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(context);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="detail-card full-width prompt-context-card">
      <div className="prompt-context-header">
        <div>
          <span className="card-label">系统注入上下文</span>
          <span className="prompt-context-caption">模型可见的环境与运行约束</span>
        </div>
        <span className="prompt-context-badge">已注入</span>
      </div>

      <div className="prompt-context-summary" aria-label="系统注入上下文摘要">
        {summary.map(([label, value]) => (
          <div className="prompt-context-summary-item" key={label}>
            <span>{label}</span>
            <strong className="font-mono">{value}</strong>
          </div>
        ))}
      </div>

      <div className="prompt-context-meta">
        <span>{roots.length || (workspace ? 1 : 0)} 个工作区根目录</span>
        {sessionRoots.length > 0 && (
          <span title={sessionRoots.map((root) => root.path).filter(Boolean).join('\n')}>
            {sessionRoots.length} 个会话附件根
          </span>
        )}
        <span>{availableCommands.length} 个可用命令</span>
        <span>{context ? `${context.length.toLocaleString()} 字符` : '无原文'}</span>
      </div>

      <div className="prompt-context-actions">
        <button
          type="button"
          className="prompt-context-toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <ChevronDown size={13} className={expanded ? 'prompt-context-chevron expanded' : 'prompt-context-chevron'} />
          <span>{expanded ? '收起完整注入内容' : '查看完整注入内容'}</span>
        </button>
        {expanded && (
          <button
            type="button"
            className="prompt-context-copy"
            onClick={handleCopy}
            disabled={!context}
            title="复制完整注入内容"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? '已复制' : '复制原文'}</span>
          </button>
        )}
      </div>

      {expanded && (
        <XmlContextPreview context={context} />
      )}
    </div>
  );
}

export default function SidePanel({
  isOpen,
  initialTab = 'world',
  onClose,
  planActive,
  onTogglePlan,
  goalState,
  status = null,
  sessionMeta = null,
  threadId = 'default',
  projectId = null,
  onGoalChanged,
  onToast,
  availableSkills = [],
  skillGroups = [],
  skillsLoading = false,
  skillsError = null,
  onToggleSkillGroup,
  onInsertSkill,
  onOpenThread,
}) {
  const [activeTab, setActiveTab] = useState(() => normalizePanelTab(initialTab));
  const [worldData, setWorldData] = useState(null);
  const [mcpData, setMcpData] = useState(null);
  const [workflowState, setWorkflowState] = useState(goalState || null);
  const [workflowFiles, setWorkflowFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFileContent, setSelectedFileContent] = useState('');
  const [gitData, setGitData] = useState(null);
  const [goalObjectiveInput, setGoalObjectiveInput] = useState('');
  const [selectedBuiltinTools, setSelectedBuiltinTools] = useState([
    'read_file',
    'apply_patch',
    'shell',
    'read_image',
    'scheduled_task',
  ]);
  const [availableBuiltinTools, setAvailableBuiltinTools] = useState([
    'read_file',
    'apply_patch',
    'shell',
    'web_fetch',
    'read_image',
    'scheduled_task',
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRetryingMcp, setIsRetryingMcp] = useState(false);
  const workflowRevisionRef = useRef(null);
  const selectedFileRef = useRef(null);
  const requestEpochRef = useRef(0);
  const requestControllerRef = useRef(null);
  const fileEpochRef = useRef(0);
  const fileControllerRef = useRef(null);

  useEffect(() => {
    if (initialTab) setActiveTab(normalizePanelTab(initialTab));
  }, [initialTab]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (goalState === undefined && planActive === undefined) return;
    setWorkflowState((current) => ({
      ...(current || {}),
      collaboration_mode: {
        ...(current?.collaboration_mode || {}),
        mode: planActive ? 'plan' : 'default',
      },
      goal: goalState === undefined ? current?.goal || null : goalState,
    }));
  }, [goalState, planActive]);

  useEffect(() => {
    workflowRevisionRef.current = null;
    selectedFileRef.current = null;
    setSelectedFile(null);
    setSelectedFileContent('');
    setWorkflowFiles([]);
    setWorkflowState(goalState || null);
  }, [threadId, projectId]);

  useEffect(() => {
    requestControllerRef.current?.abort();
    fileControllerRef.current?.abort();
    if (!isOpen) return undefined;
    const context = beginRequest();
    loadAllData(context);
    return () => {
      requestControllerRef.current?.abort();
      fileControllerRef.current?.abort();
      requestEpochRef.current += 1;
      fileEpochRef.current += 1;
    };
  }, [
    isOpen,
    activeTab,
    threadId,
    projectId,
    goalState?.verification_status,
    goalState?.updated_at,
  ]);

  const beginRequest = () => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    requestEpochRef.current += 1;
    return {
      epoch: requestEpochRef.current,
      threadId,
      projectId,
      signal: controller.signal,
    };
  };

  const isCurrentRequest = (context) => (
    context
      && context.epoch === requestEpochRef.current
      && context.threadId === threadId
      && (context.projectId || null) === (projectId || null)
  );

  const isAbortError = (err) => err?.name === 'AbortError';

  const beginMutationRequest = () => beginRequest();

  const loadAllData = async (context = null) => {
    const requestContext = context || beginRequest();
    setIsLoading(true);
    try {
      if (activeTab === 'workspace_world') {
        await loadWorld(requestContext);
      } else if (activeTab === 'plan_view') {
        await loadWorkflowFiles(requestContext);
      } else if (activeTab === 'workspace_tools' || activeTab === 'goal') {
        if (activeTab === 'goal') {
          await Promise.all([
            loadWorkflow(requestContext),
            loadWorkflowFiles(requestContext, isGoalArtifact),
          ]);
        } else {
          await loadWorkflow(requestContext);
        }
      } else if (activeTab === 'workspace_mcp') {
        await loadMcp(requestContext);
      } else if (activeTab === 'workspace_git') {
        await loadGit(requestContext);
      }
    } finally {
      if (isCurrentRequest(requestContext)) setIsLoading(false);
    }
  };

  const loadWorld = async (context = null) => {
    const requestContext = context || beginRequest();
    try {
      const data = await api.getWorldState({ projectId, signal: requestContext.signal });
      if (isCurrentRequest(requestContext)) setWorldData(data);
    } catch (err) {
      if (isAbortError(err) || !isCurrentRequest(requestContext)) return;
      console.error('Failed to load world state:', err);
    }
  };

  const handleRefreshWorld = async () => {
    const context = beginMutationRequest();
    try {
      await api.refreshWorld({ projectId, signal: context.signal });
      if (!isCurrentRequest(context)) return;
      await loadWorld(context);
    } catch (err) {
      if (isAbortError(err) || !isCurrentRequest(context)) return;
      alert(`刷新环境探测失败: ${err.message}`);
    }
  };

  const loadWorkflow = async (context = null) => {
    const requestContext = context || beginRequest();
    try {
      const data = await api.getWorkflowState(threadId, {
        projectId,
        signal: requestContext.signal,
      });
      if (!isCurrentRequest(requestContext)) return;
      const nextRevision = readStateRevision(data);
      if (!shouldApplyStateRevision(workflowRevisionRef.current, nextRevision)) return;
      if (nextRevision !== null) workflowRevisionRef.current = nextRevision;
      setWorkflowState(data);
      if (Array.isArray(data.builtin_tools)) {
        setSelectedBuiltinTools(data.builtin_tools);
      }
      if (
        Array.isArray(data.available_builtin_tools) &&
        data.available_builtin_tools.length > 0
      ) {
        setAvailableBuiltinTools(data.available_builtin_tools);
      }
    } catch (err) {
      if (isAbortError(err) || !isCurrentRequest(requestContext)) return;
      console.error('Failed to load workflow state:', err);
    }
  };

  const handleToggleBuiltinTool = async (toolName) => {
    const context = beginMutationRequest();
    const nextTools = selectedBuiltinTools.includes(toolName)
      ? selectedBuiltinTools.filter((t) => t !== toolName)
      : [...selectedBuiltinTools, toolName];

    setSelectedBuiltinTools(nextTools);
    try {
      await api.updateThreadSettings(
        planActive ? 'plan' : 'default',
        nextTools,
        threadId,
        null,
        { projectId, signal: context.signal },
      );
      if (!isCurrentRequest(context)) return;
      if (onToast) {
        onToast(
          nextTools.includes(toolName)
            ? `已启用内置工具: ${toolName}`
            : `已限制内置工具: ${toolName}`,
          'info'
        );
      }
    } catch (err) {
      if (isAbortError(err) || !isCurrentRequest(context)) return;
      console.error('Failed to update builtin tool settings:', err);
      if (onToast) {
        onToast(`更新内置工具配置失败: ${err.message}`, 'error');
      }
      setSelectedBuiltinTools(selectedBuiltinTools);
    }
  };

  const loadWorkflowFiles = async (context = null, filter = isPlanArtifact) => {
    const requestContext = context || beginRequest();
    try {
      const res = await api.getWorkflowFiles(threadId, {
        projectId,
        signal: requestContext.signal,
      });
      if (!isCurrentRequest(requestContext)) return;
      const files = (res.files || []).filter(filter);
      setWorkflowFiles(files);
      if (
        files.length > 0
        && (
          !selectedFileRef.current
          || !files.some((file) => file.path === selectedFileRef.current)
        )
      ) {
        handleSelectFile(files[0].path, requestContext);
      } else if (!files.some((file) => file.path === selectedFileRef.current)) {
        selectedFileRef.current = null;
        setSelectedFile(null);
        setSelectedFileContent('');
      }
    } catch (err) {
      if (isAbortError(err) || !isCurrentRequest(requestContext)) return;
      console.error('Failed to load workflow files:', err);
    }
  };

  const handleSelectFile = async (path, panelContext = null) => {
    const requestContext = panelContext || {
      epoch: requestEpochRef.current,
      threadId,
      projectId,
    };
    fileControllerRef.current?.abort();
    const controller = new AbortController();
    fileControllerRef.current = controller;
    fileEpochRef.current += 1;
    const fileEpoch = fileEpochRef.current;
    if (!isCurrentRequest(requestContext)) return;
    selectedFileRef.current = path;
    setSelectedFile(path);
    setSelectedFileContent('');
    try {
      const res = await api.getWorkflowFileContent(path, threadId, {
        projectId,
        signal: controller.signal,
      });
      if (isCurrentRequest(requestContext) && fileEpoch === fileEpochRef.current) {
        setSelectedFileContent(res.content);
      }
    } catch (err) {
      if (!isAbortError(err) && isCurrentRequest(requestContext) && fileEpoch === fileEpochRef.current) {
        setSelectedFileContent(`// 读取文件失败: ${err.message}`);
      }
    }
  };

  const loadMcp = async (context = null) => {
    const requestContext = context || beginRequest();
    try {
      const data = await api.getMcpStatus({ projectId, signal: requestContext.signal });
      if (isCurrentRequest(requestContext)) setMcpData(data);
    } catch (err) {
      if (isAbortError(err) || !isCurrentRequest(requestContext)) return;
      console.error('Failed to load MCP status:', err);
    }
  };

  const handleRetryMcp = async () => {
    const context = beginMutationRequest();
    setIsRetryingMcp(true);
    try {
      const data = await api.retryMcp({ projectId, signal: context.signal });
      if (isCurrentRequest(context)) setMcpData(data);
    } catch (err) {
      if (isAbortError(err) || !isCurrentRequest(context)) return;
      console.error('Failed to retry MCP:', err);
    } finally {
      if (isCurrentRequest(context)) setIsRetryingMcp(false);
    }
  };

  const loadGit = async (context = null) => {
    const requestContext = context || beginRequest();
    try {
      const data = await api.getGitStatus({ projectId, signal: requestContext.signal });
      if (isCurrentRequest(requestContext)) setGitData(data);
    } catch (err) {
      if (isAbortError(err) || !isCurrentRequest(requestContext)) return;
      console.error('Failed to load git status:', err);
    }
  };

  const handleStartGoal = async () => {
    if (!goalObjectiveInput.trim()) return;
    const context = beginMutationRequest();
    try {
      const result = await api.setGoal(
        goalObjectiveInput.trim(),
        null,
        'active',
        threadId,
        { projectId, signal: context.signal },
      );
      if (!isCurrentRequest(context)) return;
      setGoalObjectiveInput('');
      if (onGoalChanged) onGoalChanged(result.goal || null, result);
      await loadWorkflow(context);
      if (onToast) {
        onToast('已设置 Thread Goal，运行时将自动推进', 'success');
      }
    } catch (err) {
      if (isAbortError(err) || !isCurrentRequest(context)) return;
      if (onToast) {
        onToast(`设置 Goal 失败: ${err.message}`, 'error');
      }
    }
  };

  const handleClearGoal = async () => {
    const context = beginMutationRequest();
    try {
      const result = await api.clearGoal(threadId, { projectId, signal: context.signal });
      if (!isCurrentRequest(context)) return;
      if (onGoalChanged) onGoalChanged(null, result);
      await loadWorkflow(context);
      if (onToast) onToast('已清除 Thread Goal', 'success');
    } catch (err) {
      if (isAbortError(err) || !isCurrentRequest(context)) return;
      if (onToast) onToast(`清除 Goal 失败: ${err.message}`, 'error');
    }
  };

  const handlePauseGoal = async () => {
    const context = beginMutationRequest();
    try {
      const result = await api.pauseGoal(threadId, { projectId, signal: context.signal });
      if (!isCurrentRequest(context)) return;
      if (onGoalChanged) onGoalChanged(result.goal, result);
      await loadWorkflow(context);
      if (onToast) onToast('Goal 已暂停，可随时恢复', 'info');
    } catch (err) {
      if (isAbortError(err) || !isCurrentRequest(context)) return;
      if (onToast) onToast(`暂停 Goal 失败: ${err.message}`, 'error');
    }
  };

  const handleResumeGoal = async () => {
    const context = beginMutationRequest();
    try {
      const result = await api.resumeGoal(threadId, { projectId, signal: context.signal });
      if (!isCurrentRequest(context)) return;
      if (onGoalChanged) onGoalChanged(result.goal, result);
      await loadWorkflow(context);
      if (onToast) onToast('Goal 已恢复，运行时将继续推进', 'success');
    } catch (err) {
      if (isAbortError(err) || !isCurrentRequest(context)) return;
      if (onToast) onToast(`恢复 Goal 失败: ${err.message}`, 'error');
    }
  };

  const handleUpdateGoal = async () => {
    const goal = workflowState?.goal;
    if (!goal) return;
    const objective = window.prompt('更新当前 Thread Goal', goal.objective);
    if (!objective || objective.trim() === goal.objective.trim()) return;
    const context = beginMutationRequest();
    try {
      const result = await api.updateGoal(
        objective.trim(),
        goal.token_budget,
        threadId,
        { projectId, signal: context.signal },
      );
      if (!isCurrentRequest(context)) return;
      if (onGoalChanged) onGoalChanged(result.goal, result);
      await loadWorkflow(context);
      if (onToast) onToast('Goal 目标已更新', 'success');
    } catch (err) {
      if (isAbortError(err) || !isCurrentRequest(context)) return;
      if (onToast) onToast(`更新 Goal 失败: ${err.message}`, 'error');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="sidepanel-overlay" onClick={onClose}>
      <div
        className={`sidepanel-container ${activeTab === 'plan_view' ? 'plan-view-active' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="运行详情抽屉"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Tabs */}
        <div className="sidepanel-header">
          <div className="sidepanel-tabs">
            <button
              className={`panel-tab-btn ${activeTab === 'status' ? 'active' : ''}`}
              onClick={() => setActiveTab('status')}
            >
              <Activity size={14} />
              <span>运行状态</span>
            </button>

            <button
              className={`panel-tab-btn ${activeTab.startsWith('workspace_') ? 'active' : ''}`}
              onClick={() => setActiveTab('workspace_world')}
            >
              <Cpu size={14} />
              <span>工作区</span>
            </button>

            <button
              className={`panel-tab-btn ${activeTab === 'plan_view' ? 'active' : ''}`}
              onClick={() => setActiveTab('plan_view')}
            >
              <FileText size={14} />
              <span>计划</span>
            </button>

            <button
              className={`panel-tab-btn ${activeTab === 'goal' ? 'active' : ''}`}
              onClick={() => setActiveTab('goal')}
            >
              <Target size={14} />
              <span>目标</span>
            </button>

            <button
              className={`panel-tab-btn ${activeTab === 'notebook' ? 'active' : ''}`}
              onClick={() => setActiveTab('notebook')}
            >
              <BookOpen size={14} />
              <span>记忆</span>
            </button>

          </div>

          <button className="panel-close-btn" onClick={onClose} aria-label="关闭详情抽屉">
            <X size={15} />
          </button>
        </div>

        {/* Panel Content Body */}
        <div className={`sidepanel-content custom-scrollbar ${activeTab === 'plan_view' ? 'plan-view-content' : ''}`}>
          {activeTab.startsWith('workspace_') && (
            <div className="workspace-subtabs" role="tablist" aria-label="工作区详情">
              <button
                type="button"
                className={activeTab === 'workspace_world' ? 'active' : ''}
                onClick={() => setActiveTab('workspace_world')}
              >
                环境
              </button>
              <button
                type="button"
                className={activeTab === 'workspace_mcp' ? 'active' : ''}
                onClick={() => setActiveTab('workspace_mcp')}
              >
                MCP
              </button>
              <button
                type="button"
                className={activeTab === 'workspace_git' ? 'active' : ''}
                onClick={() => setActiveTab('workspace_git')}
              >
                文件与 Git
              </button>
              <button
                type="button"
                className={activeTab === 'workspace_skills' ? 'active' : ''}
                onClick={() => setActiveTab('workspace_skills')}
              >
                <Sparkles size={12} /> 技能
              </button>
              <button
                type="button"
                className={activeTab === 'workspace_tools' ? 'active' : ''}
                onClick={() => setActiveTab('workspace_tools')}
              >
                <Wrench size={12} /> 工具
              </button>
            </div>
          )}

          {activeTab === 'status' && (
            <StatusDetailsPane
              status={status}
              sessionMeta={sessionMeta}
              threadId={threadId}
              projectId={projectId}
              onOpenThread={onOpenThread}
            />
          )}

          {activeTab === 'plan_view' && (
            <div className="plan-view-pane">
              <PlanModeCard planActive={planActive} onTogglePlan={onTogglePlan} />
              <div className="plan-view-header">
                <div className="plan-view-heading">
                  <FileText size={15} className="text-amber" />
                  <div>
                    <strong>计划查看</strong>
                    <span>阅读当前会话生成的计划与配套文件</span>
                  </div>
                </div>
                <div className="plan-view-meta">
                  {planActive ? 'Plan Mode 已开启' : 'Plan Mode 未开启'}
                  <span>{workflowFiles.length} 个文件</span>
                </div>
              </div>

              <div className="workflow-files-section plan-viewer-section">
                <div className="section-title-bar">
                  <span>规划文件</span>
                  <span className="workflow-file-current font-mono">
                    {selectedFile || 'plan.md'}
                  </span>
                  <button
                    type="button"
                    className="btn-action-small"
                    onClick={() => loadWorkflowFiles()}
                    title="重新读取规划文件"
                  >
                    <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                    <span>刷新</span>
                  </button>
                </div>

                <div className="file-content-viewer plan-viewer-content plan-viewer-full-width custom-scrollbar">
                  <WorkflowFileContent
                    path={selectedFile}
                    content={selectedFileContent}
                    emptyMessage={workflowFiles.length > 0 ? '正在读取计划内容...' : '未发现 plan.md'}
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 1: WorldState */}
          {activeTab === 'workspace_world' && (
            <div className="tab-pane">
              <div className="pane-section-header">
                <span className="section-title">
                  <Terminal size={14} className="text-sky" />
                  环境探测与运行约束
                </span>
                <button
                  className="btn-action-small"
                  onClick={handleRefreshWorld}
                  title="重新扫描工作区与工具链"
                >
                  <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                  <span>重新扫描</span>
                </button>
              </div>

              {worldData ? (
                <div className="world-details-grid">
                  <div className="detail-card">
                    <span className="card-label">操作系统 (OS)</span>
                    <span className="card-val font-mono">{worldData.status?.os || 'unknown'}</span>
                  </div>

                  <div className="detail-card">
                    <span className="card-label">系统架构 (Arch)</span>
                    <span className="card-val font-mono">{worldData.status?.arch || 'unknown'}</span>
                  </div>

                  <div className="detail-card">
                    <span className="card-label">默认 Shell</span>
                    <span className="card-val font-mono">{worldData.status?.shell || 'pwsh / bash'}</span>
                  </div>

                  <div className="detail-card">
                    <span className="card-label">沙箱限制 (Sandbox)</span>
                    <span className="card-val font-mono">{worldData.status?.sandbox || 'workspace'}</span>
                  </div>

                  <div className="detail-card full-width">
                    <span className="card-label">当前工作区目录 (Workspace CWD)</span>
                    <span className="card-val font-mono">{worldData.workspace || 'N/A'}</span>
                  </div>

                  <div className="detail-card full-width">
                    <span className="card-label">可用工具链 (Installed Toolchains)</span>
                    <div className="tag-cloud">
                      {worldData.status?.commands_available &&
                      worldData.status.commands_available.length > 0 ? (
                        worldData.status.commands_available.map((cmd) => (
                          <span key={cmd} className="cmd-tag available font-mono">
                            ✓ {cmd}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted text-xs">未扫描到工具链</span>
                      )}
                    </div>
                  </div>

                  {worldData.context && (
                    <PromptContextCard
                      context={worldData.context}
                      status={worldData.status}
                      workspace={worldData.workspace}
                    />
                  )}
                </div>
              ) : (
                <div className="loading-placeholder font-mono">加载环境探测数据中...</div>
              )}
            </div>
          )}

          {activeTab === 'workspace_skills' && (
            <SkillPanel
              skills={availableSkills}
              groups={skillGroups}
              loading={skillsLoading}
              error={skillsError}
              onToggleGroup={onToggleSkillGroup}
              onInsertSkill={onInsertSkill}
            />
          )}

          {activeTab === 'workspace_tools' && (
            <div className="tab-pane">
              <BuiltinToolsCard
                availableBuiltinTools={availableBuiltinTools}
                selectedBuiltinTools={selectedBuiltinTools}
                onToggle={handleToggleBuiltinTool}
              />
            </div>
          )}

          {activeTab === 'goal' && (
            <div className="tab-pane goal-tab-pane">
              <GoalWorkflowCard
                goal={workflowState?.goal}
                goalObjectiveInput={goalObjectiveInput}
                onGoalObjectiveInputChange={setGoalObjectiveInput}
                onStartGoal={handleStartGoal}
                onPauseGoal={handlePauseGoal}
                onResumeGoal={handleResumeGoal}
                onUpdateGoal={handleUpdateGoal}
                onClearGoal={handleClearGoal}
              />

              <div className="workflow-files-section goal-files-section">
                <div className="section-title-bar">
                  <span>目标文件</span>
                  <span className="workflow-file-count font-mono">{workflowFiles.length} 个文件</span>
                  <button
                    type="button"
                    className="btn-action-small"
                    onClick={() => loadWorkflowFiles(null, isGoalArtifact)}
                    title="重新读取目标文件"
                  >
                    <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                    <span>刷新</span>
                  </button>
                </div>

                <div className="files-list goal-files-list custom-scrollbar" aria-label="目标文件列表">
                  {workflowFiles.length > 0 ? (
                    workflowFiles.map((file) => (
                      <button
                        type="button"
                        key={file.path}
                        className={`file-item ${selectedFile === file.path ? 'active' : ''}`}
                        onClick={() => handleSelectFile(file.path)}
                      >
                        <span className="file-name font-mono">{file.path}</span>
                        <span className="file-size font-mono">{file.size} B</span>
                      </button>
                    ))
                  ) : (
                    <div className="no-files font-mono">未发现目标文件</div>
                  )}
                </div>

                <div className="file-content-viewer goal-file-content custom-scrollbar">
                  <WorkflowFileContent
                    path={selectedFile}
                    content={selectedFileContent}
                    emptyMessage={workflowFiles.length > 0 ? '正在读取目标文件...' : '暂无目标文件'}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notebook' && (
            <NotebookPane threadId={threadId} projectId={projectId} onToast={onToast} />
          )}

          {/* TAB 3: MCP Status */}
          {activeTab === 'workspace_mcp' && (
            <div className="tab-pane">
              <div className="pane-section-header">
                <span className="section-title">
                  <Layers size={14} className="text-purple" />
                  已注册 MCP 扩展服务
                </span>
                <button
                  className="btn-action-small"
                  onClick={handleRetryMcp}
                  disabled={isRetryingMcp}
                  title="重新连接所有 MCP 服务"
                >
                  <RotateCcw size={12} className={isRetryingMcp ? 'animate-spin' : ''} />
                  <span>{isRetryingMcp ? '重连中...' : '重试连接'}</span>
                </button>
              </div>

              {mcpData ? (
                <div className="world-details-grid">
                  <div className="detail-card">
                    <span className="card-label">已启用 MCP 服务</span>
                    <span className="card-val font-mono">{mcpData.enabled_servers?.length || 0} 个</span>
                  </div>

                  <div className="detail-card">
                    <span className="card-label">MCP 工具总数</span>
                    <span className="card-val font-mono">{mcpData.tool_count || 0} 个工具</span>
                  </div>

                  <div className="detail-card full-width">
                    <span className="card-label">活动服务列表</span>
                    <div className="tag-cloud">
                      {mcpData.enabled_servers && mcpData.enabled_servers.length > 0 ? (
                        mcpData.enabled_servers.map((s) => (
                          <span key={s} className="cmd-tag available font-mono">
                            ✓ {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted text-xs">无活动的 MCP 服务</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="loading-placeholder font-mono">加载 MCP 数据中...</div>
              )}
            </div>
          )}

          {/* TAB 4: Git & Changes */}
          {activeTab === 'workspace_git' && (
            <div className="tab-pane">
              <div className="pane-section-header">
                <span className="section-title">
                  <GitBranch size={14} className="text-green" />
                  Git 工作区版本与变更
                </span>
                <button
                  className="btn-action-small"
                  onClick={loadGit}
                  title="刷新 Git 变更状态"
                >
                  <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                  <span>刷新状态</span>
                </button>
              </div>

              {gitData ? (
                <div className="git-details-box">
                  <div className="git-branch-banner font-mono">
                    <span>当前分支: <strong>{gitData.branch}</strong></span>
                    <span className={`status-pill ${gitData.dirty ? 'dirty' : 'clean'}`}>
                      {gitData.dirty ? `未提交 (${gitData.total_changes})` : '工作区整洁'}
                    </span>
                  </div>

                  <div className="git-file-list-card">
                    <span className="list-title">已修改文件 (Modified)</span>
                    <div className="git-files-list font-mono custom-scrollbar">
                      {gitData.modified && gitData.modified.length > 0 ? (
                        gitData.modified.map((f, i) => (
                          <div key={i} className="git-file-line">
                            <span className="git-dot mod">M</span>
                            <span className="git-path">{f}</span>
                          </div>
                        ))
                      ) : (
                        <span className="text-muted text-xs">无已修改文件</span>
                      )}
                    </div>
                  </div>

                  <div className="git-file-list-card">
                    <span className="list-title">未跟踪文件 (Untracked)</span>
                    <div className="git-files-list font-mono custom-scrollbar">
                      {gitData.untracked && gitData.untracked.length > 0 ? (
                        gitData.untracked.map((f, i) => (
                          <div key={i} className="git-file-line">
                            <span className="git-dot untr">?</span>
                            <span className="git-path">{f}</span>
                          </div>
                        ))
                      ) : (
                        <span className="text-muted text-xs">无未跟踪文件</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="loading-placeholder font-mono">加载 Git 数据中...</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
