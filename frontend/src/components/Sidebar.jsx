import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  MessageSquare,
  Search,
  GitFork,
  Trash2,
  RefreshCw,
  MoreVertical,
  Edit2,
  FileText,
  Pin,
  Clock,
  Folder,
  FolderPlus,
  ChevronDown,
  Check,
  X,
  ExternalLink,
} from 'lucide-react';
import { api } from '../api';
import './Sidebar.css';

export default function Sidebar({
  threads,
  currentThread,
  onSelectThread,
  onNewThread,
  onForkThread,
  onCloseThread,
  onRenameThread,
  onUpdateSummary,
  onRefreshThreads,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMenuThread, setActiveMenuThread] = useState(null);

  // Projects State
  const [projectsData, setProjectsData] = useState(null);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const data = await api.listProjects();
      setProjectsData(data);
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

  const handleSwitchProject = async (path) => {
    try {
      await api.switchProject(path);
      setShowProjectDropdown(false);
      await loadProjects();
      if (onRefreshThreads) onRefreshThreads();
    } catch (err) {
      alert(`切换项目失败: ${err.message}`);
    }
  };

  // Group threads chronologically
  const groupedThreads = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    const groups = {
      pinned: [],
      today: [],
      yesterday: [],
      lastWeek: [],
      older: [],
    };

    const normalizedThreads = threads.map((t) => {
      if (typeof t === 'string') {
        return {
          thread_id: t,
          title: t === 'default' ? '默认会话 (Default)' : t,
          summary: '',
          updated_at: new Date().toISOString(),
          pinned: t === 'default',
        };
      }
      return {
        thread_id: t.thread_id,
        title: t.title || t.thread_id,
        summary: t.summary || '',
        updated_at: t.updated_at || new Date().toISOString(),
        pinned: Boolean(t.pinned),
      };
    });

    const filtered = normalizedThreads.filter((t) => {
      const q = searchQuery.toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        t.thread_id.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q)
      );
    });

    for (const t of filtered) {
      if (t.pinned) {
        groups.pinned.push(t);
        continue;
      }
      const updatedDate = new Date(t.updated_at);
      if (updatedDate >= today) {
        groups.today.push(t);
      } else if (updatedDate >= yesterday) {
        groups.yesterday.push(t);
      } else if (updatedDate >= lastWeek) {
        groups.lastWeek.push(t);
      } else {
        groups.older.push(t);
      }
    }

    return groups;
  }, [threads, searchQuery]);

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

  const renderThreadGroup = (title, items, icon = null) => {
    if (!items || items.length === 0) return null;

    return (
      <div className="thread-time-group" key={title}>
        <div className="time-group-title">
          {icon}
          <span>{title}</span>
          <span className="group-count font-mono">{items.length}</span>
        </div>

        <div className="thread-list">
          {items.map((thread) => {
            const isSelected = thread.thread_id === currentThread;
            return (
              <div
                key={thread.thread_id}
                className={`thread-item ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelectThread(thread.thread_id)}
              >
                <div className="thread-main">
                  <div className="thread-title-row">
                    <MessageSquare size={13} className="thread-icon" />
                    <span className="thread-title font-mono" title={thread.title}>
                      {thread.title}
                    </span>
                  </div>

                  {thread.summary && (
                    <div className="thread-summary-snippet font-mono">
                      {thread.summary}
                    </div>
                  )}
                </div>

                {/* Popover action button */}
                <div className="thread-item-actions">
                  <button
                    className="icon-btn-dots"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenuThread(
                        activeMenuThread === thread.thread_id ? null : thread.thread_id
                      );
                    }}
                    title="会话选项"
                  >
                    <MoreVertical size={13} />
                  </button>

                  {activeMenuThread === thread.thread_id && (
                    <div className="thread-popup-menu">
                      <button
                        className="popup-item"
                        onClick={(e) => handleAction(e, 'rename', thread)}
                      >
                        <Edit2 size={12} />
                        <span>重命名 (Rename)</span>
                      </button>

                      <button
                        className="popup-item"
                        onClick={(e) => handleAction(e, 'summary', thread)}
                      >
                        <FileText size={12} />
                        <span>指定摘要 (Summary)</span>
                      </button>

                      <button
                        className="popup-item"
                        onClick={(e) => handleAction(e, 'fork', thread)}
                      >
                        <GitFork size={12} />
                        <span>派生分支 (Fork)</span>
                      </button>

                      {thread.thread_id !== 'default' && (
                        <button
                          className="popup-item danger"
                          onClick={(e) => handleAction(e, 'close', thread)}
                        >
                          <Trash2 size={12} />
                          <span>关闭会话 (Close)</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const currentProjectName = projectsData?.current_project?.name || 'mini-agent-workspace';
  const currentProjectPath = projectsData?.current_project?.path || '';

  return (
    <aside className="app-sidebar">
      {/* 1. Project Workspace Selector Header */}
      <div className="sidebar-project-header">
        <div
          className="project-selector-btn"
          onClick={() => setShowProjectDropdown(!showProjectDropdown)}
          title={`当前项目工作区: ${currentProjectPath}`}
        >
          <Folder size={14} className="text-amber" />
          <div className="project-text-wrap">
            <span className="project-label">当前项目工作区</span>
            <span className="project-name font-mono">{currentProjectName}</span>
          </div>
          <ChevronDown size={12} className="text-muted" />
        </div>

        <button
          className="btn-new-project-icon"
          onClick={() => setShowNewProjectModal(true)}
          title="新建工作区项目"
        >
          <FolderPlus size={14} />
        </button>

        {/* Project Dropdown Menu */}
        {showProjectDropdown && (
          <div className="project-dropdown-menu custom-scrollbar">
            <div className="dropdown-title">最近打开的项目工作区</div>
            {projectsData?.recent_projects?.map((proj) => (
              <div
                key={proj.path}
                className={`project-dropdown-item ${proj.path === currentProjectPath ? 'active' : ''}`}
                onClick={() => handleSwitchProject(proj.path)}
              >
                <div className="item-left">
                  <Folder size={13} className="text-sky" />
                  <div className="proj-item-text">
                    <span className="proj-name font-mono">{proj.name}</span>
                    <span className="proj-path font-mono">{proj.path}</span>
                  </div>
                </div>
                {proj.path === currentProjectPath && (
                  <Check size={12} className="text-green" />
                )}
              </div>
            ))}

            <div className="dropdown-divider"></div>
            <button
              className="btn-dropdown-action"
              onClick={() => {
                setShowProjectDropdown(false);
                setShowNewProjectModal(true);
              }}
            >
              <FolderPlus size={13} />
              <span>+ 创建新项目工作区...</span>
            </button>
          </div>
        )}
      </div>

      {/* 2. New Project Modal */}
      {showNewProjectModal && (
        <div className="modal-overlay-mini" onClick={() => setShowNewProjectModal(false)}>
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
                  className="font-mono"
                  placeholder="例如: my-ai-service"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="form-field">
                <label>自定义目录路径 (可选，默认在上一级新建目录)</label>
                <input
                  type="text"
                  className="font-mono"
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

      {/* 3. New Thread Action Bar */}
      <div className="sidebar-action-bar">
        <button className="btn-new-thread" onClick={onNewThread}>
          <Plus size={14} />
          <span>新建会话 (New Thread)</span>
        </button>

        <button
          className="btn-refresh-threads"
          onClick={onRefreshThreads}
          title="刷新会话列表"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* 4. Search Filter */}
      <div className="sidebar-search-box">
        <Search size={13} className="search-icon" />
        <input
          type="text"
          className="search-input font-mono"
          placeholder="搜索会话标题、ID 或摘要..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* 5. Chronological Thread List */}
      <div className="sidebar-threads-scroll custom-scrollbar">
        {renderThreadGroup('置顶与默认', groupedThreads.pinned, <Pin size={11} className="text-amber" />)}
        {renderThreadGroup('今日 (Today)', groupedThreads.today, <Clock size={11} className="text-sky" />)}
        {renderThreadGroup('昨日 (Yesterday)', groupedThreads.yesterday, <Clock size={11} className="text-muted" />)}
        {renderThreadGroup('过去 7 天 (Last 7 Days)', groupedThreads.lastWeek, <Clock size={11} className="text-muted" />)}
        {renderThreadGroup('更早会话 (Older)', groupedThreads.older, <Clock size={11} className="text-muted" />)}

        {threads.length === 0 && (
          <div className="empty-threads-state font-mono">
            <span>暂无活跃会话</span>
          </div>
        )}
      </div>
    </aside>
  );
}
