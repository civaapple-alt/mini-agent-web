import React, { useState } from 'react';
import {
  Sparkles,
  GitBranch,
  Cpu,
  Settings,
  Edit2,
  Check,
  X,
  FileText,
} from 'lucide-react';
import './Header.css';

export default function Header({
  currentThread,
  threadTitle,
  threadSummary,
  isConnected,
  onOpenSidePanel,
  onOpenSettings,
  onRenameThread,
  onUpdateSummary,
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState(threadTitle || currentThread);
  const [showSummaryPopover, setShowSummaryPopover] = useState(false);
  const [summaryInput, setSummaryInput] = useState(threadSummary || '');

  const handleSaveTitle = () => {
    if (newTitle.trim() && onRenameThread) {
      onRenameThread(newTitle.trim());
    }
    setIsEditingTitle(false);
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
        <div className="app-branding">
          <div className="brand-logo">
            <Sparkles size={15} className="logo-icon" />
          </div>
          <div className="brand-text">
            <span className="brand-title">Mini Agent</span>
            <span className="brand-badge font-mono">Codex Studio</span>
          </div>
        </div>

        <div className="thread-title-container">
          <div className="thread-icon-box">
            <GitBranch size={13} className="text-sky" />
          </div>

          {isEditingTitle ? (
            <div className="title-edit-box">
              <input
                type="text"
                className="title-edit-input font-mono"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle();
                  if (e.key === 'Escape') setIsEditingTitle(false);
                }}
                autoFocus
              />
              <button className="icon-btn-micro check" onClick={handleSaveTitle} title="确认">
                <Check size={12} />
              </button>
              <button className="icon-btn-micro cancel" onClick={() => setIsEditingTitle(false)} title="取消">
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
          onClick={() => onOpenSidePanel('world')}
          title="打开环境与工作流抽屉"
        >
          <Cpu size={13} />
          <span>控制台面板</span>
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
