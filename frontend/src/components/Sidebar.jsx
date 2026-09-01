import React, { useState, useEffect, useMemo } from 'react';
import {
  SquarePen,
  Plus,
  GitPullRequest,
  Clock,
  Puzzle,
  MoreHorizontal,
  Folder,
  FolderOpen,
  FolderPlus,
  Search,
  Bell,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Edit2,
  FileText,
  GitFork,
  Trash2,
  MoreVertical,
  Circle,
  Loader2,
} from 'lucide-react';
import { api } from '../api';
import './Sidebar.css';

export default function Sidebar({
  threads,
  currentThread,
  isGenerating,
  onSelectThread,
  onNewThread,
  onForkThread,
  onCloseThread,
  onRenameThread,
  onUpdateSummary,
  onRefreshThreads,
  onOpenSidePanel,
  onOpenSettings,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchBox, setShowSearchBox] = useState(false);
  const [activeMenuThread, setActiveMenuThread] = useState(null);

  // Projects State
  const [projectsData, setProjectsData] = useState(null);
  const [expandedProjects, setExpandedProjects] = useState({});
  const [expandedThreadLists, setExpandedThreadLists] = useState({});
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [showRecentSection, setShowRecentSection] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const data = await api.listProjects();
      setProjectsData(data);
      const curName = data?.current_project?.name;
      if (curName) {
        setExpandedProjects((prev) => ({ ...prev, [curName]: true }));
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  const handleCreateProject = async (e) => {
    if (e) e.preventDefault();
    if (!newProjectName.trim()) return;
    setIsCreatingProject(true);
    try {
      await api.createProject(newProjectName.trim(), newProjectPath.trim() || null, true);
      setNewProjectName('');
      setNewProjectPath('');
      setShowNewProjectModal(false);
      await loadProjects();
      if (onRefreshThreads) onRefreshThreads();
    } catch (err) {
      alert(`创建项目失败: ${err.message}`);
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleSwitchProject = async (path, projName) => {
    try {
      await api.switchProject(path);
      setExpandedProjects((prev) => ({ ...prev, [projName]: true }));
      await loadProjects();
      if (onRefreshThreads) onRefreshThreads();
    } catch (err) {
      alert(`切换项目失败: ${err.message}`);
    }
  };

  const toggleProjectExpand = (projName, path) => {
    setExpandedProjects((prev) => {
      const nextState = !prev[projName];
      if (nextState && path && path !== projectsData?.current_project?.path) {
        handleSwitchProject(path, projName);
      }
      return { ...prev, [projName]: nextState };
    });
  };

  const toggleThreadListExpand = (projName) => {
    setExpandedThreadLists((prev) => ({
      ...prev,
      [projName]: !prev[projName],
    }));
  };

  // Group threads by project name
  const currentProjectName = projectsData?.current_project?.name || 'mini-agent-web';

  const normalizedThreads = useMemo(() => {
    return threads.map((t) => {
      if (typeof t === 'string') {
        return {
          thread_id: t,
          title: t === 'default' ? '默认会话' : t,
          project: currentProjectName,
          summary: '',
          updated_at: new Date().toISOString(),
        };
      }
      return {
        thread_id: t.thread_id,
        title: t.title || t.thread_id,
        project: t.project || currentProjectName,
        summary: t.summary || '',
        updated_at: t.updated_at || new Date().toISOString(),
      };
    });
  }, [threads, currentProjectName]);

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return normalizedThreads;
    const q = searchQuery.toLowerCase();
    return normalizedThreads.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.thread_id.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q)
    );
  }, [normalizedThreads, searchQuery]);

  // Combined unique projects list
  const allProjects = useMemo(() => {
    const list = [...(projectsData?.recent_projects || [])];
    if (
      projectsData?.current_project &&
      !list.some((p) => p.path === projectsData.current_project.path)
    ) {
      list.unshift(projectsData.current_project);
    }
    // Also include other mock/discovered projects if any
    const knownNames = ['mini-codex', 'codex-re', 'pi-cordis-dsh', 'orange', 'qi'];
    for (const name of knownNames) {
      if (!list.some((p) => p.name === name)) {
        list.push({
          name,
          path: name,
          is_git: true,
        });
      }
    }
    return list;
  }, [projectsData]);

  const displayedProjects = showAllProjects ? allProjects : allProjects.slice(0, 5);

  const handleAction = (e, action, thread) => {
    e.stopPropagation();
    setActiveMenuThread(null);

    if (action === 'fork') {
      onForkThread(thread.thread_id);
    } else if (action === 'close') {
      if (confirm(`确认关闭并归档会话 "${thread.title}" 吗？`)) {
        onCloseThread(thread.thread_id);
      }
    } else if (action === 'rename') {
      const newTitle = prompt('重命名会话:', thread.title);
      if (newTitle && newTitle.trim()) {
        onRenameThread(thread.thread_id, newTitle.trim());
      }
    } else if (action === 'summary') {
      const newSum = prompt('设置阶段摘要:', thread.summary);
      if (newSum !== null) {
        onUpdateSummary(thread.thread_id, newSum.trim());
      }
    }
  };

  return (
    <aside className="codex-sidebar">
      {/* 1. Header: Codex ⌵ | Search | Notifications */}
      <div className="sidebar-top-bar">
        <div
          className="codex-brand-dropdown"
          onClick={() => onOpenSettings && onOpenSettings()}
          title="系统与模型设置"
        >
          <span className="brand-name">Codex</span>
          <ChevronDown size={14} className="brand-chevron" />
        </div>

        <div className="top-bar-icons">
          <button
            className={`top-icon-btn ${showSearchBox ? 'active' : ''}`}
            onClick={() => setShowSearchBox(!showSearchBox)}
            title="搜索会话"
          >
            <Search size={15} />
          </button>

          <button
            className="top-icon-btn"
            onClick={() => onOpenSidePanel && onOpenSidePanel('world')}
            title="控制台通知与环境状态"
          >
            <Bell size={15} />
          </button>
        </div>
      </div>

      {/* Search Bar Input (Toggleable) */}
      {showSearchBox && (
        <div className="sidebar-search-container">
          <Search size={13} className="search-box-icon" />
          <input
            type="text"
            className="sidebar-search-input"
            placeholder="搜索会话..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          {searchQuery && (
            <button className="search-clear-btn" onClick={() => setSearchQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* 2. Top Navigation Items List */}
      <div className="sidebar-nav-actions">
        {/* 新对话 */}
        <div
          className="nav-action-row primary-new-chat"
          onClick={onNewThread}
          title="开始新对话"
        >
          <div className="nav-row-left">
            <SquarePen size={15} className="nav-row-icon" />
            <span className="nav-row-label">新对话</span>
          </div>
          <button
            className="btn-plus-shortcut"
            onClick={(e) => {
              e.stopPropagation();
              onNewThread();
            }}
            title="新建对话"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Pull Request */}
        <div
          className="nav-action-row"
          onClick={() => onOpenSidePanel && onOpenSidePanel('git')}
          title="查看 Git 变更与 Pull Request"
        >
          <div className="nav-row-left">
            <GitPullRequest size={15} className="nav-row-icon" />
            <span className="nav-row-label">Pull Request</span>
          </div>
        </div>

        {/* 已安排 (Goal / Milestones) */}
        <div
          className="nav-action-row"
          onClick={() => onOpenSidePanel && onOpenSidePanel('plan_goal')}
          title="目标规划与多里程碑调度"
        >
          <div className="nav-row-left">
            <Clock size={15} className="nav-row-icon" />
            <span className="nav-row-label">已安排</span>
          </div>
        </div>

        {/* 插件 (MCP) */}
        <div
          className="nav-action-row"
          onClick={() => onOpenSidePanel && onOpenSidePanel('mcp')}
          title="MCP 扩展与工具插件"
        >
          <div className="nav-row-left">
            <Puzzle size={15} className="nav-row-icon" />
            <span className="nav-row-label">插件</span>
          </div>
        </div>

        {/* 更多 */}
        <div
          className="nav-action-row"
          onClick={() => onOpenSettings && onOpenSettings()}
          title="系统与偏好设置"
        >
          <div className="nav-row-left">
            <MoreHorizontal size={15} className="nav-row-icon" />
            <span className="nav-row-label">更多</span>
          </div>
        </div>
      </div>

      {/* 3. Projects Section */}
      <div className="sidebar-projects-section custom-scrollbar">
        <div className="section-header-row">
          <span className="section-title-label">项目</span>
          <button
            className="btn-add-project-mini"
            onClick={() => setShowNewProjectModal(true)}
            title="新建项目工作区"
          >
            <Plus size={13} />
          </button>
        </div>

        <div className="project-tree-list">
          {displayedProjects.map((proj) => {
            const isExpanded = Boolean(expandedProjects[proj.name]);
            const isCurrentProj = proj.name === currentProjectName;
            const projThreads = filteredThreads.filter(
              (t) =>
                t.project === proj.name ||
                (isCurrentProj && (!t.project || t.project === currentProjectName))
            );
            const isListExpanded = Boolean(expandedThreadLists[proj.name]);
            const visibleThreads = isListExpanded
              ? projThreads
              : projThreads.slice(0, 5);

            return (
              <div key={proj.name} className="project-tree-item">
                {/* Project Folder Header */}
                <div
                  className={`project-folder-row ${isCurrentProj ? 'active-proj' : ''}`}
                  onClick={() => toggleProjectExpand(proj.name, proj.path)}
                  title={proj.path}
                >
                  <Folder size={14} className="folder-icon" />
                  <span className="folder-name">{proj.name}</span>
                </div>

                {/* Nested Threads under Project */}
                {isExpanded && (
                  <div className="project-nested-threads">
                    {visibleThreads.map((thread) => {
                      const isSelected = thread.thread_id === currentThread;
                      return (
                        <div
                          key={thread.thread_id}
                          className={`nested-thread-item ${isSelected ? 'selected' : ''}`}
                          onClick={() => onSelectThread(thread.thread_id)}
                          title={thread.title}
                        >
                          <span className="nested-thread-title">
                            {thread.title}
                          </span>

                          <div className="thread-tail-indicators">
                            {isSelected && (
                              <div className="selected-spinner-dot">
                                {isGenerating ? (
                                  <Loader2 size={11} className="animate-spin text-muted" />
                                ) : (
                                  <Circle size={10} className="active-circle" />
                                )}
                              </div>
                            )}

                            {/* Options Button on hover */}
                            <button
                              className="btn-thread-menu-trigger"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuThread(
                                  activeMenuThread === thread.thread_id
                                    ? null
                                    : thread.thread_id
                                );
                              }}
                              title="会话选项"
                            >
                              <MoreVertical size={12} />
                            </button>
                          </div>

                          {/* Popover Action Menu */}
                          {activeMenuThread === thread.thread_id && (
                            <div
                              className="thread-action-popover"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                className="popover-btn"
                                onClick={(e) => handleAction(e, 'rename', thread)}
                              >
                                <Edit2 size={12} />
                                <span>重命名</span>
                              </button>
                              <button
                                className="popover-btn"
                                onClick={(e) => handleAction(e, 'summary', thread)}
                              >
                                <FileText size={12} />
                                <span>指定摘要</span>
                              </button>
                              <button
                                className="popover-btn"
                                onClick={(e) => handleAction(e, 'fork', thread)}
                              >
                                <GitFork size={12} />
                                <span>派生分支</span>
                              </button>
                              {thread.thread_id !== 'default' && (
                                <button
                                  className="popover-btn danger"
                                  onClick={(e) => handleAction(e, 'close', thread)}
                                >
                                  <Trash2 size={12} />
                                  <span>关闭会话</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {projThreads.length > 5 && (
                      <div
                        className="btn-expand-more-threads"
                        onClick={() => toggleThreadListExpand(proj.name)}
                      >
                        <span>{isListExpanded ? '收起' : '展开显示'}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {allProjects.length > 5 && (
            <div
              className="btn-expand-more-projects"
              onClick={() => setShowAllProjects(!showAllProjects)}
            >
              <span>{showAllProjects ? '收起' : '展开显示'}</span>
            </div>
          )}
        </div>

        {/* 4. Bottom Collapsible "最近 >" */}
        <div className="sidebar-bottom-recent">
          <div
            className="recent-section-header"
            onClick={() => setShowRecentSection(!showRecentSection)}
          >
            <span className="recent-label">最近</span>
            <ChevronRight
              size={14}
              className={`recent-chevron ${showRecentSection ? 'open' : ''}`}
            />
          </div>

          {showRecentSection && (
            <div className="recent-items-list">
              {normalizedThreads.slice(0, 8).map((t) => (
                <div
                  key={t.thread_id}
                  className={`recent-thread-item ${t.thread_id === currentThread ? 'active' : ''}`}
                  onClick={() => onSelectThread(t.thread_id)}
                >
                  <span className="recent-thread-title">{t.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New Project Modal */}
      {showNewProjectModal && (
        <div
          className="modal-overlay-mini"
          onClick={() => setShowNewProjectModal(false)}
        >
          <div className="modal-card-mini" onClick={(e) => e.stopPropagation()}>
            <div className="modal-card-header">
              <div className="modal-card-title">
                <FolderPlus size={14} className="text-emerald" />
                <span>新建工作区项目 (New Project)</span>
              </div>
              <button
                className="modal-card-close"
                onClick={() => setShowNewProjectModal(false)}
              >
                <X size={13} />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="modal-card-body">
              <div className="form-field">
                <label>项目名称 (Project Name)</label>
                <input
                  type="text"
                  placeholder="例如: my-ai-service"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="form-field">
                <label>自定义目录路径 (可选，默认在上一级创建)</label>
                <input
                  type="text"
                  placeholder="例如: D:\gh-ws\my-ai-service"
                  value={newProjectPath}
                  onChange={(e) => setNewProjectPath(e.target.value)}
                />
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn-subtle"
                  onClick={() => setShowNewProjectModal(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!newProjectName.trim() || isCreatingProject}
                >
                  {isCreatingProject ? '创建中...' : '立即创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
