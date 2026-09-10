import React from 'react';
import {
  Circle,
  Edit2,
  FileText,
  GitFork,
  Loader2,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { getThreadStatusPresentation } from '../../utils/threadStatus';

export default function ThreadRow({
  thread,
  currentThread,
  currentThreadProject,
  isGenerating,
  activeMenuThread,
  onSelectThread,
  onToggleMenu,
  onAction,
}) {
  const status = getThreadStatusPresentation(thread);
  const isSelected =
    thread.thread_id === currentThread &&
    (!currentThreadProject || thread.project === currentThreadProject);
  const threadKey = `${thread.project || 'unknown'}:${thread.thread_id}`;

  return (
    <div
      className={`nested-thread-item ${isSelected ? 'selected' : ''} ${status.turnActive ? 'is-running' : ''}`}
      onClick={() => onSelectThread(thread.thread_id, thread.project)}
      title={thread.title}
    >
      <span className="nested-thread-title">{thread.title}</span>

      {status.lifecycleLabel && (
        <span
          className={`thread-status-badge ${status.lifecycleClass}`}
          title={thread.resumable ? '可恢复的历史会话' : undefined}
        >
          {status.lifecycleLabel}
        </span>
      )}

      {status.processLabel && (
        <span
          className={`thread-process-badge ${status.turnActive ? 'active' : 'standby'}`}
          title={
            status.turnActive
              ? 'Session 进程在线，当前 Turn 正在运行'
              : 'Session 进程在线，当前没有活跃 Turn'
          }
        >
          {status.processLabel}
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

        <button
          className="btn-thread-menu-trigger"
          onClick={(event) => {
            event.stopPropagation();
            onToggleMenu(threadKey);
          }}
          title="会话选项"
        >
          <MoreVertical size={12} />
        </button>
      </div>

      {activeMenuThread === threadKey && (
        <div
          className="thread-action-popover"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="popover-btn"
            onClick={(event) => onAction(event, 'rename', thread)}
          >
            <Edit2 size={12} />
            <span>重命名</span>
          </button>
          <button
            className="popover-btn"
            onClick={(event) => onAction(event, 'summary', thread)}
          >
            <FileText size={12} />
            <span>指定摘要</span>
          </button>
          <button
            className="popover-btn"
            onClick={(event) => onAction(event, 'fork', thread)}
          >
            <GitFork size={12} />
            <span>派生分支</span>
          </button>
          {thread.thread_id !== 'default' && (
            <button
              className="popover-btn danger"
              onClick={(event) => onAction(event, 'close', thread)}
            >
              <Trash2 size={12} />
              <span>关闭会话</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
