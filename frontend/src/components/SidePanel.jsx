import React, { useState, useEffect } from 'react';
import {
  X,
  RefreshCw,
  Cpu,
  Target,
  Layers,
  GitBranch,
  FileCode,
  CheckCircle,
  AlertTriangle,
  Play,
  Pause,
  Compass,
  FileText,
  Terminal,
  Folder,
  RotateCcw,
  Wrench,
} from 'lucide-react';
import { api } from '../api';
import './SidePanel.css';

const BUILTIN_TOOL_INFO = {
  read_file: { name: 'read_file', label: '读取文件', desc: '只读检查工作区文件与代码' },
  apply_patch: { name: 'apply_patch', label: '应用补丁', desc: '原子化添加、修改、移动或删除文件' },
  shell: { name: 'shell', label: '终端命令', desc: '执行命令行检查与自动化测试' },
  web_fetch: { name: 'web_fetch', label: '网页抓取', desc: '抓取外部 HTTP 与静态文档' },
  read_image: { name: 'read_image', label: '图像读取', desc: '读取并解析视觉/图像资源' },
};

export default function SidePanel({
  isOpen,
  initialTab = 'world',
  onClose,
  planActive,
  onTogglePlan,
  goalState,
  onToast,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
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

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

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
    if (isOpen) {
      loadAllData();
    }
  }, [isOpen, activeTab]);

  const loadAllData = async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'world') {
        await loadWorld();
      } else if (activeTab === 'plan_goal') {
        await Promise.all([loadWorkflow(), loadWorkflowFiles()]);
      } else if (activeTab === 'mcp') {
        await loadMcp();
      } else if (activeTab === 'git') {
        await loadGit();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const loadWorld = async () => {
    try {
      const data = await api.getWorldState();
      setWorldData(data);
    } catch (err) {
      console.error('Failed to load world state:', err);
    }
  };

  const handleRefreshWorld = async () => {
    try {
      await api.refreshWorld();
      await loadWorld();
    } catch (err) {
      alert(`刷新环境探测失败: ${err.message}`);
    }
  };

  const loadWorkflow = async () => {
    try {
      const data = await api.getWorkflowState();
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
      console.error('Failed to load workflow state:', err);
    }
  };

  const handleToggleBuiltinTool = async (toolName) => {
    const nextTools = selectedBuiltinTools.includes(toolName)
      ? selectedBuiltinTools.filter((t) => t !== toolName)
      : [...selectedBuiltinTools, toolName];

    setSelectedBuiltinTools(nextTools);
    try {
      await api.updateThreadSettings(planActive ? 'plan' : 'default', nextTools);
      if (onToast) {
        onToast(
          nextTools.includes(toolName)
            ? `已启用内置工具: ${toolName}`
            : `已限制内置工具: ${toolName}`,
          'info'
        );
      }
    } catch (err) {
      console.error('Failed to update builtin tool settings:', err);
      if (onToast) {
        onToast(`更新内置工具配置失败: ${err.message}`, 'error');
      }
      setSelectedBuiltinTools(selectedBuiltinTools);
    }
  };

  const loadWorkflowFiles = async () => {
    try {
      const res = await api.getWorkflowFiles();
      const files = res.files || [];
      setWorkflowFiles(files);
      if (files.length > 0 && !selectedFile) {
        handleSelectFile(files[0].path);
      }
    } catch (err) {
      console.error('Failed to load workflow files:', err);
    }
  };

  const handleSelectFile = async (path) => {
    setSelectedFile(path);
    try {
      const res = await api.getWorkflowFileContent(path);
      setSelectedFileContent(res.content);
    } catch (err) {
      setSelectedFileContent(`// 读取文件失败: ${err.message}`);
    }
  };

  const loadMcp = async () => {
    try {
      const data = await api.getMcpStatus();
      setMcpData(data);
    } catch (err) {
      console.error('Failed to load MCP status:', err);
    }
  };

  const handleRetryMcp = async () => {
    setIsRetryingMcp(true);
    try {
      const data = await api.retryMcp();
      setMcpData(data);
    } catch (err) {
      console.error('Failed to retry MCP:', err);
    } finally {
      setIsRetryingMcp(false);
    }
  };

  const loadGit = async () => {
    try {
      const data = await api.getGitStatus();
      setGitData(data);
    } catch (err) {
      console.error('Failed to load git status:', err);
    }
  };

  const handleStartGoal = async () => {
    if (!goalObjectiveInput.trim()) return;
    try {
      await api.setGoal(goalObjectiveInput.trim());
      setGoalObjectiveInput('');
      await loadWorkflow();
      if (onToast) {
        onToast('已设置 Thread Goal，运行时将自动推进', 'success');
      }
    } catch (err) {
      if (onToast) {
        onToast(`设置 Goal 失败: ${err.message}`, 'error');
      }
    }
  };

  const handleClearGoal = async () => {
    try {
      await api.clearGoal();
      setWorkflowState((current) => ({ ...(current || {}), goal: null }));
      if (onToast) onToast('已清除 Thread Goal', 'success');
    } catch (err) {
      if (onToast) onToast(`清除 Goal 失败: ${err.message}`, 'error');
    }
  };

  const isGoalRunning = Boolean(
    workflowState?.goal &&
      ['active', 'paused', 'blocked'].includes(workflowState.goal.status)
  );

  if (!isOpen) return null;

  return (
    <div className="sidepanel-overlay" onClick={onClose}>
      <div className="sidepanel-container" onClick={(e) => e.stopPropagation()}>
        {/* Header with Tabs */}
        <div className="sidepanel-header">
          <div className="sidepanel-tabs">
            <button
              className={`panel-tab-btn ${activeTab === 'world' ? 'active' : ''}`}
              onClick={() => setActiveTab('world')}
            >
              <Cpu size={14} />
              <span>环境状态 (World)</span>
            </button>

            <button
              className={`panel-tab-btn ${activeTab === 'plan_goal' ? 'active' : ''}`}
              onClick={() => setActiveTab('plan_goal')}
            >
              <Target size={14} />
              <span>规划与目标 (Plan/Goal)</span>
            </button>

            <button
              className={`panel-tab-btn ${activeTab === 'mcp' ? 'active' : ''}`}
              onClick={() => setActiveTab('mcp')}
            >
              <Layers size={14} />
              <span>MCP 扩展</span>
            </button>

            <button
              className={`panel-tab-btn ${activeTab === 'git' ? 'active' : ''}`}
              onClick={() => setActiveTab('git')}
            >
              <GitBranch size={14} />
              <span>文件与 Git</span>
            </button>
          </div>

          <button className="panel-close-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {/* Panel Content Body */}
        <div className="sidepanel-content custom-scrollbar">
          {/* TAB 1: WorldState */}
          {activeTab === 'world' && (
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
                      <span className="workflow-title">只读规划模式 (Plan Mode)</span>
                      <p className="workflow-sub">
                        启用后 Agent 处于只读探索状态，在对话流中输出严密的架构与实施计划，禁止写文件
                      </p>
                    </div>
                  </div>
                  <button
                    className={`btn-toggle-switch ${planActive ? 'on' : 'off'}`}
                    onClick={onTogglePlan}
                  >
                    <span>{planActive ? '已开启' : '已关闭'}</span>
                  </button>
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
                      Tokens: {workflowState.goal.tokens_used} / {workflowState.goal.token_budget ?? '∞'}
                      {' · '}Time: {workflowState.goal.time_used_seconds}s
                    </div>
                    <button className="btn-action-small" onClick={handleClearGoal}>
                      <RotateCcw size={12} />
                      <span>清除目标</span>
                    </button>
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
          {activeTab === 'mcp' && (
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
          {activeTab === 'git' && (
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
