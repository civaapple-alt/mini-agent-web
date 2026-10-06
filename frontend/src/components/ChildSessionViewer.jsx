import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { api } from '../api';
import MessageItem from './MessageItem';
import TurnReconciliationForm from './TurnReconciliationForm';
import {
  filterEmptyMessages,
  aggregateStreamEvent,
  orderMessagesByTurnHistory,
  restorePersistedTurnPresentation,
} from '../utils/messageState';
import { cleanInputText, collectInputMessages, createInputTrace } from '../utils/inputTrace';
import { subscribeChildRuntimeEvents } from '../utils/childRuntimeEvents';
import {
  childTaskStatusLabels,
  formatChildTaskDuration,
  formatChildTaskTimestamp,
  getChildTaskPhaseLabel,
  getChildTaskStatus,
  getChildExecutionResumeRequestId,
  getLatestChildTaskReport,
} from '../utils/childTasks';

const ITEM_PAGE_SIZE = 128;
const REFRESH_INTERVAL_MS = 3000;
const EVENT_PAGE_SIZE = 128;
const MAX_EVENT_PAGES_PER_REFRESH = 4;
const MAX_LIVE_EVENTS = 512;
const ACTIVE_CHILD_STATUSES = new Set([
  'running',
  'in_progress',
  'awaiting_approval',
  'awaiting_user_input',
  'cancelling',
]);
const QUEUED_CHILD_STATUSES = new Set(['pending', 'queued', 'starting', 'not_started']);

function itemKey(entry) {
  const item = entry?.item || {};
  return `${entry?.turnId || entry?.turn_id || ''}:${item.id || item.type || ''}:${item.text || ''}`;
}

function mergeEntries(earlier, later) {
  const entriesByKey = new Map();
  for (const entry of [...earlier, ...later]) entriesByKey.set(itemKey(entry), entry);
  return [...entriesByKey.values()];
}

function projectChildMessages(entries, child, projectId, steerRequests = []) {
  const scope = { threadId: child.child_thread_id, projectId };
  const inputs = collectInputMessages([], entries, scope);
  const hydrated = restorePersistedTurnPresentation(inputs, entries);
  const messages = filterEmptyMessages(orderMessagesByTurnHistory(hydrated, entries)).map((message) => (
    message.isSteer ? { ...message, steerOrigin: 'parent_session' } : message
  ));
  const liveSteers = [];
  const matchedMessageIndexes = new Set();

  for (const steer of steerRequests || []) {
    const requestId = steer?.requestId || steer?.request_id;
    const turnId = steer?.turnId || steer?.turn_id;
    const text = cleanInputText(steer?.text);
    if (!requestId || !turnId || !text) continue;
    const existingIndex = messages.findLastIndex((message, index) => (
      !matchedMessageIndexes.has(index)
      && message.role === 'user'
      && message.isSteer
      && String(message.turnId || '') === String(turnId)
      && (message.steerRequestId === requestId || cleanInputText(message.text) === text)
    ));
    const delivery = {
      isSteer: true,
      messageKind: 'steer',
      steerOrigin: 'parent_session',
      steerTurnId: turnId,
      steerRequestId: requestId,
      steerApplicationStatus: steer.status || 'accepted',
      steerDeliveryStatus: 'accepted',
      inputSource: 'steer',
    };
    if (existingIndex >= 0) {
      matchedMessageIndexes.add(existingIndex);
      messages[existingIndex] = { ...messages[existingIndex], ...delivery };
      continue;
    }
    liveSteers.push({
      id: `user_steer_${requestId}`,
      role: 'user',
      text,
      turnId,
      ...delivery,
      inputTrace: createInputTrace({
        threadId: child.child_thread_id,
        projectId,
        turnId,
        source: 'steer',
        attachmentText: steer.text,
        historical: true,
      }),
    });
  }

  return [...messages, ...liveSteers];
}

function eventTurnId(event) {
  return event?.turnId || event?.turn_id || null;
}

function eventSequence(event) {
  const value = Number(event?.sequence);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function projectLiveChildMessages(messages, events, turnId, child, includeOperationPrompt) {
  if (!turnId) return messages;
  const turnKey = String(turnId);
  if (messages.some((message) => (
    message.role === 'assistant' && String(message.turnId || '') === turnKey
  ))) return messages;
  const turnEvents = events.filter((event) => String(eventTurnId(event) || '') === turnKey);
  const prompt = [...turnEvents].reverse().find((event) => (
    event.event?.type === 'turn_started' && typeof event.event.prompt === 'string'
  ))?.event.prompt || (includeOperationPrompt
    ? child.operation_prompt || child.child_task_state?.prompt || ''
    : '');
  let projected = messages;

  if (prompt && !projected.some((message) => (
    message.role === 'user' && String(message.turnId || '') === turnKey
  ))) {
    projected = [...projected, {
      id: `child-live-input-${turnKey}`,
      role: 'user',
      text: prompt,
      turnId: turnId,
      historyOrder: Number.MAX_SAFE_INTEGER,
    }];
  }

  for (const event of turnEvents) {
    projected = aggregateStreamEvent(projected, event);
  }
  return filterEmptyMessages(projected);
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

function normalizedResultText(value) {
  return cleanInputText(value).trim().replace(/\s+/g, ' ');
}

function assistantMessageText(message) {
  if (typeof message?.text === 'string' && message.text.trim()) return message.text;
  return (Array.isArray(message?.blocks) ? message.blocks : [])
    .filter((block) => block?.type === 'text' && typeof block.content === 'string')
    .map((block) => block.content)
    .join('\n\n');
}

function hasAssistantResultInMessages(result, messages) {
  const normalizedResult = normalizedResultText(result);
  if (!normalizedResult) return false;
  return (messages || []).some((message) => (
    message?.role === 'assistant'
      && normalizedResultText(assistantMessageText(message)) === normalizedResult
  ));
}

function isRunning(checkpoint, child) {
  const recovery = checkpoint?.execution_recovery
    || checkpoint?.executionRecovery
    || child.execution_recovery
    || child.executionRecovery;
  if (['waiting_for_continue', 'needs_reconciliation', 'settled'].includes(recovery?.status)) {
    return false;
  }
  if (recovery?.status === 'running') return true;
  const status = String(child.status || '').toLowerCase();
  if (ACTIVE_CHILD_STATUSES.has(status)) return true;
  if (QUEUED_CHILD_STATUSES.has(status)
    || ['completed', 'failed', 'cancelled', 'paused', 'step_limit'].includes(status)) return false;
  return Boolean(checkpoint?.turn_active || checkpoint?.session?.turn_active);
}

function hasSettledPersistedActivity(checkpoint, child, entries, projectId) {
  const turnActive = checkpoint?.turn_active ?? checkpoint?.session?.turn_active;
  if (turnActive === true || checkpoint?.active_turn_id || checkpoint?.session?.active_turn_id) return false;
  if (turnActive !== false && isRunning(checkpoint, child)) return false;

  const turnId = checkpoint?.last_turn_id
    || checkpoint?.session?.last_turn_id
    || child.current_turn_id
    || child.turn_id;
  if (!turnId) return false;
  return projectChildMessages(entries, child, projectId).some((message) => (
    message.role === 'assistant' && String(message.turnId || '') === String(turnId)
  ));
}

function groupMessagesByTurn(messages) {
  const groups = [];
  const groupsByKey = new Map();
  for (const [index, message] of messages.entries()) {
    const turnId = message.turnId ? String(message.turnId) : null;
    const key = turnId ? `turn:${turnId}` : `message:${message.id || index}`;
    let group = groupsByKey.get(key);
    if (!group) {
      group = { key, turnId, messages: [] };
      groupsByKey.set(key, group);
      groups.push(group);
    }
    group.messages.push({ message, index });
  }
  return groups;
}

export default function ChildSessionViewer({
  child,
  projectId,
  onBack,
  onControl,
}) {
  const childProjectId = child.project_id || projectId;
  const [checkpoint, setCheckpoint] = useState(null);
  const [entries, setEntries] = useState([]);
  const [steerRequests, setSteerRequests] = useState([]);
  const [contextManifest, setContextManifest] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [olderCursor, setOlderCursor] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [liveEvents, setLiveEvents] = useState([]);
  const [replayHasGap, setReplayHasGap] = useState(false);
  const [replayError, setReplayError] = useState(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const requestRef = useRef(null);
  const checkpointRef = useRef(null);
  const mountedRef = useRef(false);
  const pinnedToBottomRef = useRef(true);
  const transcriptRef = useRef(null);
  const entriesRef = useRef([]);
  const latestKeysRef = useRef(null);
  const olderCursorRef = useRef(null);
  const olderScrollPositionRef = useRef(null);
  const liveEventsRef = useRef(new Map());
  const replayCursorRef = useRef(0);
  const settledTurnPersistedRef = useRef(false);

  const mergeLiveEvents = useCallback((incoming) => {
    let changed = false;
    for (const event of incoming || []) {
      const sequence = eventSequence(event);
      if (sequence === null) continue;
      const normalized = event.type === 'event' ? event : { type: 'event', ...event };
      if (!liveEventsRef.current.has(sequence)) {
        liveEventsRef.current.set(sequence, normalized);
        changed = true;
      }
    }
    if (!changed) return;

    const sequences = [...liveEventsRef.current.keys()].sort((left, right) => left - right);
    while (sequences.length > MAX_LIVE_EVENTS) {
      liveEventsRef.current.delete(sequences.shift());
    }
    setLiveEvents([...liveEventsRef.current.values()].sort(
      (left, right) => eventSequence(left) - eventSequence(right),
    ));
  }, []);

  const replayRuntimeEvents = useCallback(async (signal) => {
    let cursor = replayCursorRef.current;
    for (let pageIndex = 0; pageIndex < MAX_EVENT_PAGES_PER_REFRESH; pageIndex += 1) {
      const page = await api.replayThreadEvents(
        child.child_thread_id,
        cursor,
        EVENT_PAGE_SIZE,
        { projectId: childProjectId, signal },
      );
      if (signal?.aborted) return;
      if (page.has_gap || page.hasGap) {
        setReplayHasGap(!settledTurnPersistedRef.current);
      }
      const data = Array.isArray(page.data) ? page.data : [];
      const nextCursor = Number(page.next_cursor ?? page.nextCursor);
      if (!Number.isSafeInteger(nextCursor) || nextCursor <= cursor) break;
      cursor = nextCursor;
      if (data.length < EVENT_PAGE_SIZE) break;
    }
    if (signal?.aborted || !mountedRef.current) return;
    replayCursorRef.current = Math.max(replayCursorRef.current, cursor);
    setReplayError(null);
  }, [child.child_thread_id, childProjectId]);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    if (!quiet && checkpointRef.current) setRefreshing(true);
    else if (!checkpointRef.current) setLoading(true);
    try {
      const [nextCheckpoint, page, manifest] = await Promise.all([
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
        api.readContextManifest(child.child_thread_id, {
          projectId: childProjectId,
          signal: controller.signal,
        }),
      ]);
      if (!mountedRef.current || controller.signal.aborted) return;
      const turnActive = nextCheckpoint?.turn_active
        ?? nextCheckpoint?.session?.turn_active;
      const activeTurnId = nextCheckpoint?.active_turn_id
        || nextCheckpoint?.activeTurnId
        || nextCheckpoint?.session?.active_turn_id
        || nextCheckpoint?.session?.activeTurnId
        || child.current_turn_id
        || child.turn_id
        || null;
      let nextSteerRequests = [];
      if (activeTurnId && (turnActive === true || (turnActive == null && isRunning(nextCheckpoint, child)))) {
        try {
          const turn = await api.readTurn(child.child_thread_id, activeTurnId, {
            projectId: childProjectId,
            signal: controller.signal,
          });
          nextSteerRequests = turn.steer_requests || turn.steerRequests || [];
        } catch (turnReadError) {
          if (!controller.signal.aborted) {
            console.debug('Failed to read child Turn steering state:', turnReadError);
          }
        }
      }
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
      settledTurnPersistedRef.current = hasSettledPersistedActivity(
        nextCheckpoint,
        {
          child_thread_id: child.child_thread_id,
          current_turn_id: child.current_turn_id,
          status: child.status,
          turn_id: child.turn_id,
        },
        entriesRef.current,
        childProjectId,
      );
      if (settledTurnPersistedRef.current) setReplayHasGap(false);
      setCheckpoint(nextCheckpoint);
      setEntries(entriesRef.current);
      setSteerRequests(nextSteerRequests);
      setContextManifest(Array.isArray(manifest?.data) ? manifest.data : []);
      setOlderCursor(olderCursorRef.current);
      setError(null);
      setLastUpdatedAt(Date.now());
      try {
        await replayRuntimeEvents(controller.signal);
      } catch (replayFailure) {
        if (!controller.signal.aborted) {
          setReplayError(replayFailure.message || '实时事件回放失败');
          console.debug('Failed to replay child runtime events:', replayFailure);
        }
      }
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
  }, [
    child.child_thread_id,
    child.current_turn_id,
    child.status,
    child.turn_id,
    childProjectId,
    replayRuntimeEvents,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    entriesRef.current = [];
    liveEventsRef.current = new Map();
    replayCursorRef.current = 0;
    latestKeysRef.current = null;
    olderCursorRef.current = null;
    checkpointRef.current = null;
    settledTurnPersistedRef.current = false;
    setCheckpoint(null);
    setEntries([]);
    setSteerRequests([]);
    setLiveEvents([]);
    setReplayHasGap(false);
    setReplayError(null);
    setOlderCursor(null);
    setError(null);
    setLoading(true);
    const unsubscribe = subscribeChildRuntimeEvents(
      childProjectId,
      child.child_thread_id,
      (event) => mergeLiveEvents([event]),
    );
    void refresh();
    return () => {
      unsubscribe();
      mountedRef.current = false;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [child.child_thread_id, childProjectId, mergeLiveEvents, refresh]);

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
  }, [entries, checkpoint, liveEvents]);

  const persistedMessages = useMemo(
    () => projectChildMessages(entries, child, childProjectId, steerRequests),
    [entries, child, childProjectId, steerRequests],
  );
  const activeTurnId = checkpoint?.active_turn_id
    || checkpoint?.session?.active_turn_id
    || child.current_turn_id
    || child.turn_id
    || [...liveEvents].reverse().map(eventTurnId).find(Boolean)
    || null;
  const running = isRunning(checkpoint, child);
  const messages = useMemo(
    () => projectLiveChildMessages(persistedMessages, liveEvents, activeTurnId, child, running),
    [persistedMessages, liveEvents, activeTurnId, child, running],
  );
  const turnGroups = useMemo(() => groupMessagesByTurn(messages), [messages]);
  const lastAssistantIndexByTurn = useMemo(() => {
    const indexByTurn = new Map();
    messages.forEach((message, index) => {
      if (message?.role === 'assistant' && message?.turnId) {
        indexByTurn.set(String(message.turnId), index);
      }
    });
    return indexByTurn;
  }, [messages]);
  const status = getChildTaskStatus(child);
  const executionRecovery = checkpoint?.execution_recovery
    || checkpoint?.executionRecovery
    || child.execution_recovery
    || child.executionRecovery
    || null;
  const recoveryStatus = executionRecovery?.status || '';
  const recoveryWaiting = recoveryStatus === 'waiting_for_continue';
  const needsReconciliation = recoveryStatus === 'needs_reconciliation';
  const queued = QUEUED_CHILD_STATUSES.has(status);
  const phase = getChildTaskPhaseLabel(child);
  const failure = checkpoint?.last_turn_error || checkpoint?.session?.last_turn_error;
  const failed = !running && !recoveryWaiting && !needsReconciliation && (['failed', 'step_limit'].includes(status) || ['failed', 'error'].includes(String(
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
  const taskResultText = getTaskResultText(child.operation_result)
    || getTaskResultText(child.result);
  const finalReplyFallback = taskResultText && !hasAssistantResultInMessages(taskResultText, messages)
    ? taskResultText
    : null;
  const showFinalReplyFallback = !running && !queued && !failed && Boolean(finalReplyFallback);
  const failureDetail = failure || child.error || child.operation_error;

  const resumeExecution = async () => {
    const turnId = executionRecovery?.turn_id || executionRecovery?.turnId;
    const checkpointSeq = Number(
      executionRecovery?.checkpoint_seq ?? executionRecovery?.checkpointSeq,
    );
    if (!onControl || !turnId || !Number.isSafeInteger(checkpointSeq) || checkpointSeq < 1) {
      setRecoveryError('执行检查点信息不完整，请刷新子任务状态。');
      return;
    }
    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      await onControl(child, 'resume', {
        requestId: getChildExecutionResumeRequestId(child)
          || `child-turn-resume:${turnId}:${checkpointSeq}`,
      });
      await refresh();
    } catch (cause) {
      setRecoveryError(cause?.message || '继续子任务失败');
      await refresh({ quiet: true });
    } finally {
      setRecoveryBusy(false);
    }
  };

  const reconcileExecution = async (
    toolCallId,
    disposition,
    resultContent,
    evidenceSummary,
    requestId,
  ) => {
    const turnId = executionRecovery?.turn_id || executionRecovery?.turnId;
    const checkpointSeq = Number(
      executionRecovery?.checkpoint_seq ?? executionRecovery?.checkpointSeq,
    );
    if (!turnId || !Number.isSafeInteger(checkpointSeq) || checkpointSeq < 1) {
      setRecoveryError('执行检查点信息不完整，请刷新子任务状态。');
      return;
    }
    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      const payload = {
        checkpoint_seq: checkpointSeq,
        tool_call_id: toolCallId,
        request_id: requestId,
        disposition,
        evidence_summary: evidenceSummary,
      };
      if (disposition === 'completed') {
        payload.result = { status: 'completed', content: resultContent };
      }
      await api.reconcileTurn(child.child_thread_id, turnId, payload, {
        projectId: childProjectId,
      });
      await refresh();
    } catch (cause) {
      setRecoveryError(cause?.message || '核对子任务工具结果失败');
      await refresh({ quiet: true });
    } finally {
      setRecoveryBusy(false);
    }
  };

  const showExecutionActivity = () => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcript.scrollTop = transcript.scrollHeight;
    pinnedToBottomRef.current = true;
  };

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
            {running
              ? '运行中'
              : recoveryWaiting
                ? '停滞待继续'
                : needsReconciliation
                  ? '工具结果待核对'
                  : (childTaskStatusLabels[status] || status)}
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

      <section className={`child-session-overview ${running ? 'running' : queued ? 'queued' : failed ? 'failed' : 'finished'}`}>
        <div className="child-session-overview-heading">
          <strong>{running
            ? '子代理正在执行'
            : recoveryWaiting
              ? '执行已停滞，等待继续'
              : needsReconciliation
                ? '工具结果需要核对'
            : queued
              ? '等待调度'
              : status === 'step_limit'
                ? '子代理达到步数上限'
                : failed ? '子代理执行失败' : status === 'cancelled'
                  ? '子代理已取消'
                  : '子代理已完成'}</strong>
          {duration && <span className="font-mono">{running ? '已运行' : '累计耗时'} {duration}</span>}
        </div>
        {parentThreadId && (
          <div className="child-session-source">
            来源父会话 <span className="font-mono">{parentThreadId}</span>
            {Number.isFinite(parentCheckpointSeq) && ` · checkpoint ${parentCheckpointSeq}`}
            {' · '}这里只显示子会话自己的活动
          </div>
        )}
        {(running || queued) && latestReport && (
          <div className="child-session-latest-report">
            <span>最新进展</span>
            <p>{latestReport.text}</p>
            {latestReport.timestamp_ms && (
              <time>{formatChildTaskTimestamp(latestReport.timestamp_ms)}</time>
            )}
          </div>
        )}
        {failed && failureDetail && (
          <div className="child-session-final-error">{failureDetail}</div>
        )}
      </section>

      {(recoveryWaiting || needsReconciliation) && (
        <div className="child-session-view-warning" role="status">
          <div>
            <strong>{recoveryWaiting ? '已保存最近执行进度' : '存在结果未知的工具调用'}</strong>
            <span>
              {executionRecovery?.reason
                || (recoveryWaiting
                  ? '继续后会从该检查点接续同一个 Turn。'
                  : '先核对子会话中的工具活动，确认外部副作用后再决定如何继续。')}
            </span>
            {executionRecovery?.last_progress_ms && (
              <time>最近进展 {formatChildTaskTimestamp(executionRecovery.last_progress_ms)}</time>
            )}
          </div>
          {recoveryWaiting && onControl && (
            <button
              type="button"
              className="btn-action-small"
              disabled={recoveryBusy}
              onClick={() => void resumeExecution()}
            >
              {recoveryBusy ? '正在继续…' : '继续当前 Turn'}
            </button>
          )}
          {needsReconciliation && (
            <div className="turn-reconciliation-list">
              {(executionRecovery?.uncertain_tool_calls
                || executionRecovery?.uncertainToolCalls
                || []).map((call) => (
                <TurnReconciliationForm
                  key={call.tool_call_id || call.toolCallId}
                  call={call}
                  busy={recoveryBusy}
                  onSubmit={reconcileExecution}
                />
              ))}
              <button type="button" className="btn-action-small" onClick={showExecutionActivity}>
                查看执行记录
              </button>
            </div>
          )}
        </div>
      )}
      {recoveryError && <div className="child-session-view-error" role="alert">{recoveryError}</div>}

      {contextManifest.length > 0 && (
        <details className="child-context-manifest">
          <summary>Context 来源（{contextManifest.length}）</summary>
          <ul>
            {contextManifest.map((entry) => (
              <li key={`${entry.sourceId}:${entry.turnId || ''}:${entry.versionFingerprint}`}>
                <strong>{entry.sourceName || entry.sourceId}</strong>
                <span>{[entry.kind, entry.workspace, entry.path, entry.appliesTo]
                  .filter(Boolean).join(' · ')}</span>
                {entry.versionFingerprint && (
                  <code title={entry.versionFingerprint}>{entry.versionFingerprint.slice(0, 20)}</code>
                )}
                {entry.permissionBasis && <span>依据：{entry.permissionBasis}</span>}
                {entry.injectionReason && <span>原因：{entry.injectionReason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && <div className="child-session-view-error" role="alert">{error}</div>}
      {replayHasGap && (
        <div className="child-session-view-warning" role="status">
          较早的实时片段未能回放；Turn 结算并写入持久化活动后，这条提示会自动消失。
        </div>
      )}
      {replayError && (
        <div className="child-session-view-warning" role="status">
          实时活动回放暂不可用，正在自动重试；持久化记录仍会继续刷新。
        </div>
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
        ) : messages.length === 0 && !showFinalReplyFallback ? (
          <div className="child-session-empty">
            <strong>{running
              ? '正在等待子代理的首条活动'
              : recoveryWaiting
                ? '执行进度已保存，等待继续'
                : needsReconciliation
                  ? '等待核对工具执行结果'
                  : '暂无子代理活动'}</strong>
            <span>这里只显示子 Session 自己的活动，不会回填父会话 checkpoint 内容；父 checkpoint 只作为模型上下文。</span>
          </div>
        ) : (
          <div className="child-session-messages">
            {turnGroups.map((group, groupIndex) => {
              const roundLabel = `Turn ${groupIndex + 1}`;
              const isCurrentTurn = running && (activeTurnId
                ? group.turnId === String(activeTurnId)
                : groupIndex === turnGroups.length - 1);
              const lastIndex = group.messages.at(-1)?.index;
              const lastAssistantIndex = group.messages.findLast(({ message }) => (
                message.role === 'assistant'
              ))?.index ?? lastIndex;
              const turnStatusLabel = isCurrentTurn
                ? (phase || '当前执行')
                : groupIndex === turnGroups.length - 1 && status !== 'running'
                  ? (childTaskStatusLabels[status] || status)
                  : '已结束';

              return (
                <section
                  key={group.key}
                  className={`child-session-turn ${isCurrentTurn ? 'current' : 'settled'}`}
                  aria-label={`${roundLabel} · ${turnStatusLabel}`}
                  data-turn-id={group.turnId || undefined}
                >
                  <header className="child-session-turn-heading">
                    <strong>{roundLabel}</strong>
                    <span className={isCurrentTurn ? 'current' : ''}>{turnStatusLabel}</span>
                  </header>
                  <div className="child-session-turn-messages">
                    {group.messages.map(({ message, index }) => (
                      <MessageItem
                        key={message.id || `child-message-${index}`}
                        message={message}
                        threadId={child.child_thread_id}
                        projectId={childProjectId}
                        isLast={index === messages.length - 1}
                        isLastInTurn={message.turnId
                          ? lastAssistantIndexByTurn.get(String(message.turnId)) === index
                          : index === lastAssistantIndex}
                        isCurrentTurnSegment={isCurrentTurn
                          && message.role === 'assistant'
                          && (message.turnId
                            ? lastAssistantIndexByTurn.get(String(message.turnId)) === index
                            : index === lastAssistantIndex)}
                        isGenerating={isCurrentTurn}
                        pendingApproval={null}
                        policy="read_only"
                      />
                    ))}
                  </div>
                </section>
              );
            })}
            {showFinalReplyFallback && (
              <section className="child-session-result" aria-label="任务最终回复">
                <header className="child-session-turn-heading">
                  <strong>任务最终回复</strong>
                  <span>未包含在活动记录中</span>
                </header>
                <MessageItem
                  message={{
                    id: `child-result-${child.operation_id || child.child_thread_id}`,
                    role: 'assistant',
                    text: finalReplyFallback,
                    turnId: activeTurnId || child.current_turn_id || child.turn_id || 'child-result',
                  }}
                  isLast
                  isLastInTurn
                  isGenerating={false}
                  pendingApproval={null}
                  policy="read_only"
                />
              </section>
            )}
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
