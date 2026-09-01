import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';
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
    } else if (action === 'rename') {
      const newTitle = prompt('重命名会话标题:', thread.title);
      if (newTitle && newTitle.trim()) {
        onRenameThread(thread.thread_id, newTitle.trim());
      }
    } else if (action === 'summary') {
      const newSummary = prompt('指定会话摘要:', thread.summary);
      if (newSummary !== null) {
        onUpdateSummary(thread.thread_id, newSummary.trim());
      }
    } else if (action === 'close') {
      if (confirm(`确定要关闭会话 "${thread.title}" 吗？`)) {
        onCloseThread(thread.thread_id);
      }
    }
  };

  const renderThreadItem = (thread) => {
    const isActive = thread.thread_id === currentThread;
    const isMenuOpen = activeMenuThread === thread.thread_id;

    return (
      <div
        key={thread.thread_id}
        className={`thread-item ${isActive ? 'active' : ''}`}
        onClick={() => {
          setActiveMenuThread(null);
          onSelectThread(thread.thread_id);
        }}
      >
        <div className="thread-main">
          <div className="thread-icon-wrap">
            {thread.pinned ? (
              <Pin size={13} className="pin-icon" />
            ) : isActive ? (
              <MessageSquare size={13} className="active-icon" />
            ) : (
              <Clock size={13} className="clock-icon" />
            )}
          </div>

          <div className="thread-content-text">
            <span className="thread-title" title={thread.title}>
              {thread.title}
            </span>
            {thread.summary && (
              <span className="thread-summary-preview" title={thread.summary}>
                {thread.summary}
              </span>
            )}
          </div>
        </div>

        <div className="thread-actions-wrap" onClick={(e) => e.stopPropagation()}>
          <button
            className={`btn-more ${isMenuOpen ? 'open' : ''}`}
            onClick={() => setActiveMenuThread(isMenuOpen ? null : thread.thread_id)}
            title="更多操作"
          >
            <MoreVertical size={13} />
          </button>

          {isMenuOpen && (
            <div className="thread-popup-menu">
              <button onClick={(e) => handleAction(e, 'rename', thread)}>
                <Edit2 size={12} />
                <span>重命名</span>
              </button>
              <button onClick={(e) => handleAction(e, 'summary', thread)}>
                <FileText size={12} />
                <span>设置摘要</span>
              </button>
              <button onClick={(e) => handleAction(e, 'fork', thread)}>
                <GitFork size={12} />
                <span>派生分支 (Fork)</span>
              </button>
              {thread.thread_id !== 'default' && (
                <button className="danger" onClick={(e) => handleAction(e, 'close', thread)}>
                  <Trash2 size={12} />
                  <span>关闭会话</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <aside className="app-sidebar" onClick={() => setActiveMenuThread(null)}>
      {/* Top Header & Search */}
      <div className="sidebar-header">
        <button className="btn-new-chat" onClick={onNewThread}>
          <Plus size={15} />
          <span>新对话 (New Thread)</span>
        </button>

        <div className="sidebar-search-box">
          <Search size={13} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="搜索历史会话 / 摘要..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Grouped Thread List */}
      <div className="sidebar-list custom-scrollbar">
        {groupedThreads.pinned.length > 0 && (
          <div className="thread-group">
            <div className="group-header">
              <Pin size={11} />
              <span>置顶会话 (Pinned)</span>
            </div>
            {groupedThreads.pinned.map(renderThreadItem)}
          </div>
        )}

        {groupedThreads.today.length > 0 && (
          <div className="thread-group">
            <div className="group-header">今天 (Today)</div>
            {groupedThreads.today.map(renderThreadItem)}
          </div>
        )}

        {groupedThreads.yesterday.length > 0 && (
          <div className="thread-group">
            <div className="group-header">昨天 (Yesterday)</div>
            {groupedThreads.yesterday.map(renderThreadItem)}
          </div>
        )}

        {groupedThreads.lastWeek.length > 0 && (
          <div className="thread-group">
            <div className="group-header">过去 7 天 (Previous 7 Days)</div>
            {groupedThreads.lastWeek.map(renderThreadItem)}
          </div>
        )}

        {groupedThreads.older.length > 0 && (
          <div className="thread-group">
            <div className="group-header">更早 (Older)</div>
            {groupedThreads.older.map(renderThreadItem)}
          </div>
        )}

        {threads.length === 0 && (
          <div className="sidebar-empty">
            <span>暂无历史会话</span>
          </div>
        )}
      </div>

      {/* Bottom Bar */}
      <div className="sidebar-footer">
        <div className="footer-status font-mono">
          <span className="dot-live"></span>
          <span>App Server v0.6.0</span>
        </div>
        <button
          className="btn-refresh"
          onClick={onRefreshThreads}
          title="刷新会话列表"
        >
          <RefreshCw size={13} />
        </button>
      </div>
    </aside>
  );
}
