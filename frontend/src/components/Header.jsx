import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  GitBranch,
  Cpu,
  Settings,
  Edit2,
  Check,
  Copy,
  X,
  FileText,
  Menu,
  FolderOpen,
  Code2,
  Braces,
  SquareTerminal,
  ChevronDown,
  LoaderCircle,
} from 'lucide-react';
import { api } from '../api';
import './Header.css';

const OPEN_TARGET_PREFERENCE_KEY = 'mini-agent-web.project-open-target';
const OPEN_TARGET_ICONS = {
  file_manager: FolderOpen,
  vscode: Code2,
  intellij: Braces,
  terminal: SquareTerminal,
};

function readPreferredOpenTarget() {
  try {
    return window.localStorage.getItem(OPEN_TARGET_PREFERENCE_KEY) || 'vscode';
  } catch {
    return 'vscode';
  }
}

export default function Header({
  currentThread,
  currentThreadProject,
  threadTitle,
  threadSummary,
  sessionId,
  isConnected,
  connectionState,
  onOpenSidePanel,
  onOpenSettings,
  onRenameThread,
  onUpdateSummary,
  onToast,
  sidebarOpen = false,
  onToggleSidebar,
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState(threadTitle || currentThread);
  const [showSummaryPopover, setShowSummaryPopover] = useState(false);
  const [summaryInput, setSummaryInput] = useState(threadSummary || '');
  const [showOpenTargetMenu, setShowOpenTargetMenu] = useState(false);
  const [openTargets, setOpenTargets] = useState([]);
  const [openTargetsLoading, setOpenTargetsLoading] = useState(false);
  const [openTargetsError, setOpenTargetsError] = useState('');
  const [preferredOpenTarget, setPreferredOpenTarget] = useState(readPreferredOpenTarget);
  const [openingTarget, setOpeningTarget] = useState(null);
  const openTargetRequestRef = useRef(null);
  const openTargetMenuRef = useRef(null);
  const visibleConnectionState = connectionState === 'online' && !isConnected
    ? 'offline'
    : connectionState || (isConnected ? 'online' : 'offline');

  // Close summary popover when clicking outside
  useEffect(() => {
    if (!showSummaryPopover) return;
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.summary-popover-wrapper')) {
        setShowSummaryPopover(false);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [showSummaryPopover]);

  useEffect(() => {
    if (!showOpenTargetMenu) return undefined;
    const handleOutsideClick = (event) => {
      if (!openTargetMenuRef.current?.contains(event.target)) {
        setShowOpenTargetMenu(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setShowOpenTargetMenu(false);
    };
    window.addEventListener('click', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showOpenTargetMenu]);

  useEffect(() => () => openTargetRequestRef.current?.abort(), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPEN_TARGET_PREFERENCE_KEY, preferredOpenTarget);
    } catch {
      // Keep the preferred target in memory when browser storage is unavailable.
    }
  }, [preferredOpenTarget]);

  useEffect(() => {
    setShowOpenTargetMenu(false);
  }, [currentThread, currentThreadProject]);

  const loadOpenTargets = async () => {
    if (openTargets.length) return openTargets;
    openTargetRequestRef.current?.abort();
    const controller = new AbortController();
    openTargetRequestRef.current = controller;
    setOpenTargetsLoading(true);
    setOpenTargetsError('');
    try {
      const result = await api.getProjectOpenTargets({ signal: controller.signal });
      const targets = Array.isArray(result?.targets) ? result.targets : [];
      setOpenTargets(targets);
      if (!targets.some((target) => target.id === preferredOpenTarget && target.available)) {
        const firstAvailable = targets.find((target) => target.available);
        if (firstAvailable) setPreferredOpenTarget(firstAvailable.id);
      }
      return targets;
    } catch (error) {
      if (error.name !== 'AbortError') setOpenTargetsError(error.message || '加载打开方式失败');
      throw error;
    } finally {
      if (openTargetRequestRef.current === controller) {
        openTargetRequestRef.current = null;
        setOpenTargetsLoading(false);
      }
    }
  };

  const handleToggleOpenTargetMenu = async (event) => {
    event.stopPropagation();
    if (showOpenTargetMenu) {
      setShowOpenTargetMenu(false);
      return;
    }
    setShowOpenTargetMenu(true);
    try {
      await loadOpenTargets();
    } catch {
      // Keep the menu open so its inline error can explain the failed detection.
    }
  };

  const handleOpenProject = async (targetId = preferredOpenTarget) => {
    if (openingTarget) return;
    setOpeningTarget(targetId);
    setOpenTargetsError('');
    try {
      let targets = openTargets;
      if (!targets.length) targets = await loadOpenTargets();
      const target = targets.find((item) => item.id === targetId);
      if (!target?.available) {
        throw new Error(target ? `${target.label} 未安装或未加入 PATH` : '没有可用的打开方式');
      }
      setPreferredOpenTarget(targetId);
      const result = await api.openProjectInTarget(targetId, {
        projectId: currentThreadProject,
      });
      setShowOpenTargetMenu(false);
      onToast?.(`已在 ${result.label} 打开项目工作区`, 'success');
    } catch (error) {
      setOpenTargetsError(error.message || '打开项目工作区失败');
      onToast?.(`打开项目工作区失败：${error.message}`, 'error');
    } finally {
      setOpeningTarget(null);
    }
  };

  const handleSaveTitle = () => {
    const nextTitle = newTitle.trim();
    const currentTitle = (threadTitle || currentThread).trim();
    if (nextTitle && nextTitle !== currentTitle && onRenameThread) {
      onRenameThread(nextTitle);
    }
    setIsEditingTitle(false);
  };

  const handleCancelTitle = () => {
    setNewTitle(threadTitle || currentThread);
    setIsEditingTitle(false);
  };

  const handleCopySessionId = async (event) => {
    event.stopPropagation();
    if (!sessionId) return;
    if (!navigator.clipboard?.writeText) {
      onToast?.('当前环境不支持复制 Session ID', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(sessionId);
      onToast?.('Session ID 已复制', 'success');
    } catch {
      onToast?.('复制 Session ID 失败', 'error');
    }
  };

  const handleSaveSummary = () => {
    if (onUpdateSummary) {
      onUpdateSummary(summaryInput.trim());
    }
    setShowSummaryPopover(false);
  };

  return (
    <header className="app-header">
      {/* Left: Branding & Current Thread / Workspace */}
      <div className="header-left">
        <button
          type="button"
          className={`mobile-sidebar-button ${sidebarOpen ? 'active' : ''}`}
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? '关闭会话导航' : '打开会话导航'}
          aria-expanded={sidebarOpen}
        >
          <Menu size={16} />
        </button>
        <div className="app-branding">
          <div className="brand-logo">
            <Sparkles size={15} className="logo-icon" />
          </div>
          <div className="brand-text">
            <span className="brand-title">Mini Agent</span>
            <span className="brand-badge font-mono">Mini Agent Studio</span>
          </div>
        </div>

        <div className="thread-title-container">
          <div className="thread-icon-box">
            <GitBranch size={13} className="text-sky" />
          </div>

          <div className="thread-identity-stack">
            {isEditingTitle ? (
              <div className="title-edit-box">
                <input
                  type="text"
                  className="title-edit-input font-mono"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onBlur={handleCancelTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveTitle();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancelTitle();
                    }
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  className="icon-btn-micro check"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleSaveTitle}
                  title="确认"
                >
                  <Check size={12} />
                </button>
                <button
                  type="button"
                  className="icon-btn-micro cancel"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleCancelTitle}
                  title="取消"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="title-display-box" onClick={onRenameThread ? () => {
                setNewTitle(threadTitle || currentThread);
                setIsEditingTitle(true);
              } : undefined}>
                <span className="thread-title-text" title={onRenameThread ? '点击重命名会话' : undefined}>
                  {threadTitle || currentThread}
                </span>
                {onRenameThread && <Edit2 size={11} className="title-edit-hint" />}
              </div>
            )}
            {sessionId && (
              <button
                type="button"
                className="thread-session-copy font-mono"
                onClick={handleCopySessionId}
                title="复制实际 Session ID"
              >
                <span className="thread-session-id">Session {sessionId}</span>
                <Copy size={11} />
              </button>
            )}
          </div>

          {/* Thread Summary Popover Badge */}
          <div className="summary-popover-wrapper">
            <button
              className={`summary-badge-btn ${threadSummary ? 'has-summary' : ''}`}
              onClick={() => {
                setSummaryInput(threadSummary || '');
                setShowSummaryPopover(!showSummaryPopover);
              }}
              title="查看/指定会话阶段摘要"
            >
              <FileText size={11} />
              <span className="font-mono">{threadSummary ? '指定摘要' : '+ 摘要'}</span>
            </button>

            {showSummaryPopover && (
              <div className="summary-popover custom-scrollbar">
                <div className="popover-header">
                  <span>会话阶段摘要 (Thread Summary)</span>
                  <button className="popover-close" onClick={() => setShowSummaryPopover(false)}>
                    <X size={12} />
                  </button>
                </div>
                <textarea
                  className="popover-textarea font-mono"
                  placeholder="输入此会话的目标或执行阶段摘要..."
                  rows={3}
                  value={summaryInput}
                  onChange={(e) => setSummaryInput(e.target.value)}
                />
                <div className="popover-footer">
                  <button className="popover-btn-save" onClick={handleSaveSummary}>
                    保存摘要
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Tools, SidePanel, Settings, and Status */}
      <div className="header-right">
        <div className="header-open-target-wrapper" ref={openTargetMenuRef}>
          <div className="header-open-target-control">
            {(() => {
              const SelectedIcon = OPEN_TARGET_ICONS[preferredOpenTarget] || Code2;
              const selectedTarget = openTargets.find((target) => target.id === preferredOpenTarget);
              return (
                <button
                  type="button"
                  className="header-open-target-launch"
                  onClick={() => handleOpenProject()}
                  disabled={Boolean(openingTarget)}
                  aria-label={selectedTarget?.label
                    ? `在 ${selectedTarget.label} 中打开项目工作区`
                    : '打开项目工作区'}
                  title={selectedTarget?.label
                    ? `在 ${selectedTarget.label} 中打开项目工作区`
                    : '打开项目工作区'}
                >
                  {openingTarget === preferredOpenTarget
                    ? <LoaderCircle size={19} className="header-open-target-spinner" />
                    : <SelectedIcon size={19} />}
                </button>
              );
            })()}
            <button
              type="button"
              className={`header-open-target-toggle ${showOpenTargetMenu ? 'active' : ''}`}
              onClick={handleToggleOpenTargetMenu}
              aria-label="选择项目工作区打开方式"
              aria-haspopup="menu"
              aria-expanded={showOpenTargetMenu}
              title="选择打开方式"
            >
              <ChevronDown size={15} />
            </button>
          </div>
          {showOpenTargetMenu && (
            <div className="header-open-target-menu" role="menu" aria-label="项目工作区打开方式">
              {openTargetsLoading && openTargets.length === 0 ? (
                <div className="header-open-target-message">正在检测本机应用…</div>
              ) : openTargetsError && openTargets.length === 0 ? (
                <div className="header-open-target-message error">{openTargetsError}</div>
              ) : openTargets.map((target) => {
                const TargetIcon = OPEN_TARGET_ICONS[target.id] || FolderOpen;
                return (
                  <button
                    key={target.id}
                    type="button"
                    className="header-open-target-item"
                    role="menuitem"
                    disabled={!target.available || Boolean(openingTarget)}
                    onClick={() => handleOpenProject(target.id)}
                    title={target.available ? `在 ${target.label} 中打开项目工作区` : `${target.label} 未安装或未加入 PATH`}
                  >
                    <TargetIcon size={18} className={`target-icon-${target.id}`} />
                    <span>{target.label}</span>
                    {target.id === preferredOpenTarget && <Check size={15} className="header-open-target-check" />}
                  </button>
                );
              })}
              {openTargetsError && openTargets.length > 0 && (
                <div className="header-open-target-message error">{openTargetsError}</div>
              )}
            </div>
          )}
        </div>

        <button
          className="header-action-btn"
          onClick={() => onOpenSidePanel('status')}
          title="打开运行详情抽屉"
        >
          <Cpu size={13} />
          <span>运行详情</span>
        </button>

        <button
          className="header-action-btn icon-only"
          onClick={onOpenSettings}
          title="系统与模型偏好设置"
        >
          <Settings size={14} />
        </button>

        <div className={`connection-status ${visibleConnectionState}`}>
          <span className="status-dot"></span>
          <span className="status-label">
            {visibleConnectionState === 'online'
              ? 'ONLINE'
              : visibleConnectionState === 'connecting'
                ? 'CONNECTING'
                : visibleConnectionState === 'reconnecting'
                  ? 'RECONNECTING'
                  : 'OFFLINE'}
          </span>
        </div>
      </div>
    </header>
  );
}
