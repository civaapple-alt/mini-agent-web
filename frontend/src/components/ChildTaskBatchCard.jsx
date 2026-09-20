import React from 'react';
import { GitBranch } from 'lucide-react';
import {
  childTaskStatusLabels,
  formatChildTaskDuration,
  formatChildTaskTimestamp,
  getChildTaskAttemptGroups,
  getChildTaskPhaseLabel,
  getChildTaskWaitingReason,
  getLatestChildTaskReport,
} from '../utils/childTasks';
import ChildTaskAttemptHistory from './ChildTaskAttemptHistory';

function ChildTaskRow({ task }) {
  const status = task.status || 'queued';
  const attempts = getChildTaskAttemptGroups(task);
  const currentAttempt = Number.isInteger(task.operation_attempt)
    ? task.operation_attempt
    : (attempts.at(-1)?.attempt || 1);
  const duration = formatChildTaskDuration(task.duration_ms);
  const phase = getChildTaskPhaseLabel(task);
  const waitingReason = getChildTaskWaitingReason(task);
  const latestReport = getLatestChildTaskReport(task);
  const sequenceLabel = task.execution_mode === 'sequential'
    && Number.isInteger(task.group_sequence)
    ? `第 ${task.group_sequence + 1} 步`
    : null;

  return (
    <li className={`delegate-task-row ${status}${task.recovery_required ? ' recovery-required' : ''}`}>
      <div className="delegate-task-heading">
        <strong title={task.child_thread_id || task.operation_id}>{task.title || task.child_thread_id || '子代理任务'}</strong>
        <span className="delegate-task-mode">
          {task.execution_mode === 'sequential'
            ? '顺序'
            : task.execution_mode === 'parallel' ? '并行' : '模式未知'}
          {sequenceLabel ? ` · ${sequenceLabel}` : ''}
          {` · 第 ${currentAttempt} 次`}
        </span>
        <span className={`delegate-task-status ${status}`}>
          {childTaskStatusLabels[status] || status}
          {duration ? ` · ${duration}` : ''}
        </span>
      </div>
      {phase && <p className="delegate-task-phase">当前阶段：{phase}</p>}
      {task.recovery_required && <p className="delegate-task-recovery">子 Session 需要重新连接。</p>}
      <ChildTaskAttemptHistory task={task} className="delegate-task-attempt-history" />
      {waitingReason && (
        <p className="delegate-task-waiting"><strong>等待：</strong>{waitingReason}</p>
      )}
      {latestReport && (
        <p className="delegate-task-report">
          <strong>{latestReport.attempt ? `第 ${latestReport.attempt} 次进展：` : '最新进展：'}</strong>{latestReport.text}
          {latestReport.timestamp_ms && (
            <time>{formatChildTaskTimestamp(latestReport.timestamp_ms)}</time>
          )}
        </p>
      )}
    </li>
  );
}

export default function ChildTaskBatchCard({ tasks }) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  return (
    <section className="delegate-task-batch" aria-label="子代理任务批次">
      <header className="delegate-task-batch-header">
        <GitBranch size={13} />
        <strong>子代理任务</strong>
        <span>{tasks.length}</span>
      </header>
      <ol className="delegate-task-batch-list">
        {tasks.map((task, index) => (
          <ChildTaskRow key={task.operation_id || task.child_thread_id || task.key || index} task={task} />
        ))}
      </ol>
    </section>
  );
}
