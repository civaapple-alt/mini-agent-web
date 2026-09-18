import React from 'react';
import {
  Circle,
  Copy,
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
      title={thread.session_id ? `${thread.title}\nSession ID: ${thread.session_id}` : thread.title}
    >
      <div className="nested-thread-copy">
        <span className="nested-thread-title">{thread.title}</span>
        {thread.session_id && (
          <span
            className="nested-thread-session-id font-mono"
            title={`实际 Session ID: ${thread.session_id}`}
          >
            {thread.session_id}
          </span>
        )}
      </div>

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
          {thread.session_id && (
            <button
              className="popover-btn"
              onClick={(event) => onAction(event, 'copy_session_id', thread)}
            >
              <Copy size={12} />
              <span>复制 Session ID</span>
            </button>
          )}
          <button
            className="popover-btn"
            onClick={(event) => onAction(event, 'fork', thread)}
          >
            <GitFork size={12} />
            <span>精确派生（默认）</span>
          </button>
          <button
            className="popover-btn"
            onClick={(event) => onAction(event, 'fork_compact', thread)}
          >
            <GitFork size={12} />
            <span>派生并压缩</span>
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
