import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { api } from '../api';
import MessageItem from './MessageItem';
import {
  assignHistoryTurnIds,
  aggregateThreadItems,
  filterEmptyMessages,
  orderMessagesByTurnHistory,
  restorePersistedTurnPresentation,
} from '../utils/messageState';
import {
  cleanInputText,
  collectInputMessages,
  isInternalCompactionMessage,
} from '../utils/inputTrace';
import { childTaskStatusLabels, getChildTaskStatus } from '../utils/childTasks';

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

function projectChildMessages(checkpoint, entries, child, projectId) {
  const rawMessages = assignHistoryTurnIds(checkpoint?.messages || [], entries);
  const messages = rawMessages.reduce((result, message, index) => {
    if (isInternalCompactionMessage(message)) return result;
    if (message.role !== 'user' && message.role !== 'assistant') return result;

    const reasoning = message.reasoning || message.thinking || '';
    const text = message.role === 'user' ? cleanInputText(message.text) : (message.text || '');
    result.push({
      id: message.id || `child-history-${child.child_thread_id}-${index}`,
      role: message.role,
      turnId: message.turnId || null,
      text,
      thinking: reasoning,
      tools: [],
      toolCallIds: [],
      blocks: [
        ...(reasoning ? [{ type: 'thinking', id: `${message.id || index}:thinking`, content: reasoning }] : []),
        ...(text ? [{ type: 'text', id: `${message.id || index}:text`, content: text }] : []),
      ],
    });
    return result;
  }, []);

  const scope = { threadId: child.child_thread_id, projectId };
  const inputs = collectInputMessages(messages, entries, scope);
  const withInputs = [...messages];
  for (const input of inputs) {
    const inputTurnId = input.turnId ? String(input.turnId) : null;
    const alreadyRendered = withInputs.some((message) => (
      message.role === 'user'
      && (inputTurnId && message.turnId
        ? String(message.turnId) === inputTurnId
        : String(message.text || '').trim() === String(input.text || '').trim())
    ));
    if (alreadyRendered) continue;
    const assistantIndex = inputTurnId
      ? withInputs.findIndex((message) => (
        message.role === 'assistant' && String(message.turnId || '') === inputTurnId
      ))
      : -1;
    if (assistantIndex >= 0) withInputs.splice(assistantIndex, 0, input);
    else withInputs.push(input);
  }

  const presentations = checkpoint?.presentations || checkpoint?.session?.presentations || [];
  const restored = restorePersistedTurnPresentation(withInputs, entries, presentations);
  const hydrated = aggregateThreadItems(restored, entries);
  return filterEmptyMessages(orderMessagesByTurnHistory(hydrated, entries));
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

  useEffect(() => {
    if (!pinnedToBottomRef.current || !transcriptRef.current) return;
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [entries, checkpoint]);

  const messages = useMemo(
    () => projectChildMessages(checkpoint, entries, child, childProjectId),
    [checkpoint, entries, child, childProjectId],
  );
  const running = isRunning(checkpoint, child);
  const status = getChildTaskStatus(child);
  const failure = checkpoint?.last_turn_error || checkpoint?.session?.last_turn_error;
  const failed = !running && (status === 'failed' || ['failed', 'error'].includes(String(
    checkpoint?.last_turn_status || checkpoint?.session?.last_turn_status || '',
  ).toLowerCase()));

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
      entriesRef.current = mergeEntries(older, entriesRef.current);
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

      {error && <div className="child-session-view-error" role="alert">{error}</div>}
      {failed && failure && (
        <div className="child-session-view-error" role="status">子任务执行失败：{failure}</div>
      )}
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
          <div className="child-session-empty">子 Session 暂无可显示的消息</div>
        ) : (
          <div className="child-session-messages">
            {messages.map((message, index) => (
              <MessageItem
                key={message.id || `child-message-${index}`}
                message={message}
                isLast={index === messages.length - 1}
                isGenerating={running}
                pendingApproval={null}
                policy="read_only"
              />
            ))}
          </div>
        )}
      </div>
      <footer className="child-session-view-footer">
        <span>{entries.length ? `显示最近 ${entries.length} 条活动` : '只读查看子 Session'}</span>
        {lastUpdatedAt && <time>{new Date(lastUpdatedAt).toLocaleTimeString()}</time>}
      </footer>
    </section>
  );
}
