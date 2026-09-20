import React from 'react';
import {
  childTaskLifecycleLabels,
  getChildTaskAttemptLabel,
  formatChildTaskTimestamp,
  getChildTaskAttemptGroups,
} from '../utils/childTasks';
import './ChildTaskAttemptHistory.css';

export default function ChildTaskAttemptHistory({ task, className = '' }) {
  const attempts = getChildTaskAttemptGroups(task);
  if (attempts.length === 0) return null;

  return (
    <ol
      className={`child-task-attempt-history ${className}`.trim()}
      aria-label={`${task.title || '子任务'}最近尝试阶段`}
    >
      {attempts.map(({ attempt, kind, stages }) => (
        <li key={attempt} className="child-task-attempt">
          <strong>{getChildTaskAttemptLabel({ attempt, kind })}</strong>
          <span className="child-task-attempt-stages">
            {stages.map((stage, index) => {
              const timestamp = formatChildTaskTimestamp(stage.timestamp_ms);
              return (
                <React.Fragment key={`${attempt}-${stage.status}-${stage.timestamp_ms || index}`}>
                  {index > 0 && <span className="child-task-stage-separator" aria-hidden="true">→</span>}
                  <span className={`child-task-stage ${stage.status || ''}`}>
                    {childTaskLifecycleLabels[stage.status] || stage.status || '状态已更新'}
                    {timestamp && <time>{timestamp}</time>}
                  </span>
                </React.Fragment>
              );
            })}
          </span>
        </li>
      ))}
    </ol>
  );
}
