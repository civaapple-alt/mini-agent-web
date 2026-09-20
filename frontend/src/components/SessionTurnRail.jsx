import React from 'react';
import { getInputTraceSourceLabel } from '../utils/inputTrace';

export default function SessionTurnRail({
  entries = [],
  onSelectTurn,
  focusedTurnId = null,
}) {
  return (
    <nav className="session-turn-rail" aria-label="Session Turn 导航">
      {entries.map((entry) => {
        const stateLabel = entry?.isCurrent ? entry.stateLabel : entry?.state === 'unknown'
          ? '历史'
          : entry?.stateLabel;
        const entryKey = entry?.turnId || entry?.id;
        const isFocused = focusedTurnId && focusedTurnId === entryKey;
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
          ? getInputTraceSourceLabel(entry.source)
          : null;
        return (
          <button
            key={entryKey}
            type="button"
            className={`session-turn-node state-${entry?.state || 'unknown'} ${entry?.isCurrent ? 'is-current' : ''} ${isFocused ? 'is-focused' : ''}`}
            onClick={() => onSelectTurn?.(entry)}
            aria-label={`${entry?.summary || '当前输入'}，${response}`}
            aria-current={entry?.isCurrent ? 'step' : undefined}
          >
            <span className="session-turn-node-mark" aria-hidden="true" />
            <span className="session-turn-node-popover" role="tooltip">
              <span className="session-turn-popover-input">
                {entry?.summary || '（空输入）'}
              </span>
              {sourceLabel && (
                <span className="session-turn-popover-source">来源：{sourceLabel}</span>
              )}
              <span className="session-turn-popover-response">{response}</span>
              {metrics && <span className="session-turn-popover-metrics">{metrics}</span>}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
