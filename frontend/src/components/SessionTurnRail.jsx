import React from 'react';
import { Circle, Navigation, Target } from 'lucide-react';
import { getInputTraceSourceLabel } from '../utils/inputTrace';

const SOURCE_ICONS = {
  steer: Navigation,
  goal: Target,
  user: Circle,
};

export default function SessionTurnRail({
  entries = [],
  onSelectTurn,
  focusedTurnId = null,
}) {
  return (
    <nav className="session-turn-rail" aria-label="Session Turn 导航">
      {entries.map((entry) => {
        const Icon = SOURCE_ICONS[entry?.source] || Circle;
        const sourceLabel = getInputTraceSourceLabel(entry?.source);
        const stateLabel = entry?.isCurrent ? entry.stateLabel : entry?.state === 'unknown'
          ? '历史'
          : entry?.stateLabel;
        const entryKey = entry?.turnId || entry?.id;
        const isFocused = focusedTurnId && focusedTurnId === entryKey;
        return (
          <button
            key={entryKey}
            type="button"
            className={`session-turn-node state-${entry?.state || 'unknown'} ${entry?.isCurrent ? 'is-current' : ''} ${isFocused ? 'is-focused' : ''}`}
            onClick={() => onSelectTurn?.(entry)}
            title={`${entry?.summary || '当前输入'} · ${stateLabel || '状态未知'}`}
            aria-label={`${entry?.summary || '当前输入'}，${stateLabel || '状态未知'}`}
            aria-current={entry?.isCurrent ? 'step' : undefined}
          >
            <span className="session-turn-node-icon" aria-hidden="true">
              <Icon size={11} />
            </span>
            <span className="session-turn-node-copy">
              <span className="session-turn-node-summary">{entry?.summary || '（空输入）'}</span>
              <span className="session-turn-node-state">
                {sourceLabel} · {stateLabel || '状态未知'}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
