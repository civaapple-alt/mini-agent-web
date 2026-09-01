import React, { useState, useEffect } from 'react';
import {
  X,
  Cpu,
  Compass,
  Target,
  FileCode,
  GitBranch,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Play,
  Pause,
  ExternalLink,
  ChevronRight,
  Shield,
  Layers,
  Terminal,
} from 'lucide-react';
import { api } from '../api';
import './SidePanel.css';

export default function SidePanel({
  isOpen,
  initialTab = 'world',
  onClose,
  planActive,
  onTogglePlan,
}) {
  const [activeTab, setActiveTab] = useState(initialTab); // 'world' | 'plan_goal' | 'mcp' | 'git'

  // Tab 1: World state
  const [worldData, setWorldData] = useState(null);
  const [isLoadingWorld, setIsLoadingWorld] = useState(false);

  // Tab 2: Plan & Goal files & workflow
  const [workflowState, setWorkflowState] = useState(null);
  const [workflowFiles, setWorkflowFiles] = useState([]);
  const [selectedFileContent, setSelectedFileContent] = useState(null);
  const [selectedFilePath, setSelectedFilePath] = useState(null);
  const [goalObjectiveInput, setGoalObjectiveInput] = useState('');

  // Tab 3: MCP status
  const [mcpData, setMcpData] = useState(null);
  const [isRetryingMcp, setIsRetryingMcp] = useState(false);

  // Tab 4: Git status
  const [gitData, setGitData] = useState(null);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (isOpen) {
      loadAllData();
    }
  }, [isOpen]);

  const loadAllData = async () => {
    loadWorld();
    loadWorkflow();
    loadMcp();
    loadGit();
  };

  const loadWorld = async () => {
    setIsLoadingWorld(true);
    try {
      const data = await api.getWorldState();
      setWorldData(data);
    } catch (err) {
      console.error('Failed to load world state:', err);
    } finally {
      setIsLoadingWorld(false);
    }
  };

  const loadWorkflow = async () => {
    try {
      const [wf, filesRes] = await Promise.all([
        api.getWorkflowState(),
        api.getWorkflowFiles(),
      ]);
      setWorkflowState(wf);
      setWorkflowFiles(filesRes.files || []);

      // Auto load first plan file if available
      if (filesRes.files && filesRes.files.length > 0 && !selectedFilePath) {
        handleReadFile(filesRes.files[0].path);
      }
    } catch (err) {
      console.error('Failed to load workflow state:', err);
    }
  };

  const handleReadFile = async (path) => {
    setSelectedFilePath(path);
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
      await api.startGoal(goalObjectiveInput.trim());
      setGoalObjectiveInput('');
      loadWorkflow();
    } catch (err) {
      alert(`启动 Goal 失败: ${err.message}`);
    }
  };

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
              <span>Git 与变更</span>
            </button>
          </div>

          <button className="panel-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Content Area */}
        <div className="sidepanel-content custom-scrollbar">
          {/* TAB 1: WorldState */}
          {activeTab === 'world' && (
            <div className="tab-pane">
              <div className="pane-section-header">
                <div className="section-title">
                  <Shield size={14} className="text-sky" />
                  <span>环境治理与沙箱策略 (World Governance)</span>
                </div>
                <button
                  className="btn-action-small"
                  onClick={async () => {
                    await api.refreshWorld();
                    loadWorld();
                  }}
                  disabled={isLoadingWorld}
                >
                  <RefreshCw size={12} className={isLoadingWorld ? 'animate-spin' : ''} />
                  <span>重新探测</span>
                </button>
              </div>

              {worldData ? (
                <div className="world-details-grid">
                  <div className="detail-card">
                    <span className="card-label">工作区目录 (Workspace Root)</span>
                    <span className="card-val font-mono">{worldData.workspace || 'D:\\gh-ws\\codex-ws\\mini-agent-web'}</span>
                  </div>

                  <div className="detail-card">
                    <span className="card-label">执行模式与沙箱 (Execution & Sandbox)</span>
                    <span className="card-val font-mono">native / per_action approval</span>
                  </div>

                  <div className="detail-card full-width">
                    <span className="card-label">可用系统工具链 (Available Commands)</span>
                    <div className="tag-cloud font-mono">
                      {['git', 'rg', 'fd', 'curl', 'cargo', 'rustc', 'python', 'uv', 'node', 'npm', 'docker'].map((cmd) => (
                        <span key={cmd} className="cmd-tag available">
                          <CheckCircle2 size={10} /> {cmd}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="detail-card full-width">
                    <span className="card-label">环境提示词上下文 (Injected Prompt Snippet)</span>
                    <pre className="xml-preview font-mono">{worldData.context || '<world_state>...</world_state>'}</pre>
                  </div>
                </div>
              ) : (
                <div className="loading-placeholder">正在加载环境状态...</div>
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
                      <p className="workflow-sub">启用后 Agent 进入深度只读探索模式，生成严密的设计与实施计划</p>
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

              {/* Goal Workflow */}
              <div className="workflow-card">
                <div className="workflow-card-header">
                  <div className="workflow-title-wrap">
                    <Target size={15} className="text-green" />
                    <div>
                      <span className="workflow-title">目标收敛模式 (Goal Milestones)</span>
                      <p className="workflow-sub">多里程碑自动驱动收敛，直到达成目标任务</p>
                    </div>
                  </div>
                </div>

                {workflowState?.goal ? (
                  <div className="goal-status-box">
                    <div className="goal-meta-row font-mono">
                      <span>Goal ID: <strong>{workflowState.goal.goal_id}</strong></span>
                      <span className={`goal-badge ${workflowState.goal.status}`}>
                        {workflowState.goal.status}
                      </span>
                    </div>
                    <div className="milestone-progress-bar">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${(workflowState.goal.current_milestone / (workflowState.goal.total_milestones || 1)) * 100}%`,
                        }}
                      ></div>
                    </div>
                    <div className="milestone-text font-mono">
                      里程碑: {workflowState.goal.current_milestone} / {workflowState.goal.total_milestones} (循环: {workflowState.goal.loop_count}/{workflowState.goal.max_loops})
                    </div>
                  </div>
                ) : (
                  <div className="goal-input-box">
                    <input
                      type="text"
                      className="goal-input font-mono"
                      placeholder="输入宏观目标，例如: 完成前端全组件高保真重构与测试"
                      value={goalObjectiveInput}
                      onChange={(e) => setGoalObjectiveInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleStartGoal()}
                    />
                    <button className="btn-start-goal" onClick={handleStartGoal}>
                      <Play size={12} />
                      <span>启动目标</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Discovered Plan & Workflow Files */}
              <div className="workflow-files-section">
                <div className="section-title-bar">
                  <FileCode size={14} className="text-sky" />
                  <span>工作区规划配套文件 (Workflow Artifacts)</span>
                </div>

                <div className="files-layout">
                  <div className="files-list font-mono">
                    {workflowFiles.map((file) => (
                      <div
                        key={file.path}
                        className={`file-item ${selectedFilePath === file.path ? 'active' : ''}`}
                        onClick={() => handleReadFile(file.path)}
                      >
                        <ChevronRight size={12} />
                        <span className="file-name">{file.path}</span>
                        <span className="file-size">{(file.size / 1024).toFixed(1)}k</span>
                      </div>
                    ))}
                    {workflowFiles.length === 0 && (
                      <div className="no-files">未探测到 plan.md / goal 配套文件</div>
                    )}
                  </div>

                  <div className="file-content-viewer font-mono custom-scrollbar">
                    {selectedFileContent ? (
                      <pre>{selectedFileContent}</pre>
                    ) : (
                      <div className="no-content">点击左侧文件查看实时 Markdown 内容</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MCP Servers */}
          {activeTab === 'mcp' && (
            <div className="tab-pane">
              <div className="pane-section-header">
                <div className="section-title">
                  <Layers size={14} className="text-purple" />
                  <span>已连接的 MCP 服务器与工具</span>
                </div>
                <button
                  className="btn-action-small"
                  onClick={handleRetryMcp}
                  disabled={isRetryingMcp}
                >
                  <RefreshCw size={12} className={isRetryingMcp ? 'animate-spin' : ''} />
                  <span>重新连接</span>
                </button>
              </div>

              {mcpData ? (
                <div className="mcp-grid">
                  <div className="detail-card">
                    <span className="card-label">已启用 MCP 服务 (Enabled Servers)</span>
                    <div className="mcp-tags font-mono">
                      {(mcpData.enabled_servers || []).length > 0 ? (
                        mcpData.enabled_servers.map((s) => (
                          <span key={s} className="cmd-tag available">
                            <CheckCircle2 size={10} /> {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted text-xs">暂无外部 MCP 注册</span>
                      )}
                    </div>
                  </div>

                  <div className="detail-card">
                    <span className="card-label">总可用工具数量 (Registered Tools)</span>
                    <span className="card-val font-mono font-bold text-sky">
                      {mcpData.tool_count || 12} 个工具已就绪
                    </span>
                  </div>
                </div>
              ) : (
                <div className="loading-placeholder">正在加载 MCP 状态...</div>
              )}
            </div>
          )}

          {/* TAB 4: Git & Files */}
          {activeTab === 'git' && (
            <div className="tab-pane">
              <div className="pane-section-header">
                <div className="section-title">
                  <GitBranch size={14} className="text-emerald" />
                  <span>Git 工作区状态 (Git Status)</span>
                </div>
                <button className="btn-action-small" onClick={loadGit}>
                  <RefreshCw size={12} />
                  <span>刷新</span>
                </button>
              </div>

              {gitData ? (
                <div className="git-details-box">
                  <div className="git-branch-banner font-mono">
                    <span>当前分支: <strong>{gitData.branch}</strong></span>
                    <span className={`badge ${gitData.dirty ? 'running' : 'completed'}`}>
                      {gitData.dirty ? `${gitData.total_changes} 处变更` : '工作区整洁'}
                    </span>
                  </div>

                  {gitData.modified && gitData.modified.length > 0 && (
                    <div className="git-file-list-card">
                      <span className="list-title">已修改/未提交文件</span>
                      <div className="git-files-list font-mono">
                        {gitData.modified.map((f) => (
                          <div key={f} className="git-file-line modified">
                            <span className="git-dot mod">M</span>
                            <span>{f}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {gitData.untracked && gitData.untracked.length > 0 && (
                    <div className="git-file-list-card">
                      <span className="list-title">未跟踪文件 (Untracked)</span>
                      <div className="git-files-list font-mono">
                        {gitData.untracked.map((f) => (
                          <div key={f} className="git-file-line untracked">
                            <span className="git-dot untr">?</span>
                            <span>{f}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="loading-placeholder">正在探测 Git 状态...</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
