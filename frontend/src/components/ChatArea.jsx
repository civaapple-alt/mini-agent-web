import React, { useRef, useEffect, useMemo, useState } from 'react';
import { Sparkles, Terminal, Compass, TestTube2, ArrowDown } from 'lucide-react';
import MessageItem from './MessageItem';
import SessionTurnRail from './SessionTurnRail';
import { collectInputMessages } from '../utils/inputTrace';
import { orderMessagesByTurnHistory } from '../utils/messageState';
import { buildTurnHistoryEntries } from '../utils/turnHistory';
import './ChatArea.css';

export default function ChatArea({
  messages,
  isGenerating,
  pendingApproval,
  lastTurnResult,
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
}) {
  const scrollRef = useRef(null);
  const messageRefs = useRef(new Map());
  const focusTimerRef = useRef(null);
  const hasMountedRef = useRef(false);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [hasNewActivity, setHasNewActivity] = useState(false);
  const [focusedTurnId, setFocusedTurnId] = useState(null);

  const turnEntries = useMemo(() => buildTurnHistoryEntries({
    messages,
    threadItems,
    scope: traceScope,
    statusModel,
    activeTurnId: statusModel?.scope?.turnId,
    lastTurnResult,
  }), [messages, threadItems, traceScope, statusModel, lastTurnResult]);

  const displayMessages = useMemo(() => {
    const projectedInputs = collectInputMessages(messages, threadItems, traceScope);
    const result = [...messages];
    projectedInputs.forEach((input) => {
      const inputTurnId = input.turnId ? String(input.turnId) : null;
      const alreadyRendered = result.some((message) => {
        if (message.role !== 'user') return false;
        if (inputTurnId && message.turnId) return String(message.turnId) === inputTurnId;
        return String(message.text || '').trim() === String(input.text || '').trim();
      });
      if (alreadyRendered) return;
      const assistantIndex = inputTurnId
        ? result.findIndex((message) => (
          message.role === 'assistant' && String(message.turnId || '') === inputTurnId
        ))
        : -1;
      if (assistantIndex >= 0) result.splice(assistantIndex, 0, input);
      else result.push(input);
    });
    return orderMessagesByTurnHistory(result, threadItems);
  }, [messages, threadItems, traceScope]);

  const entryByMessageId = useMemo(
    () => new Map(turnEntries.map((entry) => [String(entry.messageId), entry])),
    [turnEntries],
  );
  const entryByTurnId = useMemo(
    () => new Map(turnEntries.filter((entry) => entry.turnId).map((entry) => [String(entry.turnId), entry])),
    [turnEntries],
  );

  const setMessageRef = (messageId, node) => {
    if (!messageId) return;
    if (node) messageRefs.current.set(String(messageId), node);
    else messageRefs.current.delete(String(messageId));
  };

  const scrollToEntry = (entry) => {
    if (!entry) return;
    const node = messageRefs.current.get(String(entry.messageId));
    if (!node) return;
    const reducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    if (typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    }
    setIsScrolledUp(false);
    setHasNewActivity(false);
    setFocusedTurnId(entry.turnId || entry.id);
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => setFocusedTurnId(null), 1400);
  };

  const selectTurn = (entry) => scrollToEntry(entry);

  const scrollToCurrentTurn = () => {
    const currentEntry = turnEntries.find((entry) => entry.isCurrent)
      || turnEntries[turnEntries.length - 1];
    scrollToEntry(currentEntry);
  };

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const awayFromBottom = distanceFromBottom > 80;
    setIsScrolledUp(awayFromBottom);
    if (!awayFromBottom) setHasNewActivity(false);
  };

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

          <div className="quick-prompts-grid">
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
          </div>
        </div>
      ) : (
        <div className="message-stream-layout">
          <div className="messages-list">
            {displayMessages.map((msg, index) => {
              const messageId = String(msg.id || `msg_${index}`);
              const turnId = msg.turnId ? String(msg.turnId) : null;
              const turnEntry = msg.role === 'user'
                ? entryByMessageId.get(messageId)
                : (turnId ? entryByTurnId.get(turnId) : null);
              return (
                <MessageItem
                  key={msg.id || `msg_${index}`}
                  message={msg}
                  isLast={index === displayMessages.length - 1}
                  isGenerating={isGenerating}
                  pendingApproval={pendingApproval}
                  policy={policy}
                  onRetryPrompt={onRetryPrompt}
                  turnEntry={turnEntry}
                  isTurnFocused={Boolean(turnEntry && focusedTurnId && focusedTurnId === (turnEntry.turnId || turnEntry.id))}
                  anchorRef={(node) => setMessageRef(messageId, node)}
                />
              );
            })}
          </div>
        </div>
      )}

      {lastTurnResult && (
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
            {lastTurnResult.error && (
              <span className="turn-error-detail" title={lastTurnResult.error}>
                {' '}原因：{lastTurnResult.error}
              </span>
            )}
            {' '}当前回答可能不完整，可以继续发送指令推进下一轮。
          </span>
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
