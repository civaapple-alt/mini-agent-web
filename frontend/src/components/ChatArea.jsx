import { useRef, useEffect, useLayoutEffect, useMemo, useState, useCallback } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { Sparkles, Terminal, Compass, TestTube2, ArrowDown, Folder } from 'lucide-react';
import MessageItem from './MessageItem';
import ToolCard from './ToolCard';
import SessionTurnRail from './SessionTurnRail';
import TurnReconciliationForm from './TurnReconciliationForm';
import { collectInputMessages, getChildWakeupTurnIds } from '../utils/inputTrace';
import { normalizeAssistantBlocks, orderMessagesByTurnHistory } from '../utils/messageState';
import {
  buildTurnHistoryEntries,
  isIncompleteTurnStatus,
} from '../utils/turnHistory';
import { buildTurnChildTaskBatch, getDelegateTaskAssignments } from '../utils/childTasks';
import { scopedThreadKey } from '../utils/sessionState.js';
import { findAttentionMessage, getToolCallIds } from '../utils/attentionTargets.js';
import './ChatArea.css';

function formatProcessedDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1000) return '已处理不足1秒';
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `已处理 ${minutes}分钟${seconds}秒`
    : `已处理 ${seconds}秒`;
}

function TurnDurationLabel({ entry, nowMs, isRunning }) {
  const durationMs = isRunning
    ? (Number.isFinite(entry.startedAtMs)
      ? (Number.isFinite(entry.accumulatedMs) ? entry.accumulatedMs : 0)
        + Math.max(0, nowMs - entry.startedAtMs)
      : null)
    : entry.durationMs;
  const label = formatProcessedDuration(durationMs);
  if (!label) return null;
  return <div className="turn-duration-label" aria-label={label}>{label}</div>;
}

function formatRecoveryProgressTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatReconciliationMessage(recovery) {
  const uncertainCalls = recovery?.uncertain_tool_calls
    || recovery?.uncertainToolCalls
    || [];
  const checkpointSeq = recovery?.checkpoint_seq ?? recovery?.checkpointSeq;
  const pendingSummary = uncertainCalls.length > 0
    ? `还有 ${uncertainCalls.length} 条调用待核对。`
    : '';
  const checkpointSummary = checkpointSeq !== null
    && checkpointSeq !== undefined
    && Number.isSafeInteger(Number(checkpointSeq))
    ? `执行检查点 ${checkpointSeq}。`
    : '';
  const reason = recovery?.reason;
  const explanation = reason === 'process_restart_during_tool_call'
    ? 'App Server 在工具调用期间重启，无法确认这条调用是否已产生副作用。'
    : reason === 'process_restart'
      ? 'App Server 重启后已保留执行检查点；待确认的工具调用需要逐条核对。'
      : reason
        ? `原因：${reason}`
        : '';
  return `工具执行结果需要核对后才能继续。${pendingSummary}${checkpointSummary}${explanation ? ` ${explanation}` : ''}`;
}

function formatTurnError(error) {
  if (error === 'process_restart_during_tool_call') {
    return 'App Server 在工具调用期间重启';
  }
  if (error === 'process_restart') return 'App Server 重启';
  return error;
}

function formatIncompleteTurnHint(turnResult) {
  if (turnResult.recovery?.status === 'needs_reconciliation') {
    return formatReconciliationMessage(turnResult.recovery);
  }
  if (turnResult.recovery?.status === 'waiting_for_continue') {
    const checkpointSeq = turnResult.recovery.checkpoint_seq
      ?? turnResult.recovery.checkpointSeq;
    const progressSummary = checkpointSeq !== null
      && checkpointSeq !== undefined
      && Number.isSafeInteger(Number(checkpointSeq))
      ? `执行检查点 ${checkpointSeq} 已保存。`
      : '执行进度已保存。';
    return `${progressSummary}点击“继续当前 Turn”后会恢复原 Turn；已记录的工具结果会复用，确认未执行的调用会重新运行。`;
  }
  if (turnResult.error === 'process_restart_during_tool_call') {
    return '当前工具调用结果可能未知。请刷新会话，核对后再继续原 Turn。';
  }
  return '当前回答可能不完整，可以继续发送指令推进下一轮。';
}

function findAttentionElement(root, attentionRequest, messageId = null) {
  const target = attentionRequest?.target || {};
  const scope = root || document;
  const messageNode = messageId
    ? [...scope.querySelectorAll('[data-message-id]')].find((node) => (
      node.dataset.messageId === String(messageId)
    ))
    : null;
  const targetScope = messageNode || scope;
  if (target.callId) {
    const nodes = targetScope.querySelectorAll(
      '[data-tool-call-id], [data-reconciliation-call-id]',
    );
    const matchingNode = [...nodes].find((node) => (
      node.dataset.toolCallId === String(target.callId)
        || node.dataset.reconciliationCallId === String(target.callId)
    ));
    if (matchingNode) return matchingNode;
  }
  if (target.interactionId) {
    const node = [...targetScope.querySelectorAll('[data-interaction-id]')].find((element) => (
      element.dataset.interactionId === String(target.interactionId)
    ));
    if (node) return node;
  }
  if (attentionRequest?.type === 'continue') {
    return scope.querySelector('[data-attention-kind="continue"]');
  }
  if (attentionRequest?.type === 'approval' && target.requestId) {
    const node = [...targetScope.querySelectorAll('[data-approval-request-id]')].find((element) => (
      element.dataset.approvalRequestId === String(target.requestId)
    ));
    if (node) return node;
  }
  return null;
}

export default function ChatArea({
  messages,
  isGenerating,
  pendingApproval,
  pendingApprovals = [],
  pendingUserQuestion = null,
  onRespondApproval = null,
  onRespondUserQuestion = null,
  lastTurnResult,
  turnTimings = null,
  onResumeExecution,
  resumeExecutionBusy = false,
  onReconcileExecution,
  reconcileExecutionBusy = false,
  attentionRequest = null,
  onAttentionRequestHandled = null,
  threadItems = [],
  statusModel = null,
  policy = 'interactive',
  onQuickPrompt,
  onRetryPrompt,
  traceScope,
  autoScroll = true,
  wordWrap = true,
  fontSize = 13,
  isLoadingHistory = false,
  olderHistoryAvailable = false,
  isLoadingOlderHistory = false,
  historyPageVersion = 0,
  onLoadOlderHistory,
  childTasks = [],
  isNewSessionLanding = false,
  availableProjects = [],
  onCreateSessionForProject,
}) {
  const scrollRef = useRef(null);
  const messageRefs = useRef(new Map());
  const focusTimerRef = useRef(null);
  const hasMountedRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const olderPageAnchorRef = useRef(null);
  const preserveHistoryAnchorRef = useRef(false);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [hasNewActivity, setHasNewActivity] = useState(false);
  const [focusedTurnId, setFocusedTurnId] = useState(null);
  const [forcedRowIndex, setForcedRowIndex] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasActiveTurn = isGenerating
    || Boolean(pendingApproval)
    || pendingApprovals.length > 0
    || Boolean(statusModel?.process?.turnActive)
    || ['running', 'approval', 'stopping'].includes(statusModel?.lifecycle);
  const recoveryProgressTime = formatRecoveryProgressTime(
    lastTurnResult?.recovery?.last_progress_ms
      ?? lastTurnResult?.recovery?.lastProgressMs,
  );
  const recoveryPhaseLabel = {
    model_request: '模型请求',
    tool_batch: '工具批次',
  }[lastTurnResult?.recovery?.phase] || null;

  const turnEntries = useMemo(() => {
    const entries = buildTurnHistoryEntries({
      messages,
      threadItems,
      scope: traceScope,
      statusModel,
      activeTurnId: statusModel?.scope?.turnId,
      lastTurnResult,
    });
    if (!(turnTimings instanceof Map) || turnTimings.size === 0) {
      return entries;
    }
    const threadKey = scopedThreadKey(traceScope?.threadId, traceScope?.projectId);
    return entries.map((entry) => {
      if (!entry.turnId) return entry;
      const timing = turnTimings.get(`${threadKey}:${entry.turnId}`);
      if (!timing) return entry;
      const startedAtMs = Number.isFinite(entry.startedAtMs)
        ? entry.startedAtMs
        : timing.startedAtMs;
      const accumulatedMs = Number.isFinite(entry.accumulatedMs)
        ? entry.accumulatedMs
        : timing.accumulatedMs;
      const durationMs = Number.isFinite(entry.durationMs)
        ? entry.durationMs
        : timing.durationMs;
      return {
        ...entry,
        ...(Number.isFinite(startedAtMs) && startedAtMs >= 0 ? { startedAtMs } : {}),
        ...(Number.isFinite(accumulatedMs) && accumulatedMs >= 0 ? { accumulatedMs } : {}),
        ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}),
      };
    });
  }, [messages, threadItems, traceScope, statusModel, lastTurnResult, turnTimings]);

  const displayMessages = useMemo(() => {
    const projectedInputs = collectInputMessages(messages, threadItems, traceScope);
    const childWakeupTurnIds = getChildWakeupTurnIds(messages, threadItems);
    const result = messages.filter((message) => (
      !(message?.role === 'user' && childWakeupTurnIds.has(String(message.turnId || '')))
      && !(message?.role === 'user'
        && String(message.turnSource || message.turn_source || '').toLowerCase() === 'child_wakeup')
    ));
    const consumedInputs = new Set();
    projectedInputs.forEach((input) => {
      const inputTurnId = input.turnId ? String(input.turnId) : null;
      const existingInput = result.find((message) => {
        if (consumedInputs.has(message)) return false;
        if (message.role !== 'user') return false;
        const inputId = input.inputItemId || input.id;
        const messageId = message.inputItemId || message.id;
        if (inputId && messageId && String(inputId) === String(messageId)) return true;
        const sameText = String(message.text || '').trim() === String(input.text || '').trim();
        return sameText && (
          !inputTurnId || !message.turnId || String(message.turnId) === inputTurnId
        );
      });
      if (existingInput) {
        consumedInputs.add(existingInput);
        return;
      }
      const assistantIndex = inputTurnId
        ? result.findIndex((message) => (
          message.role === 'assistant' && String(message.turnId || '') === inputTurnId
        ))
        : -1;
      if (assistantIndex >= 0) result.splice(assistantIndex, 0, input);
      else result.push(input);
      consumedInputs.add(input);
    });
    return orderMessagesByTurnHistory(result, threadItems);
  }, [messages, threadItems, traceScope]);

  const modelTimingPlacementByTurn = useMemo(() => {
    const inputMessageByTurn = new Map();
    const timingByTurn = new Map();
    displayMessages.forEach((message, index) => {
      const turnId = message?.turnId ? String(message.turnId) : null;
      if (!turnId) return;
      if (message.role === 'user' && !message.isSteer && !message.isGoal
        && !inputMessageByTurn.has(turnId)) {
        inputMessageByTurn.set(turnId, String(message.id || `msg_${index}`));
      }
      const timing = message.role === 'assistant' ? message.modelTiming : null;
      if (timing && (
        Number.isSafeInteger(timing.ttftMs) || Number.isSafeInteger(timing.responseMs)
      )) {
        timingByTurn.set(turnId, timing);
      }
    });

    const placementByTurn = new Map();
    timingByTurn.forEach((modelTiming, turnId) => {
      const inputMessageId = inputMessageByTurn.get(turnId);
      if (inputMessageId) placementByTurn.set(turnId, { inputMessageId, modelTiming });
    });
    return placementByTurn;
  }, [displayMessages]);

  const lastAssistantIndexByTurn = useMemo(() => {
    const indexByTurn = new Map();
    displayMessages.forEach((message, index) => {
      if (message?.role === 'assistant' && message?.turnId) {
        indexByTurn.set(String(message.turnId), index);
      }
    });
    return indexByTurn;
  }, [displayMessages]);
  const lastAssistantMessageIndex = displayMessages.findLastIndex(
    (message) => message?.role === 'assistant',
  );
  const activeTurnId = statusModel?.scope?.turnId
    ? String(statusModel.scope.turnId)
    : null;
  const presentationRows = useMemo(() => {
    return displayMessages.map((message, index) => ({
      message,
      startIndex: index,
      endIndex: index,
    }));
  }, [displayMessages]);

  const virtualizer = useVirtualizer({
    count: presentationRows.length,
    getScrollElement: () => scrollRef.current,
    initialRect: { width: 860, height: 600 },
    initialOffset: 0,
    estimateSize: () => 180,
    getItemKey: (index) => String(presentationRows[index]?.message?.id || index),
    overscan: 6,
    rangeExtractor: (range) => {
      const visible = defaultRangeExtractor(range);
      if (forcedRowIndex === null || visible.includes(forcedRowIndex)) return visible;
      return [...visible, forcedRowIndex].sort((left, right) => left - right);
    },
  });
  const virtualRows = virtualizer.getVirtualItems();

  const childTaskBatchByMessage = useMemo(() => {
    const turnGroups = new Map();
    displayMessages.forEach((message, index) => {
      if (message.role !== 'assistant') return;
      const normalizedMessage = {
        ...message,
        blocks: normalizeAssistantBlocks(message.blocks || []),
      };
      if (getDelegateTaskAssignments(normalizedMessage).length === 0) return;
      const turnKey = message.turnId
        ? `turn:${message.turnId}`
        : `message:${message.id || index}`;
      const existing = turnGroups.get(turnKey);
      if (existing) existing.messages.push(normalizedMessage);
      else {
        turnGroups.set(turnKey, {
          turnId: message.turnId || null,
          firstMessageKey: String(message.id || `msg_${index}`),
          messageKeys: [String(message.id || `msg_${index}`)],
          messages: [normalizedMessage],
        });
      }
      if (existing) existing.messageKeys.push(String(message.id || `msg_${index}`));
    });

    const batches = new Map();
    const delegateMessageKeys = new Set();
    turnGroups.forEach((group) => {
      group.messageKeys.forEach((key) => delegateMessageKeys.add(key));
      batches.set(
        group.firstMessageKey,
        buildTurnChildTaskBatch({
          children: childTasks,
          turnId: group.turnId,
          messages: group.messages,
        }),
      );
    });
    return { batches, delegateMessageKeys };
  }, [childTasks, displayMessages]);

  const entryByMessageId = useMemo(
    () => new Map(turnEntries.map((entry) => [String(entry.messageId), entry])),
    [turnEntries],
  );
  const entryByTurnId = useMemo(
    () => new Map(turnEntries.filter((entry) => entry.turnId).map((entry) => [String(entry.turnId), entry])),
    [turnEntries],
  );
  const activeTurnEntry = turnEntries.find((entry) => entry.isCurrent)
    || (hasActiveTurn ? turnEntries.at(-1) : null);
  const timelineToolCallIds = useMemo(
    () => getToolCallIds(displayMessages),
    [displayMessages],
  );
  const recoveryCalls = lastTurnResult?.recovery?.status === 'needs_reconciliation'
    ? (lastTurnResult.recovery.uncertain_tool_calls
      || lastTurnResult.recovery.uncertainToolCalls
      || [])
    : [];
  const questionTarget = pendingUserQuestion
    ? {
      callId: pendingUserQuestion.callId || pendingUserQuestion.call_id || null,
      interactionId: pendingUserQuestion.interactionId
        || pendingUserQuestion.interaction_id
        || null,
      turnId: pendingUserQuestion.turnId || pendingUserQuestion.turn_id || null,
    }
    : null;
  const hasQuestionMessage = Boolean(
    questionTarget
      && (questionTarget.callId || questionTarget.interactionId)
      && findAttentionMessage(displayMessages, questionTarget),
  );
  const attentionActionsDisabled = Boolean(
    statusModel && (
      statusModel.connection !== 'online'
        || statusModel.sessionReadOnly
        || statusModel.lifecycle === 'stopping'
    ),
  );
  const attentionBlockedMessage = statusModel?.connection !== 'online'
    ? '连接恢复后才能提交此操作'
    : statusModel?.sessionReadOnly
      ? '当前会话只读，不能提交此操作'
      : statusModel?.lifecycle === 'stopping'
        ? '当前 Turn 正在停止，等待运行时确认'
        : null;
  const turnDurationAnchors = useMemo(() => {
    const firstAssistantIndexByTurn = new Map();
    const firstUserIndexByTurn = new Map();
    displayMessages.forEach((message, index) => {
      const turnId = message?.turnId ? String(message.turnId) : null;
      if (!turnId) return;
      if (message.role === 'assistant' && !firstAssistantIndexByTurn.has(turnId)) {
        firstAssistantIndexByTurn.set(turnId, index);
      } else if (message.role === 'user' && !firstUserIndexByTurn.has(turnId)) {
        firstUserIndexByTurn.set(turnId, index);
      }
    });
    const before = new Map();
    const after = new Map();
    turnEntries.forEach((entry) => {
      if (!entry.turnId) return;
      const turnId = String(entry.turnId);
      if (firstAssistantIndexByTurn.has(turnId)) {
        before.set(firstAssistantIndexByTurn.get(turnId), entry);
      } else if (firstUserIndexByTurn.has(turnId)) {
        after.set(firstUserIndexByTurn.get(turnId), entry);
      }
    });
    return { before, after };
  }, [displayMessages, turnEntries]);

  const setMessageRef = (messageId, node) => {
    if (!messageId) return;
    if (node) messageRefs.current.set(String(messageId), node);
    else messageRefs.current.delete(String(messageId));
  };

  const scrollToMessage = useCallback((messageId, turnId, block) => {
    let node = messageRefs.current.get(String(messageId || ''));
    const reducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    if (!node) {
      let messageIndex = displayMessages.findIndex((message) => (
        String(message.id || '') === String(messageId || '')
      ));
      if (messageIndex < 0 && turnId) {
        messageIndex = displayMessages.findIndex((message) => (
          String(message.turnId || '') === String(turnId)
        ));
      }
      const rowIndex = presentationRows.findIndex((row) => (
        messageIndex >= row.startIndex && messageIndex <= row.endIndex
      ));
      if (rowIndex < 0) return false;
      setForcedRowIndex(rowIndex);
      virtualizer.scrollToIndex(rowIndex, {
        align: block === 'center' ? 'center' : 'auto',
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
      const revealRow = (attempt = 0) => window.requestAnimationFrame(() => {
        node = messageRefs.current.get(String(messageId || ''));
        if (!node && turnId) {
          const fallback = presentationRows[rowIndex]?.message?.id;
          node = messageRefs.current.get(String(fallback || ''));
        }
        if (node?.scrollIntoView) node.scrollIntoView({
          behavior: reducedMotion ? 'auto' : 'smooth',
          block,
        });
        if (!node && attempt < 4) {
          revealRow(attempt + 1);
          return;
        }
        setForcedRowIndex(null);
      });
      revealRow();
    } else if (typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block });
    } else {
      return false;
    }
    setIsScrolledUp(false);
    setHasNewActivity(false);
    setFocusedTurnId(turnId || null);
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = turnId
      ? window.setTimeout(() => setFocusedTurnId(null), 1400)
      : null;
    return true;
  }, [displayMessages, presentationRows, virtualizer]);

  const scrollToEntry = useCallback((entry) => {
    if (!entry) return false;
    return scrollToMessage(entry.messageId, entry.turnId || entry.id, 'center');
  }, [scrollToMessage]);

  useEffect(() => {
    if (!attentionRequest?.id) return;
    const target = attentionRequest.target || {};
    const currentProjectId = traceScope?.projectId ? String(traceScope.projectId) : null;
    const currentThreadId = traceScope?.threadId ? String(traceScope.threadId) : null;
    if (
      (target.projectId && currentProjectId && String(target.projectId) !== currentProjectId)
      || (target.threadId && currentThreadId && String(target.threadId) !== currentThreadId)
    ) {
      onAttentionRequestHandled?.(attentionRequest.id);
      return;
    }
    const message = findAttentionMessage(displayMessages, target);
    let didNavigate = false;
    if (message?.id) {
      didNavigate = scrollToMessage(
        message.id,
        target.turnId || message.turnId || null,
        'center',
      );
    } else if (target.turnId) {
      const entry = turnEntries.find((item) => (
        String(item.turnId || item.id || '') === String(target.turnId)
      ));
      didNavigate = scrollToEntry(entry);
    }

    if (
      !didNavigate
      || attentionRequest.type === 'continue'
      || (!message && ['reconciliation', 'question'].includes(attentionRequest.type))
    ) {
      const reducedMotion = window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    }

    const focus = (attempt = 0) => {
      const node = findAttentionElement(scrollRef.current, attentionRequest, message?.id);
      if (!node && attempt < 6) {
        requestFrame(() => focus(attempt + 1));
        return;
      }
      if (!node) return;
      node.focus?.({ preventScroll: true });
      node.classList.add('attention-focus-ring');
      window.setTimeout(() => node.classList.remove('attention-focus-ring'), 1800);
    };
    const requestFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0));
    requestFrame(() => requestFrame(() => focus()));
    onAttentionRequestHandled?.(attentionRequest.id);
  }, [
    attentionRequest,
    displayMessages,
    onAttentionRequestHandled,
    scrollToEntry,
    scrollToMessage,
    traceScope,
    turnEntries,
  ]);

  const selectTurn = (entry) => scrollToEntry(entry);

  const scrollToCurrentTurn = () => {
    const currentEntry = turnEntries.find((entry) => entry.isCurrent)
      || turnEntries[turnEntries.length - 1];
    const currentTurnId = currentEntry?.turnId ? String(currentEntry.turnId) : null;
    if (currentTurnId) {
      setFocusedTurnId(currentTurnId);
      if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = window.setTimeout(() => setFocusedTurnId(null), 1400);
    }
    // The current Turn is the newest conversation activity. Scrolling to the
    // container end avoids anchoring on its input bubble while later tool or
    // assistant activity has already arrived.
    scrollToBottom();
  };

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const scrollingUp = scrollTop < lastScrollTopRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const awayFromBottom = distanceFromBottom > 80;
    setIsScrolledUp(awayFromBottom);
    if (!awayFromBottom) setHasNewActivity(false);
    if (
      scrollingUp
      && scrollTop < 120
      && olderHistoryAvailable
      && !isLoadingOlderHistory
      && !olderPageAnchorRef.current
      && typeof onLoadOlderHistory === 'function'
    ) {
      const firstVisibleRow = virtualizer.getVirtualItemForOffset(scrollTop) || virtualRows[0];
      const rowElement = firstVisibleRow
        ? [...scrollRef.current.querySelectorAll('[data-virtual-message-row]')]
          .find((element) => Number(element.dataset.historyRowIndex) === firstVisibleRow.index)
        : null;
      const messageId = presentationRows[firstVisibleRow?.index]?.message?.id;
      const anchor = messageId && rowElement
        ? {
          messageId: String(messageId),
          offset: rowElement.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top,
          pageVersion: historyPageVersion,
        }
        : null;
      olderPageAnchorRef.current = anchor;
      preserveHistoryAnchorRef.current = Boolean(anchor);
      onLoadOlderHistory();
    }
    lastScrollTopRef.current = scrollTop;
  };

  useLayoutEffect(() => {
    const anchor = olderPageAnchorRef.current;
    if (!anchor || !scrollRef.current || historyPageVersion === anchor.pageVersion) return;
    const anchorIndex = presentationRows.findIndex((row) => (
      String(row.message?.id || '') === anchor.messageId
    ));
    if (anchorIndex < 0) {
      olderPageAnchorRef.current = null;
      preserveHistoryAnchorRef.current = false;
      return;
    }
    const anchorStart = virtualizer.getOffsetForIndex(anchorIndex, 'start')?.[0];
    if (Number.isFinite(anchorStart)) {
      const nextOffset = anchorStart - anchor.offset;
      if (Math.abs(nextOffset - scrollRef.current.scrollTop) > 0.5) {
        virtualizer.scrollToOffset(nextOffset, { behavior: 'auto' });
        lastScrollTopRef.current = nextOffset;
      }
    }
    olderPageAnchorRef.current = null;
    preserveHistoryAnchorRef.current = false;
  }, [historyPageVersion, presentationRows, virtualizer]);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
      setIsScrolledUp(false);
      setHasNewActivity(false);
    }
  };

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      return undefined;
    }
    if (preserveHistoryAnchorRef.current) {
      return;
    }
    if (isScrolledUp) {
      setHasNewActivity(true);
    } else if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [
    messages,
    isGenerating,
    pendingApproval,
    autoScroll,
    statusModel?.lifecycle,
    statusModel?.summary,
    lastTurnResult?.status,
    lastTurnResult?.turnId,
  ]);

  useEffect(() => {
    if (!hasActiveTurn) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveTurn]);

  useEffect(() => () => {
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
  }, []);

  const chatContent = (
    <div
      className={`chat-area custom-scrollbar ${wordWrap ? 'wrap-content' : 'nowrap-content'} ${(isScrolledUp || hasNewActivity) ? 'has-scroll-bottom-button' : ''}`}
      style={{ fontSize: fontSize ? `${fontSize}px` : undefined }}
      ref={scrollRef}
      onScroll={handleScroll}
    >
      {isLoadingHistory ? (
        <div className="history-loading-container" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '32px 16px', alignItems: 'center' }}>
          <div className="skeleton-line" style={{ width: '40%', height: '14px', borderRadius: '4px', background: 'var(--border-color)', opacity: 0.5, animation: 'pulse 1.5s infinite' }} />
          <div className="skeleton-bubble" style={{ width: '80%', height: '48px', borderRadius: '8px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', opacity: 0.6 }} />
          <div className="skeleton-bubble" style={{ width: '70%', height: '64px', borderRadius: '8px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', opacity: 0.6 }} />
        </div>
      ) : displayMessages.length === 0 && turnEntries.length === 0 ? (
        <div className="welcome-container">
          <div className="welcome-icon-box">
            <Sparkles size={24} />
          </div>
          <h2 className="welcome-title">Mini Agent Studio</h2>
          <p className="welcome-subtitle">
            基于 Mini Agent JSON-RPC 协议与运行时。支持多轮交互、思维链打字机流式呈现、工具内嵌安全审批与全套工作流。
          </p>

          {isNewSessionLanding && (
            <label className="welcome-project-picker">
              <span><Folder size={14} /> 选择项目</span>
              <select
                aria-label="选择项目以创建会话"
                value=""
                disabled={!onCreateSessionForProject || availableProjects.length === 0}
                onChange={(event) => {
                  const projectId = event.target.value;
                  if (projectId) void onCreateSessionForProject(projectId);
                }}
              >
                <option value="">
                  {availableProjects.length > 0 ? '选择项目并创建空白会话' : '没有可用项目，请先在侧栏添加项目'}
                </option>
                {availableProjects.map((project) => (
                  <option key={project.id || project.name} value={project.id || project.name}>
                    {project.name || project.id}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!isNewSessionLanding && <div className="quick-prompts-grid">
            <button
              className="quick-chip"
              onClick={() => onQuickPrompt('检查当前工作区文件与结构，给出简短摘要')}
            >
              <Terminal size={12} className="text-amber" />
              <span>检查工作区文件与结构</span>
            </button>
            <button
              className="quick-chip"
              onClick={() => onQuickPrompt('开启只读 Plan Mode 探索架构设计')}
            >
              <Compass size={12} className="text-sky" />
              <span>开启只读 Plan Mode 规划</span>
            </button>
            <button
              className="quick-chip"
              onClick={() => onQuickPrompt('运行自动化单元测试并总结测试覆盖情况')}
            >
              <TestTube2 size={12} className="text-emerald" />
              <span>运行单元测试套件</span>
            </button>
          </div>}
        </div>
      ) : (
        <div className="message-stream-layout">
          {olderHistoryAvailable && (
            <div className="history-older-status" role="status" aria-live="polite">
              {isLoadingOlderHistory ? '正在加载更早的消息…' : '向上滚动以加载更早的消息'}
            </div>
          )}
          <div
            className="messages-list"
            style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
          >
            {virtualRows.map((virtualRow) => {
              const { message: msg, startIndex, endIndex } = presentationRows[virtualRow.index];
              const index = startIndex;
              const messageId = String(msg.id || `msg_${index}`);
              const turnId = msg.turnId ? String(msg.turnId) : null;
              const isCurrentTurn = hasActiveTurn && (
                activeTurnId
                  ? activeTurnId === turnId
                  : lastAssistantIndexByTurn.get(turnId) === lastAssistantMessageIndex
              );
              const modelTimingPlacement = turnId && !isCurrentTurn
                ? modelTimingPlacementByTurn.get(turnId)
                : null;
              // The active Turn remains stable while sampling and tools alternate; list position does not.
              const isCurrentTurnSegment = msg.role === 'assistant'
                && hasActiveTurn
                && (activeTurnId && turnId
                  ? activeTurnId === turnId
                    && lastAssistantIndexByTurn.get(activeTurnId) >= startIndex
                    && lastAssistantIndexByTurn.get(activeTurnId) <= endIndex
                  : endIndex === lastAssistantMessageIndex);
              const turnEntry = msg.role === 'user'
                ? entryByMessageId.get(messageId)
                : (turnId ? entryByTurnId.get(turnId) : null);
              const isChildTaskTurn = displayMessages
                .slice(startIndex, endIndex + 1)
                .some((message, messageIndex) => (
                  childTaskBatchByMessage.delegateMessageKeys.has(
                    String(message.id || `msg_${startIndex + messageIndex}`),
                  )
                ));
              return (
                <div
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  data-virtual-message-row="true"
                  data-history-row-index={virtualRow.index}
                  data-history-message-id={messageId}
                  className="virtual-message-row"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {turnDurationAnchors.before.has(index) && (
                    <TurnDurationLabel
                      entry={turnDurationAnchors.before.get(index)}
                      nowMs={nowMs}
                      isRunning={hasActiveTurn && activeTurnEntry?.id === turnDurationAnchors.before.get(index).id}
                    />
                  )}
                  <MessageItem
                    message={msg}
                    threadId={traceScope?.threadId}
                    projectId={traceScope?.projectId}
                    isLast={endIndex === displayMessages.length - 1}
                    isLastInTurn={turnId
                      ? lastAssistantIndexByTurn.get(turnId) === endIndex
                      : endIndex === displayMessages.length - 1}
                    isCurrentTurnSegment={isCurrentTurnSegment}
                    isGenerating={isGenerating}
                    pendingApproval={pendingApproval}
                    pendingApprovals={pendingApprovals}
                    pendingUserQuestion={pendingUserQuestion}
                    onRespondApproval={onRespondApproval}
                    onRespondUserQuestion={onRespondUserQuestion}
                    approvalActionsDisabled={attentionActionsDisabled}
                    approvalBlockedMessage={attentionBlockedMessage}
                    isInterrupting={statusModel?.lifecycle === 'stopping'}
                    reconciliationCalls={recoveryCalls}
                    reconcileExecutionBusy={reconcileExecutionBusy}
                    onReconcileExecution={onReconcileExecution}
                    policy={policy}
                    onRetryPrompt={onRetryPrompt}
                    turnEntry={turnEntry}
                    isTurnFocused={Boolean(turnEntry && focusedTurnId && focusedTurnId === (turnEntry.turnId || turnEntry.id))}
                    anchorRef={(node) => setMessageRef(messageId, node)}
                    childTaskBatch={childTaskBatchByMessage.batches.get(messageId) || null}
                    isChildTaskTurn={isChildTaskTurn}
                    modelTimingForPrompt={msg.role === 'user'
                      && modelTimingPlacement?.inputMessageId === messageId
                      ? modelTimingPlacement.modelTiming
                      : null}
                    modelTimingDisplayedOnPrompt={msg.role === 'assistant'
                      && Boolean(modelTimingPlacement)}
                  />
                  {turnDurationAnchors.after.has(index) && (
                    <TurnDurationLabel
                      entry={turnDurationAnchors.after.get(index)}
                      nowMs={nowMs}
                      isRunning={hasActiveTurn && activeTurnEntry?.id === turnDurationAnchors.after.get(index).id}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pendingUserQuestion && !hasQuestionMessage && (
        <div className="chat-attention-fallback">
          <p>{attentionActionsDisabled
            ? `${attentionBlockedMessage || '当前会话状态尚未确认'}。问题详情同步后再提交回答。`
            : '待回答问题尚未关联到会话活动，仍可在此提交回答。'}</p>
          <ToolCard
            tool={{
              id: questionTarget?.callId || undefined,
              name: 'ask_user',
              status: 'running',
            }}
            pendingUserQuestion={pendingUserQuestion}
            onRespondUserQuestion={onRespondUserQuestion}
            approvalActionsDisabled={attentionActionsDisabled}
          />
        </div>
      )}

      {(isIncompleteTurnStatus(lastTurnResult?.status)
        || isIncompleteTurnStatus(lastTurnResult?.stopReason)) && !hasActiveTurn && (
        <div className="turn-status-banner" role="status" aria-live="polite">
          <strong>
            {lastTurnResult.status === 'step_limit'
              ? '本轮达到运行步数上限'
              : lastTurnResult.status === 'failed'
                ? '本轮执行失败'
              : lastTurnResult.status === 'cancelled' || lastTurnResult.status === 'interrupted'
                ? '本轮已中断'
                : lastTurnResult.status === 'unknown'
                  ? '本轮状态未知'
                : '本轮未完整结束'}
          </strong>
          <span>
            {lastTurnResult.status === 'step_limit'
              && statusModel?.executionSettings?.continuationMode === 'manual'
              ? '手动推进已暂停在当前检查点。'
              : null}
            {lastTurnResult.steps
              ? `已执行 ${lastTurnResult.steps} 步。`
              : '已保留当前检查点。'}
            {lastTurnResult.error && lastTurnResult.recovery?.status !== 'needs_reconciliation' && (
              <span className="turn-error-detail" title={lastTurnResult.error}>
                {' '}原因：{formatTurnError(lastTurnResult.error)}
              </span>
            )}
            {' '}{lastTurnResult.status === 'failed'
              || lastTurnResult.stopReason === 'failed'
              ? '重试请点本轮输入旁的“重新发送此提示词”；这会发起新请求，不会续接已断开的请求。'
              : formatIncompleteTurnHint(lastTurnResult)}
          </span>
          {(recoveryPhaseLabel || recoveryProgressTime) && (
            <small className="turn-recovery-progress">
              {recoveryPhaseLabel && `阶段：${recoveryPhaseLabel}`}
              {recoveryPhaseLabel && recoveryProgressTime && ' · '}
              {recoveryProgressTime && `最近进展 ${recoveryProgressTime}`}
            </small>
          )}
          {lastTurnResult.recovery?.status === 'waiting_for_continue' && onResumeExecution && (
            <button
              type="button"
              className="turn-recovery-button"
              data-attention-kind="continue"
              disabled={resumeExecutionBusy || attentionActionsDisabled}
              onClick={onResumeExecution}
            >
              {resumeExecutionBusy ? '正在继续…' : '继续当前 Turn'}
            </button>
          )}
          {lastTurnResult.recovery?.status === 'needs_reconciliation' && (
            <div className="turn-reconciliation-list">
              {recoveryCalls
                .filter((call) => {
                  const callId = call.tool_call_id || call.toolCallId || '';
                  return !callId || !timelineToolCallIds.has(String(callId));
                })
                .map((call) => {
                const toolCallId = call.tool_call_id || call.toolCallId || '';
                return (
                  <TurnReconciliationForm
                    key={toolCallId}
                    call={call}
                    busy={reconcileExecutionBusy}
                    disabled={attentionActionsDisabled}
                    blockedMessage={attentionBlockedMessage}
                    onSubmit={onReconcileExecution}
                  />
                );
              })}
              {recoveryCalls.some((call) => {
                const callId = call.tool_call_id || call.toolCallId || '';
                return !callId || !timelineToolCallIds.has(String(callId));
              }) && <button
                type="button"
                className="turn-recovery-button"
                onClick={() => {
                  const turnId = lastTurnResult.recovery?.turn_id
                    || lastTurnResult.recovery?.turnId
                    || lastTurnResult.turnId;
                  const entry = turnEntries.find((item) => (
                    String(item.turnId || item.id || '') === String(turnId || '')
                  ));
                  if (!scrollToEntry(entry)) scrollToCurrentTurn();
                }}
                >
                查看待核对活动
              </button>}
            </div>
          )}
        </div>
      )}

    </div>
  );

  return (
    <div className="chat-area-frame">
      {turnEntries.length > 0 && (
        <div className="session-turn-rail-viewport">
          <SessionTurnRail
            entries={turnEntries}
            onSelectTurn={selectTurn}
            focusedTurnId={focusedTurnId}
          />
        </div>
      )}
      {chatContent}
      {(isScrolledUp || hasNewActivity) && (
        <button
          className="btn-scroll-bottom"
          onClick={hasNewActivity ? scrollToCurrentTurn : scrollToBottom}
          title={hasNewActivity ? '跳转到当前 Turn 的最新活动' : '回到底部最新消息'}
        >
          <ArrowDown size={12} />
          <span>{hasNewActivity ? '有新活动 · 查看当前 Turn' : '回到底部'}</span>
        </button>
      )}
    </div>
  );
}
