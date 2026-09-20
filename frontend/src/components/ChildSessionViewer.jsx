import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { api } from '../api';
import MessageItem from './MessageItem';
import {
  aggregateThreadItems,
  filterEmptyMessages,
  orderMessagesByTurnHistory,
} from '../utils/messageState';
import { collectInputMessages } from '../utils/inputTrace';
import {
  childTaskStatusLabels,
  formatChildTaskDuration,
  formatChildTaskTimestamp,
  getChildTaskStatus,
  getLatestChildTaskReport,
} from '../utils/childTasks';

const ITEM_PAGE_SIZE = 128;
const REFRESH_INTERVAL_MS = 3000;
const ACTIVE_CHILD_STATUSES = new Set([
  'running',
  'in_progress',
  'awaiting_approval',
  'cancelling',
]);

function itemKey(entry) {
  const item = entry?.item || {};
  return `${entry?.turnId || entry?.turn_id || ''}:${item.id || item.type || ''}:${item.text || ''}`;
}

function mergeEntries(earlier, later) {
  const entriesByKey = new Map();
  for (const entry of [...earlier, ...later]) entriesByKey.set(itemKey(entry), entry);
  return [...entriesByKey.values()];
}

function projectChildMessages(entries, child, projectId) {
  const scope = { threadId: child.child_thread_id, projectId };
  const inputs = collectInputMessages([], entries, scope);
  const hydrated = aggregateThreadItems(inputs, entries);
  return filterEmptyMessages(orderMessagesByTurnHistory(hydrated, entries));
}

function formatElapsedSince(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return formatChildTaskDuration(Math.max(0, Date.now() - timestamp));
}

function getTaskResultText(result) {
  if (typeof result === 'string') return result.trim() || null;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  for (const key of ['summary', 'text', 'result', 'content']) {
    const value = result[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function isRunning(checkpoint, child) {
  return Boolean(checkpoint?.turn_active ?? checkpoint?.session?.turn_active)
    || ACTIVE_CHILD_STATUSES.has(String(child.status || '').toLowerCase());
}

export default function ChildSessionViewer({
  child,
  projectId,
  onBack,
}) {
  const childProjectId = child.project_id || projectId;
  const [checkpoint, setCheckpoint] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [olderCursor, setOlderCursor] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const requestRef = useRef(null);
  const checkpointRef = useRef(null);
  const mountedRef = useRef(false);
  const pinnedToBottomRef = useRef(true);
  const transcriptRef = useRef(null);
  const entriesRef = useRef([]);
  const latestKeysRef = useRef(null);
  const olderCursorRef = useRef(null);
  const olderScrollPositionRef = useRef(null);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    if (!quiet && checkpointRef.current) setRefreshing(true);
    else if (!checkpointRef.current) setLoading(true);
    try {
      const [nextCheckpoint, page] = await Promise.all([
        api.readThread(child.child_thread_id, {
          projectId: childProjectId,
          signal: controller.signal,
        }),
        api.listThreadItems(child.child_thread_id, {
          projectId: childProjectId,
          limit: ITEM_PAGE_SIZE,
          sortDirection: 'desc',
          signal: controller.signal,
        }),
      ]);
      if (!mountedRef.current || controller.signal.aborted) return;
      const newest = [...(Array.isArray(page.data) ? page.data : [])].reverse();
      const newestKeys = new Set(newest.map(itemKey));
      if (latestKeysRef.current) {
        const newItemCount = [...newestKeys].filter((key) => !latestKeysRef.current.has(key)).length;
        if (newItemCount > 0 && olderCursorRef.current) {
          olderCursorRef.current = String(Number(olderCursorRef.current) + newItemCount);
        }
      } else {
        olderCursorRef.current = page.next_cursor || page.nextCursor || null;
      }
      latestKeysRef.current = newestKeys;
      entriesRef.current = mergeEntries(entriesRef.current, newest);
      checkpointRef.current = nextCheckpoint;
      setCheckpoint(nextCheckpoint);
      setEntries(entriesRef.current);
      setOlderCursor(olderCursorRef.current);
      setError(null);
      setLastUpdatedAt(Date.now());
    } catch (requestError) {
      if (!mountedRef.current || requestError?.name === 'AbortError') return;
      setError(requestError.message || '读取子 Session 失败');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [child.child_thread_id, childProjectId]);

  useEffect(() => {
    mountedRef.current = true;
    entriesRef.current = [];
    latestKeysRef.current = null;
    olderCursorRef.current = null;
    checkpointRef.current = null;
    setCheckpoint(null);
    setEntries([]);
    setOlderCursor(null);
    setError(null);
    setLoading(true);
    void refresh();
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [child.child_thread_id, childProjectId, refresh]);

  useEffect(() => {
    if (!isRunning(checkpoint, child)) return undefined;
    const timer = window.setInterval(() => void refresh({ quiet: true }), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [checkpoint, child.status, refresh]);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const olderScrollPosition = olderScrollPositionRef.current;
    if (olderScrollPosition) {
      transcript.scrollTop = olderScrollPosition.scrollTop
        + transcript.scrollHeight
        - olderScrollPosition.scrollHeight;
      olderScrollPositionRef.current = null;
      return;
    }
    if (pinnedToBottomRef.current) transcript.scrollTop = transcript.scrollHeight;
  }, [entries, checkpoint]);

  const messages = useMemo(
    () => projectChildMessages(entries, child, childProjectId),
    [entries, child, childProjectId],
  );
  const lastAssistantIndexByTurn = useMemo(() => {
    const indexByTurn = new Map();
    messages.forEach((message, index) => {
      if (message?.role === 'assistant' && message?.turnId) {
        indexByTurn.set(String(message.turnId), index);
      }
    });
    return indexByTurn;
  }, [messages]);
  const running = isRunning(checkpoint, child);
  const status = getChildTaskStatus(child);
  const failure = checkpoint?.last_turn_error || checkpoint?.session?.last_turn_error;
  const failed = !running && (status === 'failed' || ['failed', 'error'].includes(String(
    checkpoint?.last_turn_status || checkpoint?.session?.last_turn_status || '',
  ).toLowerCase()));
  const latestReport = getLatestChildTaskReport(child);
  const startedAt = child.started_at_ms || child.started_at;
  const duration = child.duration_ms != null
    ? formatChildTaskDuration(child.duration_ms)
    : running
      ? formatElapsedSince(startedAt)
      : null;
  const parentThreadId = child.parent_thread_id
    || checkpoint?.parent_thread_id
    || checkpoint?.session?.parent_thread_id;
  const parentCheckpointSeq = child.parent_checkpoint_seq
    ?? checkpoint?.parent_checkpoint_seq
    ?? checkpoint?.session?.parent_checkpoint_seq;
  const finalReply = [...messages].reverse().find((message) => (
    message.role === 'assistant' && String(message.text || '').trim()
  ))?.text || getTaskResultText(child.result);
  const failureDetail = failure || child.error || child.operation_error;

  const loadOlder = async () => {
    if (!olderCursorRef.current || loadingOlder || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoadingOlder(true);
    try {
      const page = await api.listThreadItems(child.child_thread_id, {
        projectId: childProjectId,
        limit: ITEM_PAGE_SIZE,
        cursor: olderCursorRef.current,
        sortDirection: 'desc',
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted) return;
      const older = [...(Array.isArray(page.data) ? page.data : [])].reverse();
      const merged = mergeEntries(older, entriesRef.current);
      if (merged.length > entriesRef.current.length && transcriptRef.current) {
        olderScrollPositionRef.current = {
          scrollTop: transcriptRef.current.scrollTop,
          scrollHeight: transcriptRef.current.scrollHeight,
        };
      }
      entriesRef.current = merged;
      setEntries(entriesRef.current);
      olderCursorRef.current = page.next_cursor || page.nextCursor || null;
      setOlderCursor(olderCursorRef.current);
    } catch (requestError) {
      if (requestError?.name !== 'AbortError') setError(requestError.message || '读取更早活动失败');
    } finally {
      if (mountedRef.current) setLoadingOlder(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  return (
    <section className="child-session-view" aria-label="子代理消息流">
      <header className="child-session-view-header">
        <button type="button" className="btn-action-small" onClick={onBack}>
          <ArrowLeft size={13} />
          <span>返回子任务</span>
        </button>
        <div className="child-session-view-heading">
          <strong title={child.title || child.child_thread_id}>
            {child.title || child.child_thread_id}
          </strong>
          <span className={`child-task-status ${running ? 'running' : status}`}>
            {running ? '运行中' : (childTaskStatusLabels[status] || status)}
          </span>
        </div>
        <button
          type="button"
          className="btn-action-small"
          onClick={() => void refresh()}
          disabled={refreshing || loading}
          title="刷新子代理活动"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          <span>刷新</span>
        </button>
      </header>

      <section className={`child-session-overview ${running ? 'running' : failed ? 'failed' : 'finished'}`}>
        <div className="child-session-overview-heading">
          <strong>{running ? '子代理正在执行' : failed ? '子代理执行失败' : '子代理已结束'}</strong>
          {duration && <span className="font-mono">{running ? '已运行' : '耗时'} {duration}</span>}
        </div>
        {parentThreadId && (
          <div className="child-session-source">
            来源父会话 <span className="font-mono">{parentThreadId}</span>
            {Number.isFinite(parentCheckpointSeq) && ` · checkpoint ${parentCheckpointSeq}`}
            {' · '}这里只显示子会话自己的活动
          </div>
        )}
        {running && latestReport && (
          <div className="child-session-latest-report">
            <span>最新进展</span>
            <p>{latestReport.text}</p>
            {latestReport.timestamp_ms && (
              <time>{formatChildTaskTimestamp(latestReport.timestamp_ms)}</time>
            )}
          </div>
        )}
        {!running && !failed && finalReply && (
          <div className="child-session-final-reply">
            <span>最终回复</span>
            <p>{finalReply}</p>
          </div>
        )}
        {failed && failureDetail && (
          <div className="child-session-final-error">{failureDetail}</div>
        )}
      </section>

      {error && <div className="child-session-view-error" role="alert">{error}</div>}
      {olderCursor && (
        <button
          type="button"
          className="child-session-load-older"
          onClick={() => void loadOlder()}
          disabled={loadingOlder}
        >
          {loadingOlder ? '正在加载…' : '加载更早的活动'}
        </button>
      )}

      <div
        className="child-session-transcript"
        ref={transcriptRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinnedToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
      >
        {loading && messages.length === 0 ? (
          <div className="child-session-empty">正在加载子代理消息流…</div>
        ) : messages.length === 0 ? (
          <div className="child-session-empty">
            <strong>暂无子代理活动</strong>
            <span>此处只显示子 Session 自己持久化的消息与工具活动。早期任务如果没有本地活动记录，不会回填父会话 checkpoint 内容。</span>
          </div>
        ) : (
          <div className="child-session-messages">
            {messages.map((message, index) => (
              <MessageItem
                key={message.id || `child-message-${index}`}
                message={message}
                isLast={index === messages.length - 1}
                isLastInTurn={message.turnId
                  ? lastAssistantIndexByTurn.get(String(message.turnId)) === index
                  : index === messages.length - 1}
                isGenerating={running}
                pendingApproval={null}
                policy="read_only"
              />
            ))}
          </div>
        )}
      </div>
      <footer className="child-session-view-footer">
        <span>{entries.length ? `已加载 ${entries.length} 条活动` : '只读查看子 Session'}</span>
        {lastUpdatedAt && <time>{new Date(lastUpdatedAt).toLocaleTimeString()}</time>}
      </footer>
    </section>
  );
}
