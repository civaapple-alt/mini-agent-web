import React from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Loader2, ShieldAlert } from 'lucide-react';
import { formatDuration } from '../utils/turnHistory';

const STATE_ICONS = {
  running: Loader2,
  approval: ShieldAlert,
  stopping: Loader2,
  completed: CheckCircle2,
  failed: AlertCircle,
  interrupted: AlertCircle,
  step_limit: AlertCircle,
  unknown: Clock3,
};

function metricParts(metrics = {}) {
  const parts = [];
  if (Number.isFinite(metrics.steps)) parts.push(`已执行 ${metrics.steps} 步`);
  if (metrics.toolCount > 0) parts.push(`工具 ${metrics.toolCount} 次`);
  if (metrics.shellCount > 0) parts.push(`命令 ${metrics.shellCount} 次`);
  if (metrics.thinkingCount > 0) parts.push(`思考 ${metrics.thinkingCount} 段`);
  const duration = formatDuration(metrics.durationMs);
  if (duration) parts.push(`用时 ${duration}`);
  return parts;
}

export default function TurnActivitySummary({ turn, status, metrics }) {
  const state = status || turn?.state || 'unknown';
  const Icon = STATE_ICONS[state] || Clock3;
  const parts = metricParts(metrics || turn?.metrics);
  const actionHint = turn?.actionHint;
  return (
    <section
      className={`turn-activity-summary state-${state} ${turn?.isCurrent ? 'is-current' : ''}`}
      aria-label={`本轮摘要：${turn?.stateLabel || '状态未知'}`}
      aria-live={turn?.isCurrent ? 'polite' : undefined}
    >
      <div className="turn-activity-summary-header">
        <span className="turn-activity-summary-title">
          <Icon size={13} className={state === 'running' || state === 'stopping' ? 'turn-summary-spin' : ''} />
          {turn?.isCurrent ? '当前 Turn' : '本轮摘要'} · {turn?.stateLabel || '状态未知'}
        </span>
        {turn?.isCurrent && <span className="turn-activity-current-mark">实时</span>}
      </div>
      {parts.length > 0 && (
        <div className="turn-activity-summary-metrics">{parts.join(' · ')}</div>
      )}
      {parts.length === 0 && state === 'running' && (
        <div className="turn-activity-summary-metrics">正在接收运行事件</div>
      )}
      {state === 'approval' && (
        <div className="turn-activity-summary-detail">敏感操作已暂停 · 请处理下方审批</div>
      )}
      {actionHint && state !== 'approval' && (
        <div className="turn-activity-summary-detail">{actionHint}</div>
      )}
      {turn?.metrics?.toolCount > 0 && (
        <details className="turn-activity-details">
          <summary>
            <ChevronDown size={12} />
            查看已完成步骤
          </summary>
          <div className="turn-activity-details-copy">
            完整思考和工具输出仍保留在下方内容中，可展开查看或复制。
          </div>
        </details>
      )}
    </section>
  );
}
