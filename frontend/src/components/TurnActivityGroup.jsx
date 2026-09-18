import React from 'react';
import { ChevronDown, ListChecks } from 'lucide-react';
import ThinkingBlock from './ThinkingBlock';
import ToolCard from './ToolCard';
import ErrorBoundary from './ErrorBoundary';

function activitySummary(items) {
  const thinkingCount = items.filter((item) => item.type === 'thinking').length;
  const toolCount = items.filter((item) => item.type === 'tool').length;
  return [
    `已完成 ${items.length} 步`,
    thinkingCount > 0 ? `思考 ${thinkingCount} 段` : null,
    toolCount > 0 ? `工具 ${toolCount} 次` : null,
  ].filter(Boolean).join(' · ');
}

export default function TurnActivityGroup({ items, policy }) {
  if (!items?.length) return null;
  return (
    <details className="turn-activity-group">
      <summary>
        <ListChecks size={12} />
        <span>{activitySummary(items)}</span>
        <ChevronDown size={12} className="turn-activity-group-chevron" />
      </summary>
      <div className="turn-activity-group-items">
        {items.map((block, index) => {
          if (block.type === 'thinking') {
            return (
              <ThinkingBlock
                key={block.id || `group_thinking_${index}`}
                content={block.content}
                isStreaming={false}
              />
            );
          }
          return (
            <ErrorBoundary
              key={block.id || `group_tool_${index}`}
              compact
              title={`工具 [${block.name || 'tool'}] 渲染异常`}
            >
              <ToolCard tool={block} pendingApproval={null} policy={policy} />
            </ErrorBoundary>
          );
        })}
      </div>
    </details>
  );
}
