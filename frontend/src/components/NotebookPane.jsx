import React, { useEffect, useState } from 'react';
import { BookOpen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../api';

function NotebookList({ title, data, readOnly, onForget }) {
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  return (
    <section className="notebook-section">
      <div className="pane-section-header">
        <span className="section-title">{title}</span>
        <span className="text-muted text-xs">{readOnly ? '只读' : '当前 Session'}</span>
      </div>
      {entries.length === 0 ? (
        <div className="loading-placeholder">{data?.available === false ? '父级 Notebook 不可用' : '暂无条目'}</div>
      ) : (
        <div className="notebook-entry-list">
          {entries.map((entry) => (
            <div className="notebook-entry" key={entry.key}>
              <div className="notebook-entry-head">
                <strong>{entry.key}</strong>
                <span className={`status-pill ${entry.importance || 'normal'}`}>{entry.importance || 'normal'}</span>
                {!readOnly && (
                  <button type="button" className="btn-icon-small" title="遗忘此条目" onClick={() => onForget(entry.key)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {entry.keywords?.length > 0 && (
                <div className="notebook-entry-keywords">关键词：{entry.keywords.join('、')}</div>
              )}
              <div className="notebook-entry-content">{entry.content}</div>
              {entry.evidence?.length > 0 && (
                <div className="notebook-entry-evidence">
                  {entry.evidence.map((item, index) => (
                    <span key={`${item.kind}-${item.commit || item.path || index}`}>
                      {item.kind === 'commit' ? 'commit' : 'file'}：{item.subject || item.path || item.commit || '证据'}
                      {item.committed_at ? ` · ${item.committed_at}` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function NotebookPane({ threadId, projectId, onToast }) {
  const [self, setSelf] = useState(null);
  const [parent, setParent] = useState(null);
  const [key, setKey] = useState('');
  const [content, setContent] = useState('');
  const [importance, setImportance] = useState('normal');
  const [keywords, setKeywords] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [own, parentSnapshot] = await Promise.all([
        api.readNotebook(threadId, { projectId }),
        api.readNotebook(threadId, { projectId, scope: 'parent' }),
      ]);
      setSelf(own);
      setParent(parentSnapshot);
    } catch (err) {
      onToast?.(`读取 Notebook 失败: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [threadId, projectId]);

  const save = async (event) => {
    event.preventDefault();
    if (!key.trim() || !content.trim()) return;
    try {
      await api.writeNotebook(threadId, {
        key: key.trim(),
        content: content.trim(),
        importance,
        keywords: keywords.split(',').map((item) => item.trim()).filter(Boolean),
      }, { projectId });
      setKey('');
      setContent('');
      setKeywords('');
      await load();
      onToast?.('Notebook 已更新', 'success');
    } catch (err) {
      onToast?.(`更新 Notebook 失败: ${err.message}`, 'error');
    }
  };

  const search = async (event) => {
    event.preventDefault();
    if (!query.trim()) return load();
    try {
      setSelf(await api.searchNotebook(threadId, query.trim(), { projectId }));
    } catch (err) {
      onToast?.(`检索 Notebook 失败: ${err.message}`, 'error');
    }
  };

  const forget = async (entryKey) => {
    try {
      await api.forgetNotebook(threadId, entryKey, { projectId });
      await load();
      onToast?.(`已遗忘 Notebook 条目: ${entryKey}`, 'info');
    } catch (err) {
      onToast?.(`遗忘 Notebook 条目失败: ${err.message}`, 'error');
    }
  };

  return (
    <div className="tab-pane notebook-pane">
      <div className="pane-section-header">
        <span className="section-title"><BookOpen size={14} /> Session Notebook</span>
        <button type="button" className="btn-action-small" onClick={load} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>
      <p className="text-muted text-xs">当前 Session 可编辑；父级 Notebook 仅供 Child 只读继承，不会被子任务改写。</p>
      <form className="notebook-search" onSubmit={search}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按条目、关键词、commit 或文件检索" maxLength={128} />
        <button type="submit" className="btn-action-small">检索</button>
      </form>
      <form className="notebook-compose" onSubmit={save}>
        <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="条目名称" maxLength={128} />
        <input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="关键词，用逗号分隔" maxLength={768} />
        <select value={importance} onChange={(event) => setImportance(event.target.value)} aria-label="重要性">
          <option value="critical">critical</option>
          <option value="high">high</option>
          <option value="normal">normal</option>
          <option value="temporary">temporary</option>
        </select>
        <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="写入可复用的 Session 事实或决策" maxLength={32768} />
        <button type="submit" className="btn-action-small"><Plus size={12} /> 保存</button>
      </form>
      <NotebookList title="当前 Session" data={self} onForget={forget} />
      <NotebookList title="父级 Session 快照" data={parent} readOnly />
    </div>
  );
}
