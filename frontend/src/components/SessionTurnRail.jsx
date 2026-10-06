import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { createPortal } from 'react-dom';
import { getInputTraceSourceLabel } from '../utils/inputTrace';

function tooltipDetails(entry) {
  const stateLabel = entry?.isCurrent ? entry.stateLabel : entry?.state === 'unknown'
    ? '历史'
    : entry?.stateLabel;
  const response = entry?.responseSummary
    || (entry?.isCurrent
      ? entry?.actionHint || '当前 Turn 正在运行'
      : stateLabel || '状态未知');
  const metrics = [
    Number.isFinite(entry?.metrics?.steps) ? `已执行 ${entry.metrics.steps} 步` : null,
    entry?.metrics?.toolCount > 0 ? `工具 ${entry.metrics.toolCount} 次` : null,
    entry?.metrics?.shellCount > 0 ? `命令 ${entry.metrics.shellCount} 次` : null,
  ].filter(Boolean).join(' · ');
  const sourceLabel = entry?.source && entry.source !== 'user'
    ? [getInputTraceSourceLabel(entry.source), entry.sourceDetail].filter(Boolean).join(' · ')
    : null;

  return { response, metrics, sourceLabel };
}

export default function SessionTurnRail({
  entries = [],
  onSelectTurn,
  focusedTurnId = null,
}) {
  const [activeTooltip, setActiveTooltip] = useState(null);
  const railRef = useRef(null);
  const activeAnchor = useRef(null);
  const hideTimer = useRef(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => railRef.current,
    initialRect: { width: 24, height: 240 },
    initialOffset: 0,
    estimateSize: () => 24,
    getItemKey: (index) => String(entries[index]?.turnId || entries[index]?.id || index),
    overscan: 6,
  });

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const positionTooltip = useCallback((anchor) => {
    const rect = anchor.getBoundingClientRect();
    const maxWidth = Math.min(360, window.innerWidth - 16);
    const halfHeight = Math.min(72, Math.max(0, window.innerHeight / 2 - 8));
    const centerY = rect.top + rect.height / 2;
    return {
      left: Math.max(8, Math.min(rect.right + 8, window.innerWidth - maxWidth - 8)),
      top: Math.max(8 + halfHeight, Math.min(centerY, window.innerHeight - 8 - halfHeight)),
    };
  }, []);

  const showTooltip = useCallback((entry, anchor) => {
    clearHideTimer();
    activeAnchor.current = anchor;
    setActiveTooltip({ entry, ...tooltipDetails(entry), ...positionTooltip(anchor) });
  }, [clearHideTimer, positionTooltip]);

  const scheduleHideTooltip = useCallback(() => {
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => {
      activeAnchor.current = null;
      setActiveTooltip(null);
      hideTimer.current = null;
    }, 120);
  }, [clearHideTimer]);

  const refreshTooltipPosition = useCallback(() => {
    if (!activeAnchor.current) return;
    const position = positionTooltip(activeAnchor.current);
    setActiveTooltip((current) => current ? { ...current, ...position } : current);
  }, [positionTooltip]);

  useEffect(() => () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const anchor = activeAnchor.current;
      if (!anchor) return;
      const position = positionTooltip(anchor);
      setActiveTooltip((current) => current ? { ...current, ...position } : current);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [positionTooltip]);

  const tooltip = activeTooltip && (
    <div
      id={`session-turn-tooltip-${activeTooltip.entry?.turnId || activeTooltip.entry?.id || 'current'}`}
      className="session-turn-node-popover is-visible"
      role="tooltip"
      style={{ left: activeTooltip.left, top: activeTooltip.top }}
      onMouseEnter={clearHideTimer}
      onMouseLeave={scheduleHideTooltip}
    >
      <span className="session-turn-popover-input">
        {activeTooltip.entry?.summary || '（空输入）'}
      </span>
      {activeTooltip.sourceLabel && (
        <span className="session-turn-popover-source">来源：{activeTooltip.sourceLabel}</span>
      )}
      <span className="session-turn-popover-response">{activeTooltip.response}</span>
      {activeTooltip.metrics && (
        <span className="session-turn-popover-metrics">{activeTooltip.metrics}</span>
      )}
    </div>
  );

  return (
    <>
      <nav
        ref={railRef}
        className="session-turn-rail"
        aria-label="Session Turn 导航"
        onScroll={refreshTooltipPosition}
      >
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
          const entry = entries[virtualRow.index];
          const { response } = tooltipDetails(entry);
          const entryKey = entry?.turnId || entry?.id;
          const isFocused = focusedTurnId && focusedTurnId === entryKey;
          const tooltipId = `session-turn-tooltip-${entry?.turnId || entry?.id || 'current'}`;
          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <button
                type="button"
                className={`session-turn-node state-${entry?.state || 'unknown'} ${entry?.isCurrent ? 'is-current' : ''} ${isFocused ? 'is-focused' : ''}`}
                onClick={() => onSelectTurn?.(entry)}
                onMouseEnter={(event) => showTooltip(entry, event.currentTarget)}
                onMouseLeave={scheduleHideTooltip}
                onFocus={(event) => showTooltip(entry, event.currentTarget)}
                onBlur={scheduleHideTooltip}
                aria-label={`${entry?.summary || '当前输入'}，${response}`}
                aria-describedby={activeTooltip?.entry === entry ? tooltipId : undefined}
                aria-current={entry?.isCurrent ? 'step' : undefined}
              >
                <span className="session-turn-node-mark" aria-hidden="true" />
              </button>
            </div>
          );
          })}
        </div>
      </nav>
      {tooltip && createPortal(tooltip, document.body)}
    </>
  );
}
