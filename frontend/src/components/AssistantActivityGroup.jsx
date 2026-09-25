import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { getManualExpansion, setManualExpansion } from '../utils/activityPresentationState';
import './AssistantActivityGroup.css';

export default function AssistantActivityGroup({
  id,
  presentationId = null,
  items,
  failureCount = 0,
  failureTypes = [],
  children,
}) {
  const expansionId = `assistant-activity-group:${presentationId || id}`;
  const [isExpanded, setIsExpanded] = useState(
    () => getManualExpansion(expansionId) ?? false,
  );
  const thinkingCount = items.filter((item) => item.type === 'thinking').length;
  const toolCount = items.filter((item) => item.type === 'tool').length;
  const counts = [
    thinkingCount > 0 ? `思考 ${thinkingCount}` : null,
    toolCount > 0 ? `工具 ${toolCount}` : null,
  ].filter(Boolean).join(' · ');
  const failureTypeSummary = failureTypes
    .map(({ name, count }) => count > 1 ? `${name} ×${count}` : name)
    .join('、');
  const failureSummary = failureCount > 0
    ? `失败 ${failureCount} 次${failureTypeSummary ? ` · ${failureTypeSummary}` : ''}`
    : null;
  const summaryTitle = `已完成 ${items.length} 项活动`;
  const summaryLabel = [summaryTitle, counts, failureSummary].filter(Boolean).join('，');

  const toggle = () => {
    const nextExpanded = !isExpanded;
    setIsExpanded(nextExpanded);
    setManualExpansion(expansionId, nextExpanded);
  };

  return (
    <section
      className="assistant-activity-group"
      data-activity-group-id={id}
      data-presentation-id={presentationId || undefined}
    >
      <button
        type="button"
        className="assistant-activity-group-summary"
        aria-expanded={isExpanded}
        aria-label={summaryLabel}
        onClick={toggle}
      >
        <Check size={13} aria-hidden="true" />
        <span className="assistant-activity-group-title">{summaryTitle}</span>
        {counts && <span className="assistant-activity-group-counts">{counts}</span>}
        {failureSummary && (
          <span className="assistant-activity-group-failures">{failureSummary}</span>
        )}
        {isExpanded
          ? <ChevronDown size={13} aria-hidden="true" />
          : <ChevronRight size={13} aria-hidden="true" />}
      </button>
      {isExpanded && <div className="assistant-activity-group-items">{children}</div>}
    </section>
  );
}
