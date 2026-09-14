import React, { useEffect, useMemo, useRef } from 'react';
import { Activity, Edit3, History, Image, Paperclip } from 'lucide-react';
import {
  collectInputMessages,
  getInputTrace,
  getInputTraceSourceLabel,
  INPUT_TRACE_ACCESS_LABELS,
  INPUT_TRACE_CONTINUATION_LABELS,
  INPUT_TRACE_POLICY_LABELS,
} from '../utils/inputTrace';
import './ThreadHistoryPane.css';

function formatTimestamp(value) {
  if (!value) return '历史时间未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未记录';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function executionLabel(execution) {
  if (!execution) return '历史设置未记录';
  return [
    INPUT_TRACE_ACCESS_LABELS[execution.accessScope] || execution.accessScope,
    INPUT_TRACE_POLICY_LABELS[execution.policy] || execution.policy,
    INPUT_TRACE_CONTINUATION_LABELS[execution.continuationMode]
      || execution.continuationMode,
  ].filter(Boolean).join(' · ') || '设置未记录';
}

export default function ThreadHistoryPane({
  messages = [],
  threadId = 'default',
  projectId = null,
  focusMessageId = null,
  onAdjustPrompt,
}) {
  const itemRefs = useRef(new Map());
  const inputMessages = useMemo(() => collectInputMessages(messages), [messages]);

  useEffect(() => {
    if (!focusMessageId) return;
    const item = itemRefs.current.get(focusMessageId);
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'center' });
    }
  }, [focusMessageId, inputMessages.length]);

  return (
    <div className="thread-history-pane" data-testid="thread-history-pane">
      <div className="thread-history-heading">
        <div>
          <div className="thread-history-title">
            <History size={15} />
            <span>Thread 输入历史</span>
          </div>
          <p>当前已加载 {inputMessages.length} 条用户输入；内容来自当前 Thread 的历史投影。</p>
        </div>
        <Activity size={16} className="thread-history-heading-icon" aria-hidden="true" />
      </div>

      <div className="thread-history-scope font-mono">
        {projectId || '未绑定项目'} / {threadId}
      </div>

      {inputMessages.length === 0 ? (
        <div className="thread-history-empty">
          <History size={18} />
          <span>当前 Thread 还没有用户输入记录。</span>
        </div>
      ) : (
        <div className="thread-history-list">
          {inputMessages.map((message, index) => {
            const trace = getInputTrace(message, { threadId, projectId });
            const imageCount = trace.attachments?.imageCount || 0;
            const fileCount = trace.attachments?.referencedFiles?.length || 0;
            const isFocused = message.id === focusMessageId;
            return (
              <article
                key={message.id || `history_${index}`}
                ref={(element) => {
                  if (element && message.id) itemRefs.current.set(message.id, element);
                  else if (message.id) itemRefs.current.delete(message.id);
                }}
                className={`thread-history-entry ${isFocused ? 'is-focused' : ''}`}
                data-message-id={message.id}
              >
                <div className="thread-history-entry-header">
                  <span className="thread-history-source">
                    {getInputTraceSourceLabel(trace.source)}
                  </span>
                  <span className="thread-history-time">{formatTimestamp(trace.capturedAt)}</span>
                </div>
                <div className="thread-history-prompt">
                  {message.text || (imageCount > 0 ? '（图片输入）' : '（空输入）')}
                </div>
                <div className="thread-history-meta">
                  <span className="font-mono">Turn: {trace.scope?.turnId || '未分配'}</span>
                  <span title={executionLabel(trace.execution)}>
                    执行：{executionLabel(trace.execution)}
                  </span>
                  {trace.attachments?.known === false ? (
                    <span>附件：历史投影未提供明细</span>
                  ) : (
                    <span className="thread-history-attachments">
                      {imageCount > 0 && <><Image size={11} /> {imageCount}</>}
                      {fileCount > 0 && <><Paperclip size={11} /> {fileCount}</>}
                      {imageCount === 0 && fileCount === 0 && '无附件'}
                    </span>
                  )}
                </div>
                <div className="thread-history-entry-footer">
                  <span className="thread-history-entry-scope font-mono">
                    {trace.scope?.projectId || projectId || '未绑定项目'} / {trace.scope?.threadId || threadId}
                  </span>
                  {onAdjustPrompt && !message.isGoal && (
                    <button
                      type="button"
                      onClick={() => onAdjustPrompt(message)}
                      title="将这条输入放回编辑器"
                    >
                      <Edit3 size={11} />
                      调整输入
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
