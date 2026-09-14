import React, { useState, useEffect, useRef } from 'react';
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
  History,
} from 'lucide-react';
import { api } from '../api';
import { readStateRevision, shouldApplyStateRevision } from '../utils/revisionState';
import StatusDetailsPane from './StatusDetailsPane';
import ThreadHistoryPane from './ThreadHistoryPane';
import './SidePanel.css';

const BUILTIN_TOOL_INFO = {
  read_file: { name: 'read_file', label: '读取文件', desc: '只读检查工作区文件与代码' },
  apply_patch: { name: 'apply_patch', label: '应用补丁', desc: '原子化添加、修改、移动或删除文件' },
  shell: { name: 'shell', label: '终端命令', desc: '执行命令行检查与自动化测试' },
  web_fetch: { name: 'web_fetch', label: '网页抓取', desc: '抓取外部 HTTP 与静态文档' },
  read_image: { name: 'read_image', label: '图像读取', desc: '读取并解析视觉/图像资源' },
};

function normalizePanelTab(tab) {
  if (tab === 'world' || tab === 'workspace') return 'workspace_world';
  if (tab === 'mcp') return 'workspace_mcp';
  if (tab === 'git') return 'workspace_git';
  if (tab === 'history' || tab === 'thread_history') return 'thread_history';
  return tab || 'status';
}

export default function SidePanel({
  isOpen,
  initialTab = 'world',
  onClose,
  planActive,
  onTogglePlan,
  goalState,
  status = null,
  threadId = 'default',
  projectId = null,
  onGoalChanged,
  onToast,
  messages = [],
  onAdjustPrompt,
  historyFocusMessageId = null,
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
  ]);
  const [availableBuiltinTools, setAvailableBuiltinTools] = useState([
    'read_file',
    'apply_patch',
    'shell',
    'web_fetch',
    'read_image',
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
      } else if (activeTab === 'plan_goal') {
        await Promise.all([
          loadWorkflow(requestContext),
          loadWorkflowFiles(requestContext),
        ]);
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

  const loadWorkflowFiles = async (context = null) => {
    const requestContext = context || beginRequest();
    try {
      const res = await api.getWorkflowFiles(threadId, {
        projectId,
        signal: requestContext.signal,
      });
      if (!isCurrentRequest(requestContext)) return;
      const files = res.files || [];
      setWorkflowFiles(files);
      if (
        files.length > 0
        && (
          !selectedFileRef.current
          || !files.some((file) => file.path === selectedFileRef.current)
        )
      ) {
        handleSelectFile(files[0].path, requestContext);
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

  const isGoalRunning = Boolean(workflowState?.goal);

  if (!isOpen) return null;

  return (
    <div className="sidepanel-overlay" onClick={onClose}>
      <div
        className="sidepanel-container"
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
              className={`panel-tab-btn ${activeTab === 'plan_goal' ? 'active' : ''}`}
              onClick={() => setActiveTab('plan_goal')}
            >
              <Target size={14} />
              <span>计划与目标</span>
            </button>

            <button
              className={`panel-tab-btn ${activeTab === 'thread_history' ? 'active' : ''}`}
              onClick={() => setActiveTab('thread_history')}
            >
              <History size={14} />
              <span>输入历史</span>
            </button>

          </div>

          <button className="panel-close-btn" onClick={onClose} aria-label="关闭详情抽屉">
            <X size={15} />
          </button>
        </div>

        {/* Panel Content Body */}
        <div className="sidepanel-content custom-scrollbar">
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
            </div>
          )}

          {activeTab === 'status' && (
            <StatusDetailsPane status={status} />
          )}

          {activeTab === 'thread_history' && (
            <ThreadHistoryPane
              messages={messages}
              threadId={threadId}
              projectId={projectId}
              focusMessageId={historyFocusMessageId}
              onAdjustPrompt={onAdjustPrompt}
            />
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
                    <div className="detail-card full-width">
                      <span className="card-label">系统注入上下文 (Prompt Injection Context)</span>
                      <div className="xml-preview font-mono custom-scrollbar">
                        {worldData.context}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="loading-placeholder font-mono">加载环境探测数据中...</div>
              )}
            </div>
          )}

          {/* TAB 2: Plan & Goal Workflows */}
          {activeTab === 'plan_goal' && (
            <div className="tab-pane">
              {/* Plan Mode Control */}
              <div className="workflow-card">
                <div className="workflow-card-header">
                  <div className="workflow-title-wrap">
                    <Compass size={15} className="text-amber" />
                    <div>
                      <span className="workflow-title">规划模式 (Plan Mode)</span>
                      <p className="workflow-sub">
                        源码与项目文件保持只读；Shell 按当前审批策略执行，plan.md 可持续更新
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
                <div className={`plan-mode-state ${planActive ? 'active' : 'inactive'}`} role="status">
                  <span className="plan-mode-state-dot" aria-hidden="true" />
                  <div>
                    <strong>{planActive ? 'Plan Mode 已开启' : 'Plan Mode 已关闭'}</strong>
                    <span>
                      {planActive
                        ? '本轮规划完成后可确认“开始实施”，系统会自动关闭 Plan Mode。'
                        : '开启后先进行只读规划，确认实施时再切回默认模式。'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Builtin Tools Selection */}
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
                      <div
                        key={toolName}
                        className={`builtin-tool-chip ${isChecked ? 'active' : 'inactive'}`}
                        onClick={() => handleToggleBuiltinTool(toolName)}
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
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Goal Workflow */}
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
                      <span>Thread: <strong>{workflowState.goal.thread_id}</strong></span>
                      <span className={`goal-badge ${workflowState.goal.status}`}>
                        {workflowState.goal.status}
                      </span>
                    </div>
                    <div className="goal-objective">{workflowState.goal.objective}</div>
                     <div className="milestone-text font-mono">
                       Milestone: {workflowState.goal.current_milestone || 0} / {workflowState.goal.total_milestones || 0}
                       {' · '}Loops: {workflowState.goal.loop_count || 0}
                       {' · '}
                       Tokens: {workflowState.goal.tokens_used} / {workflowState.goal.token_budget ?? '∞'}
                       {' · '}Time: {workflowState.goal.time_used_seconds}s
                     </div>
                     <div className={`goal-verification-status ${workflowState.goal.verification_status || 'idle'}`}>
                       <strong>Verify</strong>
                       <span>{workflowState.goal.verification_status || 'idle'}</span>
                     </div>
                     {workflowState.goal.last_error && (
                       <div className="goal-error-detail" title={workflowState.goal.last_error}>
                         {workflowState.goal.last_error}
                       </div>
                     )}
                    <div className="goal-actions">
                      {workflowState.goal.status === 'paused' ? (
                        <button className="btn-action-small" onClick={handleResumeGoal}>
                          <Play size={12} />
                          <span>恢复</span>
                        </button>
                      ) : workflowState.goal.status === 'active' ? (
                        <button className="btn-action-small" onClick={handlePauseGoal}>
                          <Pause size={12} />
                          <span>暂停</span>
                        </button>
                      ) : null}
                      <button className="btn-action-small" onClick={handleUpdateGoal}>
                        <FileText size={12} />
                        <span>更新</span>
                      </button>
                      <button className="btn-action-small" onClick={handleClearGoal}>
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
                      onChange={(e) => setGoalObjectiveInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleStartGoal()}
                    />
                    <button className="btn-start-goal" onClick={handleStartGoal}>
                      <Play size={12} />
                      <span>设置目标</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Workflow & Plan Artifact Files */}
              <div className="workflow-files-section">
                <div className="section-title-bar">
                  <FileText size={13} />
                  <span>工作区规划与配套文件 (Plan & Goal Artifacts)</span>
                </div>

                <div className="files-layout">
                  <div className="files-list custom-scrollbar">
                    {workflowFiles.length > 0 ? (
                      workflowFiles.map((file) => (
                        <div
                          key={file.path}
                          className={`file-item ${selectedFile === file.path ? 'active' : ''}`}
                          onClick={() => handleSelectFile(file.path)}
                        >
                          <span className="file-name font-mono">{file.path}</span>
                          <span className="file-size font-mono">{file.size} B</span>
                        </div>
                      ))
                    ) : (
                      <div className="no-files font-mono">未发现 plan.md 等规划文件</div>
                    )}
                  </div>

                  <div className="file-content-viewer font-mono custom-scrollbar">
                    {selectedFileContent ? (
                      <pre>{selectedFileContent}</pre>
                    ) : (
                      <div className="no-content">请选择左侧文件以查看内容</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
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
