import React from 'react';
import { GitBranch } from 'lucide-react';
import {
  childTaskLifecycleLabels,
  childTaskStatusLabels,
  formatChildTaskDuration,
  formatChildTaskTimestamp,
} from '../utils/childTasks';

function getLifecycle(task) {
  if (Array.isArray(task.lifecycle) && task.lifecycle.length > 0) return task.lifecycle;
  const stages = [];
  if (task.status === 'queued') stages.push({ status: 'queued' });
  if (task.started_at_ms) stages.push({ status: 'running', timestamp_ms: task.started_at_ms });
  if (task.finished_at_ms && task.status) {
    stages.push({ status: task.status, timestamp_ms: task.finished_at_ms });
  }
  if (stages.length === 0 && task.status) stages.push({ status: task.status });
  return stages;
}

function ChildTaskRow({ task }) {
  const status = task.status || 'queued';
  const lifecycle = getLifecycle(task);
  const duration = formatChildTaskDuration(task.duration_ms);
  const isTerminal = ['completed', 'failed', 'cancelled', 'step_limit'].includes(status);

  return (
    <li className={`delegate-task-row ${status}`}>
      <div className="delegate-task-heading">
        <strong title={task.child_thread_id || task.operation_id}>{task.title || task.child_thread_id || '子代理任务'}</strong>
        <span className="delegate-task-mode">{task.execution_mode === 'sequential' ? '顺序' : '并行'}</span>
        <span className={`delegate-task-status ${status}`}>
          {childTaskStatusLabels[status] || status}
          {isTerminal && duration ? ` · ${duration}` : ''}
        </span>
      </div>
      <ol className="delegate-task-lifecycle" aria-label={`${task.title || '子任务'}生命周期`}>
        {lifecycle.map((stage, index) => {
          const timestamp = formatChildTaskTimestamp(stage.timestamp_ms);
          return (
            <li key={`${stage.status}-${stage.attempt ?? 0}-${index}`}>
              <span>{childTaskLifecycleLabels[stage.status] || stage.status}</span>
              {timestamp && <time>{timestamp}</time>}
            </li>
          );
        })}
      </ol>
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
