import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  MoreHorizontal,
  Folder,
  FolderPlus,
  Search,
  ChevronRight,
  X,
  Edit2,
  FileText,
  GitFork,
  Trash2,
  MoreVertical,
  Circle,
  Loader2,
  Pin,
  Settings,
  SquarePen,
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
  onToast,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchBox, setShowSearchBox] = useState(false);
  const [activeMenuThread, setActiveMenuThread] = useState(null);

  // Projects State
  const [projectsData, setProjectsData] = useState(null);
  const [expandedProjects, setExpandedProjects] = useState({});
  const [expandedThreadLists, setExpandedThreadLists] = useState({});
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showRecentSection, setShowRecentSection] = useState(false);

  // Project Detail Popover (Image 1)
  const [activeProjectPopover, setActiveProjectPopover] = useState(null);

  // Edit Project Modal (Image 2)
  const [editingProject, setEditingProject] = useState(null);
  const [editProjectName, setEditProjectName] = useState('');
  const [editSourceFolders, setEditSourceFolders] = useState([]);
  const [newFolderNameInput, setNewFolderNameInput] = useState('');
  const [newFolderPathInput, setNewFolderPathInput] = useState('');
  const [showAddFolderInput, setShowAddFolderInput] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);

  // New Session Modal State
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [newSessionProject, setNewSessionProject] = useState('');
  const [newSessionTitle, setNewSessionTitle] = useState('');

  useEffect(() => {
    loadProjects();
  }, []);

  // Close project popover on window click
  useEffect(() => {
    const handleWindowClick = () => {
      setActiveProjectPopover(null);
      setActiveMenuThread(null);
    };
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  const loadProjects = async () => {
    try {
      const data = await api.listProjects();
      setProjectsData(data);
      const curId = data?.current_project?.id || data?.current_project?.name;
      if (curId) {
        setExpandedProjects((prev) => ({ ...prev, [curId]: true, [data.current_project.name]: true }));
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  // Open New Project Modal
  const handleOpenNewProject = () => {
    setActiveProjectPopover(null);
    setEditingProject({ is_new: true, name: '', source_folders: [] });
    setEditProjectName('');
    setEditSourceFolders([]);
    setShowAddFolderInput(false);
    setNewFolderNameInput('');
    setNewFolderPathInput('');
  };

  // Open Edit Modal (Image 2)
  const handleOpenEditProject = (proj) => {
    setActiveProjectPopover(null);
    setEditingProject({ ...proj, is_new: false });
    setEditProjectName(proj.name || proj.id);
    const folders = proj.source_folders && proj.source_folders.length > 0
      ? proj.source_folders.map((f) => ({ ...f }))
      : [{ name: proj.name, path: proj.primary_path || proj.path || proj.name, is_primary: true }];
    setEditSourceFolders(folders);
    setShowAddFolderInput(false);
    setNewFolderNameInput('');
    setNewFolderPathInput('');
  };

  // Save Project Edits (Create or Update)
  const handleSaveProjectEdits = async (e) => {
    if (e) e.preventDefault();
    if (!editingProject || !editProjectName.trim()) return;
    setIsSavingProject(true);
    try {
      const cleanName = editProjectName.trim();
      if (editingProject.is_new) {
        const folders =
          editSourceFolders.length > 0
            ? editSourceFolders
            : [{ name: cleanName, path: cleanName, is_primary: true }];
        const primaryFolder = folders.find((f) => f.is_primary) || folders[0];
        const targetPath = primaryFolder?.path || null;
        const res = await api.createProject(cleanName, targetPath, folders, true);
        const newProj = res.project || { id: cleanName.toLowerCase().replace(/\s+/g, '-') };
        
        // Start default thread for this project
        const newThreadId = 't-' + Date.now().toString(36);
        await api.startThread(newThreadId, '默认会话');
        setExpandedProjects((prev) => ({
          ...prev,
          [newProj.id]: true,
          [cleanName]: true,
        }));
        onSelectThread(newThreadId);
      } else {
        await api.updateProject(editingProject.id || editingProject.name, {
          name: cleanName,
          source_folders: editSourceFolders,
        });
      }
      setEditingProject(null);
      await loadProjects();
      if (onRefreshThreads) onRefreshThreads();
      if (onToast) {
        onToast(editingProject.is_new ? `已成功创建项目 "${cleanName}"` : `已保存项目 "${cleanName}"`, 'success');
      }
    } catch (err) {
      if (onToast) {
        onToast(`保存项目失败: ${err.message}`, 'error');
      }
    } finally {
      setIsSavingProject(false);
    }
  };

  // Delete/Remove Local Project
  const handleDeleteProject = async () => {
    if (!editingProject) return;
    try {
      const projName = editingProject.name;
      await api.deleteProject(editingProject.id || editingProject.name);
      setEditingProject(null);
      await loadProjects();
      if (onRefreshThreads) onRefreshThreads();
      if (onToast) {
        onToast(`已从工作区移除本地项目 "${projName}"`, 'info');
      }
    } catch (err) {
      if (onToast) {
        onToast(`移除项目失败: ${err.message}`, 'error');
      }
    }
  };

  // Toggle Pin
  const handleTogglePin = async (e, proj) => {
    e.stopPropagation();
    try {
      await api.pinProject(proj.id || proj.name);
      await loadProjects();
    } catch (err) {
      if (onToast) {
        onToast(`固定项目失败: ${err.message}`, 'error');
      }
    }
  };

  // Native OS Folder Picker
  const handlePickNativeFolder = async () => {
    try {
      const res = await api.browseFolder();
      if (res && res.selected && res.path) {
        const folderName = res.name || 'workspace';
        const folderPath = res.path;

        // Auto-fill project name if empty
        if (!editProjectName.trim()) {
          setEditProjectName(folderName);
        }

        // Add to source folders if not already present
        setEditSourceFolders((prev) => {
          if (prev.some((f) => f.path === folderPath)) {
            return prev;
          }
          return [
            ...prev,
            {
              name: folderName,
              path: folderPath,
              is_primary: prev.length === 0,
              editable: true,
            },
          ];
        });
        setShowAddFolderInput(false);
      }
    } catch (err) {
      console.warn('Native folder picker error, falling back to manual input:', err);
      setShowAddFolderInput(true);
    }
  };

  // Add Source Folder to Edit List manually
  const handleAddSourceFolder = () => {
    if (!newFolderNameInput.trim()) return;
    const name = newFolderNameInput.trim();
    const path = newFolderPathInput.trim() || `./${name}`;
    setEditSourceFolders((prev) => [
      ...prev,
      {
        name,
        path,
        is_primary: prev.length === 0,
        editable: true,
      },
    ]);
    setNewFolderNameInput('');
    setNewFolderPathInput('');
    setShowAddFolderInput(false);
  };

  // Remove Source Folder from Edit List
  const handleRemoveSourceFolder = (idx) => {
    setEditSourceFolders((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length > 0 && !next.some((f) => f.is_primary)) {
        next[0].is_primary = true;
      }
      return next;
    });
  };

  // Set Primary Folder
  const handleSetPrimaryFolder = (idx) => {
    setEditSourceFolders((prev) =>
      prev.map((f, i) => ({
        ...f,
        is_primary: i === idx,
      }))
    );
  };

  const handleToggleFolderEditable = (idx) => {
    setEditSourceFolders((prev) =>
      prev.map((folder, i) =>
        i === idx && !folder.is_primary
          ? { ...folder, editable: folder.editable === false }
          : folder
      )
    );
  };

  const toggleProjectExpand = (projName, path) => {
    setExpandedProjects((prev) => {
      const nextState = !prev[projName];
      if (nextState && path && path !== projectsData?.current_project?.primary_path) {
        api.switchProject(path).then(() => {
          loadProjects();
          if (onRefreshThreads) onRefreshThreads();
        });
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

  const currentProject = projectsData?.current_project;
  const currentProjectName =
    currentProject?.name || currentProject?.id || 'mini-agent-web';

  const normalizedThreads = useMemo(() => {
    return (threads || []).map((t) => {
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
        title: t.title || (t.thread_id === 'default' ? '默认会话' : t.thread_id),
        project: t.project || currentProjectName,
        summary: t.summary || '',
        updated_at: t.updated_at || new Date().toISOString(),
        runtime_status: t.runtime_status || null,
        session_status: t.session_status || null,
        goal_status: t.goal_status || null,
        cleanup_pending: Boolean(t.cleanup_pending),
        resumable: Boolean(t.resumable),
        session_id: t.session_id || null,
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

  const allProjects = useMemo(() => {
    if (projectsData?.projects && projectsData.projects.length > 0) {
      return projectsData.projects;
    }
    if (projectsData?.current_project) {
      return [projectsData.current_project];
    }
    return [];
  }, [projectsData]);

  const displayedProjects = showAllProjects ? allProjects : allProjects.slice(0, 5);

  const handleAction = (e, action, thread) => {
    e.stopPropagation();
    setActiveMenuThread(null);

    if (action === 'fork') {
      onForkThread(thread.thread_id);
    } else if (action === 'close') {
      onCloseThread(thread.thread_id);
    } else if (action === 'rename') {
      const newTitle = window.prompt('重命名会话:', thread.title);
      if (newTitle && newTitle.trim()) {
        onRenameThread(thread.thread_id, newTitle.trim());
      }
    } else if (action === 'summary') {
      const newSum = window.prompt('设置阶段摘要:', thread.summary);
      if (newSum !== null) {
        onUpdateSummary(thread.thread_id, newSum.trim());
      }
    }
  };

  const recentSortedThreads = useMemo(() => {
    return [...normalizedThreads].sort((a, b) => {
      const dateA = new Date(a.updated_at || 0).getTime();
      const dateB = new Date(b.updated_at || 0).getTime();
      return dateB - dateA;
    });
  }, [normalizedThreads]);

  const handleOpenNewSession = () => {
    setActiveProjectPopover(null);
    setActiveMenuThread(null);
    setNewSessionProject(currentProjectName || allProjects[0]?.name || 'mini-agent-web');
    setNewSessionTitle('');
    setShowNewSessionModal(true);
  };

  const handleConfirmNewSession = async (e) => {
    if (e) e.preventDefault();
    const projToUse = newSessionProject || currentProjectName;
    const titleToUse = newSessionTitle.trim();

    setShowNewSessionModal(false);

    // If target project is different from active workspace, switch workspace
    const targetProj = allProjects.find(
      (p) => p.name === projToUse || p.id === projToUse
    );
    if (
      targetProj &&
      targetProj.primary_path &&
      targetProj.primary_path !== projectsData?.current_project?.primary_path
    ) {
      try {
        await api.switchProject(targetProj.primary_path);
        await loadProjects();
      } catch (err) {
        console.warn('Failed to switch project workspace:', err);
      }
    }

    if (onNewThread) {
      onNewThread(projToUse, titleToUse);
    }
  };

  return (
    <aside className="codex-sidebar">
      {/* 1. Header: Codex ⌵ | Search */}
      <div className="sidebar-top-bar">
        <div className="codex-brand-dropdown">
          <span className="brand-name">Codex</span>
          <ChevronRight size={13} className="brand-chevron" style={{ transform: 'rotate(90deg)' }} />
        </div>
        <div className="top-bar-icons">
          <button
            className={`top-icon-btn ${showSearchBox ? 'active' : ''}`}
            onClick={() => {
              setShowSearchBox(!showSearchBox);
              if (showSearchBox) setSearchQuery('');
            }}
            title="搜索会话"
          >
            <Search size={14} />
          </button>
        </div>
      </div>

      {/* 2. Top Nav Action: 新对话 (支持直接新建或选择所属项目) */}
      <div className="sidebar-nav-actions">
        <div
          className="nav-action-row nav-new-session-row"
          onClick={handleOpenNewSession}
          title="新对话 (可选择所属项目与标题)"
        >
          <div className="nav-row-left">
            <SquarePen size={14} className="nav-row-icon" />
            <span className="nav-row-label">新对话</span>
          </div>
          <button
            type="button"
            className="btn-plus-shortcut"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenNewSession();
            }}
            title="新建会话并选择项目"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* 3. Projects Section */}
      <div className="sidebar-projects-section custom-scrollbar">
        <div className="section-header-row">
          <span className="section-title-label">项目</span>
          <div className="section-header-actions" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <button
              className="btn-add-project-mini"
              onClick={handleOpenNewProject}
              title="新建工作区项目"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>

        {showSearchBox && (
          <div className="sidebar-search-box" style={{ padding: '4px 8px 8px', display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input
              type="text"
              className="sidebar-search-input"
              style={{
                width: '100%',
                fontSize: '11px',
                padding: '4px 6px',
                borderRadius: '4px',
                border: '1px solid var(--border-color, #e5e7eb)',
                background: 'var(--bg-secondary, #f9fafb)',
                color: 'inherit',
              }}
              placeholder="搜索会话标题/ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}
                onClick={() => setSearchQuery('')}
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}

        <div className="project-tree-list">
          {displayedProjects.map((proj) => {
            const isExpanded = Boolean(expandedProjects[proj.name] || expandedProjects[proj.id]);
            const isCurrentProj = proj.name === currentProjectName || proj.id === currentProjectName;
            const projThreads = filteredThreads.filter(
              (t) =>
                t.project === proj.name ||
                t.project === proj.id ||
                (isCurrentProj && (!t.project || t.project === currentProjectName))
            );
            const isListExpanded = Boolean(expandedThreadLists[proj.name]);
            const visibleThreads = isListExpanded
              ? projThreads
              : projThreads.slice(0, 5);

            return (
              <div key={proj.name || proj.id} className="project-tree-item">
                {/* Project Folder Row with Hover Actions */}
                <div
                  className={`project-folder-row ${isCurrentProj ? 'active-proj' : ''} ${activeProjectPopover === (proj.id || proj.name) ? 'has-open-popover' : ''}`}
                  onClick={() => toggleProjectExpand(proj.name || proj.id, proj.primary_path || proj.path)}
                  title={proj.primary_path || proj.path}
                >
                  <Folder size={14} className="folder-icon" />
                  <span className="folder-name">{proj.name}</span>
                  {proj.pinned && <Pin size={10} className="project-pinned-dot" />}

                  {/* Hover Action Buttons on Project Row */}
                  <div className="project-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className={`btn-proj-action-dots ${activeProjectPopover === (proj.id || proj.name) ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const key = proj.id || proj.name;
                        setActiveProjectPopover(
                          activeProjectPopover === key ? null : key
                        );
                      }}
                      title="项目详情与工作区"
                    >
                      <MoreHorizontal size={13} />
                    </button>

                    <button
                      className="btn-proj-action-edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditProject(proj);
                      }}
                      title="编辑项目"
                    >
                      <Edit2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Project Details Dropdown Card */}
                {activeProjectPopover === (proj.id || proj.name) && (
                  <div
                    className="project-context-popover"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="popover-header-row">
                      <div className="popover-title-left">
                        <Folder size={14} className="folder-popover-icon" />
                        <span className="popover-project-name">{proj.name}</span>
                      </div>
                      <button
                        className={`popover-pin-btn ${proj.pinned ? 'pinned' : ''}`}
                        onClick={(e) => handleTogglePin(e, proj)}
                        title={proj.pinned ? '取消固定' : '固定项目'}
                      >
                        <Pin size={13} />
                      </button>
                    </div>

                    <div className="popover-tasks-summary">
                      <SquarePen size={12} className="text-muted" />
                      <span>{Math.max(proj.threads_count || 0, proj.sessions_count || 0, projThreads.length)} 个会话 · {proj.active_threads_count ?? 0} 个活跃</span>
                    </div>

                    <div className="popover-divider"></div>

                    {/* Source Folders List */}
                    <div className="popover-source-folders-list custom-scrollbar">
                      {proj.source_folders && proj.source_folders.length > 0 ? (
                        proj.source_folders.map((folder, idx) => (
                          <div key={idx} className="popover-folder-item" title={folder.path || folder.name}>
                            <Folder size={13} className="folder-item-icon" />
                            <span className="folder-item-path">
                              {folder.name || folder.path}
                            </span>
                            {folder.is_primary && <span className="primary-tag">主</span>}
                          </div>
                        ))
                      ) : (
                        <div className="popover-folder-item" title={proj.primary_path || proj.path || proj.name}>
                          <Folder size={13} className="folder-item-icon" />
                          <span className="folder-item-path">{proj.primary_path || proj.path || proj.name}</span>
                        </div>
                      )}
                    </div>

                    <div className="popover-divider"></div>

                    {/* Bottom Edit Action */}
                    <button
                      className="popover-btn-edit-project"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditProject(proj);
                      }}
                    >
                      <Settings size={13} />
                      <span>编辑项目配置</span>
                    </button>
                  </div>
                )}

                {/* Nested Threads under Project */}
                {isExpanded && (
                  <div className="project-nested-threads">
                    {visibleThreads.map((thread) => {
                      const isSelected = thread.thread_id === currentThread;
                      return (
                        <div
                          key={thread.thread_id}
                          className={`nested-thread-item ${isSelected ? 'selected' : ''} ${thread.runtime_status === 'running' ? 'is-running' : ''}`}
                          onClick={() => onSelectThread(thread.thread_id)}
                          title={thread.title}
                        >
                          <span className="nested-thread-title">
                            {thread.title}
                          </span>

                          {(thread.runtime_status || thread.goal_status) && (
                            <span
                              className={`thread-status-badge ${thread.runtime_status || thread.goal_status}`}
                              title={thread.resumable ? '可恢复的历史会话' : undefined}
                            >
                              {thread.runtime_status === 'running'
                                ? '运行中'
                                : thread.runtime_status === 'paused'
                                  ? '已暂停'
                                : thread.goal_status === 'paused'
                                  ? '已暂停'
                                : thread.cleanup_pending
                                  ? '清理待处理'
                                  : thread.resumable
                                    ? '可恢复'
                                    : '历史'}
                            </span>
                          )}

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
              {recentSortedThreads.slice(0, 8).map((t) => (
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

      {/* 5. 编辑项目 (Edit Project) Modal (Image 2) */}
      {editingProject && (
        <div
          className="modal-overlay-edit-project"
          onClick={() => setEditingProject(null)}
        >
          <div
            className="modal-card-edit-project"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="modal-edit-header">
              <span className="modal-edit-title">
                {editingProject.is_new ? '创建项目' : '编辑项目'}
              </span>
              <button
                className="modal-edit-close"
                onClick={() => setEditingProject(null)}
              >
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleSaveProjectEdits} className="modal-edit-body">
              {/* Project Name Input (Image 2 & 3) */}
              <div className="project-name-input-wrap">
                <Folder size={16} className="input-folder-icon" />
                <input
                  type="text"
                  className="project-name-input"
                  placeholder="项目名称"
                  value={editProjectName}
                  onChange={(e) => setEditProjectName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {/* 源文件夹 (Source Folders List) (Image 2 & 3) */}
              <div className="source-folders-section">
                <span className="source-folders-title">源文件夹</span>

                <div className="source-folders-card-list">
                  {/* Empty state box matching Image 3 (media_1788234880786.png) */}
                  {editSourceFolders.length === 0 && !showAddFolderInput ? (
                    <div
                      className="create-project-empty-folder-box"
                      onClick={handlePickNativeFolder}
                      title="点击调起本地系统文件夹选择窗口"
                    >
                      <FolderPlus size={24} className="empty-folder-icon" />
                      <span className="empty-folder-text">
                        添加 Mini-Agent 可读取和编辑的文件夹
                      </span>
                    </div>
                  ) : null}

                  {editSourceFolders.map((folder, idx) => (
                    <div key={idx} className="source-folder-row">
                      <div className="folder-row-left">
                        <Folder size={14} className="folder-row-icon" />
                        <span className="folder-row-name" title={folder.path || folder.name}>
                          {folder.name || folder.path}
                        </span>
                      </div>

                      <div className="folder-row-right">
                        {folder.is_primary ? (
                          <span className="primary-badge">主工作区</span>
                        ) : (
                          <button
                            type="button"
                            className="btn-set-primary"
                            onClick={() => handleSetPrimaryFolder(idx)}
                            title="设为主工作目录"
                          >
                            设为主要
                          </button>
                        )}

                        {!folder.is_primary && (
                          <button
                            type="button"
                            className={`btn-folder-access ${folder.editable === false ? 'reference' : 'editable'}`}
                            onClick={() => handleToggleFolderEditable(idx)}
                            title={folder.editable === false ? '作为只读参考目录' : '允许 Agent 编辑此关联目录'}
                          >
                            {folder.editable === false ? '仅参考' : '可编辑'}
                          </button>
                        )}

                        <button
                          type="button"
                          className="btn-remove-folder"
                          onClick={() => handleRemoveSourceFolder(idx)}
                          title="移除文件夹"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Add Folder Inline Input or Native Trigger */}
                  {showAddFolderInput ? (
                    <div className="add-folder-inline-box">
                      <div className="inline-inputs-row">
                        <input
                          type="text"
                          className="inline-folder-name"
                          placeholder="文件夹别名 (如: fx)"
                          value={newFolderNameInput}
                          onChange={(e) => setNewFolderNameInput(e.target.value)}
                          autoFocus
                        />
                        <input
                          type="text"
                          className="inline-folder-path"
                          placeholder="目录绝对路径 (如: D:\gh-ws\fx)"
                          value={newFolderPathInput}
                          onChange={(e) => setNewFolderPathInput(e.target.value)}
                        />
                      </div>
                      <div className="inline-add-actions">
                        <button
                          type="button"
                          className="btn-cancel-inline"
                          onClick={() => setShowAddFolderInput(false)}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="btn-confirm-inline"
                          onClick={handleAddSourceFolder}
                          disabled={!newFolderNameInput.trim()}
                        >
                          确认添加
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="add-folder-trigger-container">
                      <div
                        className="btn-add-folder-row"
                        onClick={handlePickNativeFolder}
                        title="打开系统文件夹选择窗口"
                      >
                        <FolderPlus size={14} className="add-folder-icon" />
                        <span>添加文件夹</span>
                      </div>
                      <button
                        type="button"
                        className="btn-text-manual"
                        onClick={() => setShowAddFolderInput(true)}
                        title="手动输入路径"
                      >
                        手动输入
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer Actions (Image 2) */}
              <div className="modal-edit-footer">
                {!editingProject.is_new ? (
                  <button
                    type="button"
                    className="btn-danger-remove-project"
                    onClick={handleDeleteProject}
                  >
                    移除本地项目
                  </button>
                ) : (
                  <div />
                )}

                <div className="footer-right-buttons">
                  <button
                    type="button"
                    className="btn-cancel-edit"
                    onClick={() => setEditingProject(null)}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="btn-save-project-primary"
                    disabled={!editProjectName.trim() || isSavingProject}
                  >
                    {isSavingProject
                      ? editingProject.is_new
                        ? '创建中...'
                        : '保存中...'
                      : editingProject.is_new
                        ? '创建项目'
                        : '保存'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Session Modal (Centered Overlay) */}
      {showNewSessionModal && (
        <div
          className="modal-overlay-edit-project"
          onClick={() => setShowNewSessionModal(false)}
        >
          <div
            className="modal-card-edit-project"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '460px' }}
          >
            <div className="modal-edit-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SquarePen size={16} style={{ color: 'var(--accent-color, #10a37f)' }} />
                <span className="modal-edit-title">新建会话</span>
              </div>
              <button
                type="button"
                className="modal-edit-close"
                onClick={() => setShowNewSessionModal(false)}
              >
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleConfirmNewSession}>
              <div className="modal-edit-body">
                {/* Select Project */}
                <div className="form-group-block">
                  <label className="field-label-text">
                    所属项目 <span className="text-required">*</span>
                  </label>
                  <select
                    className="modal-select-project"
                    value={newSessionProject}
                    onChange={(e) => setNewSessionProject(e.target.value)}
                  >
                    {allProjects.map((p) => (
                      <option key={p.id || p.name} value={p.name || p.id}>
                        📁 {p.name} {p.primary_path ? `(${p.primary_path})` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint-text">
                    会话将归属于所选项目，并在其工作区目录上下文中执行任务。
                  </span>
                </div>

                {/* Session Title (Optional) */}
                <div className="form-group-block">
                  <label className="field-label-text">会话标题（可选）</label>
                  <div className="modal-input-wrap">
                    <input
                      type="text"
                      className="modal-text-input"
                      placeholder="留空则自动生成（如：新会话 t-xxx）"
                      value={newSessionTitle}
                      onChange={(e) => setNewSessionTitle(e.target.value)}
                      autoFocus
                    />
                  </div>
                </div>
              </div>

              <div className="modal-edit-footer">
                <div />
                <div className="footer-right-buttons">
                  <button
                    type="button"
                    className="btn-cancel-edit"
                    onClick={() => setShowNewSessionModal(false)}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="btn-save-project-primary"
                  >
                    创建并开始
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
