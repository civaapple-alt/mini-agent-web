import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import './Header.css';

export default function Header({
  currentThread,
  threadTitle,
  threadSummary,
  sessionId,
  isConnected,
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
              <div className="title-display-box" onClick={() => {
                setNewTitle(threadTitle || currentThread);
                setIsEditingTitle(true);
              }}>
                <span className="thread-title-text" title="点击重命名会话">
                  {threadTitle || currentThread}
                </span>
                <Edit2 size={11} className="title-edit-hint" />
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

        <div className={`connection-status ${isConnected ? 'online' : 'offline'}`}>
          <span className="status-dot"></span>
          <span className="status-label">{isConnected ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
      </div>
    </header>
  );
}
