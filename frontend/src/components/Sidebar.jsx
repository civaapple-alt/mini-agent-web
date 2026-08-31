import React from 'react';
import { Plus, MessageSquare, Hash, GitFork, Trash2, RefreshCw } from 'lucide-react';
import './Sidebar.css';

export default function Sidebar({
  threads,
  currentThread,
  onSelectThread,
  onNewThread,
  onForkThread,
  onCloseThread,
  onRefreshThreads,
}) {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-top">
        <button className="btn-new-chat" onClick={onNewThread}>
          <Plus size={15} />
          <span>新对话 (New Thread)</span>
        </button>
      </div>

      <div className="sidebar-list">
        {threads.map((tid) => {
          const isActive = tid === currentThread;
          return (
            <div
              key={tid}
              className={`thread-item ${isActive ? 'active' : ''}`}
              onClick={() => onSelectThread(tid)}
            >
              <div className="thread-info">
                {isActive ? (
                  <MessageSquare size={14} className="thread-icon active" />
                ) : (
                  <Hash size={14} className="thread-icon" />
                )}
                <span className="thread-label" title={tid}>{tid}</span>
              </div>

              <div className="thread-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="action-btn"
                  title="派生分支 (Fork)"
                  onClick={() => onForkThread(tid)}
                >
                  <GitFork size={13} />
                </button>
                {tid !== 'default' && (
                  <button
                    className="action-btn danger"
                    title="关闭会话"
                    onClick={() => onCloseThread(tid)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="sidebar-bottom">
        <span className="server-status-label">App Server: Connected</span>
        <button
          className="refresh-btn"
          onClick={onRefreshThreads}
          title="刷新会话列表"
        >
          <RefreshCw size={13} />
        </button>
      </div>
    </aside>
  );
}
