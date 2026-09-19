import React from 'react';
import {
  Copy,
  Edit2,
  FileText,
  GitFork,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { getThreadStatusPresentation } from '../../utils/threadStatus';
import { formatRelativeTime, parseActivityTime } from '../../utils/relativeTime';

export default function ThreadRow({
  thread,
  now,
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
  const isRunning = status.isRunning || (isSelected && isGenerating);
  const threadKey = `${thread.project || 'unknown'}:${thread.thread_id}`;
  const relativeTime = formatRelativeTime(thread.updated_at, now);
  const activityTimestamp = parseActivityTime(thread.updated_at);
  const rowTitle = [
    thread.title,
    thread.session_id ? `Session ID: ${thread.session_id}` : null,
    activityTimestamp !== null
      ? `最近活动：${new Date(activityTimestamp).toLocaleString()}`
      : '最近活动时间未知',
  ].filter(Boolean).join('\n');

  return (
    <div
      className={`nested-thread-item ${isSelected ? 'selected' : ''} ${isRunning ? 'is-running' : ''}`}
      onClick={() => onSelectThread(thread.thread_id, thread.project)}
      title={rowTitle}
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
        <span className="nested-thread-updated-at">{relativeTime}</span>
      </div>

      {isRunning && (
        <span
          className="thread-status-badge running"
          title="当前 Turn 正在运行"
        >
          运行中
        </span>
      )}

      <div className="thread-tail-indicators">
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
