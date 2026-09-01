import React, { useState } from 'react';
import {
  Sparkles,
  GitBranch,
  Compass,
  Target,
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
  planActive,
  goalState,
  onTogglePlan,
  onStartGoal,
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

  const currentMode = planActive ? 'plan' : goalState?.status === 'running' ? 'goal' : 'chat';

  return (
    <header className="app-header">
      {/* Left: Branding & Current Thread / Workspace */}
      <div className="header-left">
        <div className="app-branding">
          <div className="brand-logo">
            <Sparkles size={16} className="logo-icon" />
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
              <button className="icon-btn-micro check" onClick={handleSaveTitle}>
                <Check size={12} />
              </button>
              <button className="icon-btn-micro cancel" onClick={() => setIsEditingTitle(false)}>
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

          {/* Summary badge / button */}
          <div className="summary-popover-wrapper">
            <button
              className={`summary-badge-btn ${threadSummary ? 'has-summary' : ''}`}
              onClick={() => {
                setSummaryInput(threadSummary || '');
                setShowSummaryPopover(!showSummaryPopover);
              }}
              title={threadSummary ? `摘要: ${threadSummary}` : '为当前会话指定摘要'}
            >
              <FileText size={11} />
              <span>{threadSummary ? '已设摘要' : '+ 摘要'}</span>
            </button>

            {showSummaryPopover && (
              <div className="summary-popover">
                <div className="popover-header">
                  <span>指定会话摘要 (Thread Summary)</span>
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

      {/* Center: Workflow Mode Segmented Switcher */}
      <div className="header-center">
        <div className="workflow-segmented-bar">
          <button
            className={`mode-btn ${currentMode === 'chat' ? 'active' : ''}`}
            onClick={() => {
              if (planActive) onTogglePlan();
            }}
          >
            <span>💬 对话模式 (Chat)</span>
          </button>

          <button
            className={`mode-btn plan ${currentMode === 'plan' ? 'active' : ''}`}
            onClick={onTogglePlan}
            title="开启/关闭只读规划探索模式"
          >
            <Compass size={13} />
            <span>📋 规划模式 (Plan)</span>
            {planActive && <span className="mode-pulse-dot amber"></span>}
          </button>

          <button
            className={`mode-btn goal ${currentMode === 'goal' ? 'active' : ''}`}
            onClick={() => onOpenSidePanel('plan_goal')}
            title="目标收敛多里程碑驱动模式"
          >
            <Target size={13} />
            <span>🎯 目标模式 (Goal)</span>
            {goalState?.status === 'running' && <span className="mode-pulse-dot green"></span>}
          </button>
        </div>
      </div>

      {/* Right: Tools, SidePanel, Settings, and Status */}
      <div className="header-right">
        <button
          className="header-action-btn"
          onClick={() => onOpenSidePanel('world')}
          title="打开侧边环境与扩展面板"
        >
          <Cpu size={14} />
          <span>侧边面板</span>
        </button>

        <button
          className="header-action-btn icon-only"
          onClick={onOpenSettings}
          title="系统与偏好设置"
        >
          <Settings size={15} />
        </button>

        <div
          className={`connection-status ${isConnected ? 'online' : 'offline'}`}
          title={isConnected ? 'WebSocket 网关已连接' : 'WebSocket 连接已断开，正在重试...'}
        >
          <span className="status-dot"></span>
          <span className="status-label">{isConnected ? 'Connected' : 'Offline'}</span>
        </div>
      </div>
    </header>
  );
}
