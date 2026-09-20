export const childTaskStatusLabels = {
  starting: '启动中',
  pending: '等待启动',
  queued: '排队中',
  running: '运行中',
  in_progress: '运行中',
  awaiting_approval: '等待审批',
  cancelling: '正在取消',
  idle: '空闲',
  not_started: '未开始',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  step_limit: '达到步数限制',
};

export const childTaskLifecycleLabels = {
  pending: '等待启动',
  queued: '已分配',
  not_started: '未开始',
  starting: '启动中',
  running: '已开始',
  in_progress: '已开始',
  awaiting_approval: '等待审批',
  cancelling: '正在取消',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  step_limit: '达到步数限制',
};

const collapsedChildTaskStatuses = new Set(['completed', 'cancelled']);
const runningChildTaskStatuses = new Set(['running', 'in_progress', 'cancelling']);
const attentionChildTaskStatuses = new Set(['awaiting_approval', 'failed', 'step_limit', 'not_started']);

function childTaskPriority(task) {
  const status = getChildTaskStatus(task);
  if (task.recovery_required || attentionChildTaskStatuses.has(status)) return 0;
  if (runningChildTaskStatuses.has(status)) return 1;
  if (status === 'queued' || status === 'pending' || status === 'starting') return 2;
  return 3;
}

const childTaskPhaseLabels = {
  starting_turn: '正在启动',
  model: '模型处理中',
  tool: '执行工具',
  waiting_approval: '等待审批',
  stopping: '正在停止',
  compaction: '整理上下文',
  persisting: '保存结果',
  goal_verification: '检查目标',
  goal_continuation_queued: '等待继续',
  resuming: '恢复中',
  completed: '已完成',
  failed: '失败',
  idle: '空闲',
};

const childTaskAttemptLabels = {
  initial: '初始执行',
  retry: '重试',
  follow_up: '后续委托',
};

function currentAttemptKind(task) {
  return task?.attempt_kind || task?.attemptKind
    || task?.operation_attempt_kind || task?.operationAttemptKind || null;
}

export function getChildTaskStatus(task) {
  return typeof task?.status === 'string' && task.status ? task.status : 'queued';
}

export function orderChildTasksForRuntime(children = []) {
  return (Array.isArray(children) ? children : [])
    .map((child, index) => ({ child, index }))
    .sort((left, right) => {
      const priorityDifference = childTaskPriority(left.child) - childTaskPriority(right.child);
      if (priorityDifference !== 0) return priorityDifference;

      const leftGroup = left.child.operation_group_id;
      const rightGroup = right.child.operation_group_id;
      if (leftGroup && leftGroup === rightGroup) {
        const leftSequence = left.child.group_sequence;
        const rightSequence = right.child.group_sequence;
        if (Number.isInteger(leftSequence) && Number.isInteger(rightSequence) && leftSequence !== rightSequence) {
          return leftSequence - rightSequence;
        }
      }
      return left.index - right.index;
    })
    .map(({ child }) => child);
}

export function isCollapsedChildTask(task) {
  return collapsedChildTaskStatuses.has(getChildTaskStatus(task));
}

export function getChildTaskCounts(children = []) {
  return (Array.isArray(children) ? children : []).reduce((counts, child) => {
    const status = getChildTaskStatus(child);
    if (child.recovery_required || attentionChildTaskStatuses.has(status)) {
      counts.needsAttention += 1;
    } else if (runningChildTaskStatuses.has(status)) {
      counts.running += 1;
    } else if (status === 'queued' || status === 'pending' || status === 'starting') {
      counts.queued += 1;
    } else if (status === 'completed') {
      counts.completed += 1;
    }
    return counts;
  }, { running: 0, queued: 0, needsAttention: 0, completed: 0 });
}

export function getChildTaskAttemptGroups(task, maxGroups = null) {
  const fallbackAttempt = Number.isInteger(task?.operation_attempt) && task.operation_attempt > 0
    ? task.operation_attempt
    : 1;
  let lifecycle = Array.isArray(task?.lifecycle) ? task.lifecycle : [];
  if (lifecycle.length === 0) {
    lifecycle = [];
    if (task?.assigned_at_ms) lifecycle.push({
      status: 'queued',
      timestamp_ms: task.assigned_at_ms,
      attempt_kind: currentAttemptKind(task),
    });
    if (task?.started_at_ms) lifecycle.push({
      status: 'running',
      timestamp_ms: task.started_at_ms,
      attempt_kind: currentAttemptKind(task),
    });
    if (task?.finished_at_ms && task?.status) {
      lifecycle.push({
        status: task.status,
        timestamp_ms: task.finished_at_ms,
        attempt_kind: currentAttemptKind(task),
      });
    }
    if (lifecycle.length === 0 && task?.status) lifecycle.push({
      status: task.status,
      attempt_kind: currentAttemptKind(task),
    });
  }

  const groups = new Map();
  for (const stage of lifecycle) {
    const attempt = Number.isInteger(stage?.attempt) && stage.attempt > 0
      ? stage.attempt
      : fallbackAttempt;
    if (!groups.has(attempt)) groups.set(attempt, { attempt, kind: null, stages: [] });
    const group = groups.get(attempt);
    const stageKind = stage?.attempt_kind || stage?.attemptKind
      || ((attempt === fallbackAttempt) ? currentAttemptKind(task) : null);
    if (typeof stageKind === 'string' && stageKind) group.kind = stageKind;
    group.stages.push(stage);
  }
  const limit = Number.isInteger(maxGroups) && maxGroups > 0 ? maxGroups : groups.size;
  return [...groups.values()].sort((left, right) => left.attempt - right.attempt).slice(-limit);
}

export function getChildTaskAttemptLabel(group) {
  if (!group || !Number.isInteger(group.attempt)) return null;
  const kindLabel = childTaskAttemptLabels[group.kind];
  if (!kindLabel) return `第 ${group.attempt} 轮`;
  if (group.kind === 'initial') return kindLabel;
  return `${kindLabel} · 第 ${group.attempt} 轮`;
}

export function getChildTaskPhaseLabel(task) {
  const phase = nonEmptyText(task?.phase);
  if (!phase || phase === 'idle') return null;
  return childTaskPhaseLabels[phase] || phase.replace(/[_-]+/g, ' ');
}

function nonEmptyText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function reportText(report) {
  if (typeof report === 'string') return report.trim();
  if (!report || typeof report !== 'object' || Array.isArray(report)) return '';
  return nonEmptyText(report.text)
    || nonEmptyText(report.report)
    || nonEmptyText(report.message)
    || nonEmptyText(report.summary)
    || nonEmptyText(report.content);
}

export function getLatestChildTaskReport(task) {
  const reports = Array.isArray(task?.reports) ? task.reports : [];
  const candidate = task?.latest_report || reports[reports.length - 1];
  const text = reportText(candidate);
  if (!text) return null;
  const timestamp = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate.timestamp_ms ?? candidate.reported_at_ms
    : null;
  return {
    text,
    timestamp_ms: Number.isFinite(timestamp) ? timestamp : null,
    attempt: candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && Number.isInteger(candidate.attempt)
      ? candidate.attempt
      : null,
    cursor: candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && Number.isInteger(candidate.cursor)
      ? candidate.cursor
      : null,
  };
}

export function getChildTaskWaitingReason(task) {
  const reason = nonEmptyText(task?.waiting_reason)
    || nonEmptyText(task?.blocked_reason)
    || nonEmptyText(task?.reason);
  if (reason) return reason;
  const waiting = task?.waiting;
  if (waiting && typeof waiting === 'object' && !Array.isArray(waiting)) {
    return nonEmptyText(waiting.reason) || nonEmptyText(waiting.message) || null;
  }
  return null;
}

export function formatChildTaskTimestamp(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatChildTaskDuration(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  if (value < 1000) return `${value} ms`;
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds}.${Math.floor((value % 1000) / 100)}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function objectFrom(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getDelegateTaskAssignments(message) {
  const blocks = Array.isArray(message?.blocks) && message.blocks.length > 0
    ? message.blocks
    : (message?.tools || []).map((tool) => ({ ...tool, type: 'tool' }));
  return blocks
    .filter((block) => block?.type === 'tool' && (block.name || block.toolName || block.tool) === 'delegate_task')
    .map((block, index) => {
      const args = objectFrom(block.arguments ?? block.args ?? block.parameters);
      const output = objectFrom(block.output);
      const childThreadId = args.child_thread_id || args.childThreadId
        || output.child_thread_id || output.childThreadId || null;
      const operationId = args.operation_id || args.operationId
        || output.operation_id || output.operationId || null;
      return {
        key: operationId || childThreadId || block.call_id || block.id || `delegate-${index}`,
        operation_id: operationId,
        child_thread_id: childThreadId,
        title: args.title || args.task_name || args.name || output.title || childThreadId || '子代理任务',
        execution_mode: args.execution_mode || args.executionMode || output.execution_mode || 'parallel',
        operation_group_id: args.operation_group_id || args.group_id || args.groupId
          || output.operation_group_id || null,
        status: block.status === 'failed' || output.status === 'failed' ? 'failed' : 'queued',
      };
    });
}

function taskIdentityMatches(task, assignment) {
  return Boolean(
    (assignment.operation_id && task.operation_id === assignment.operation_id)
    || (assignment.child_thread_id && task.child_thread_id === assignment.child_thread_id)
  );
}

export function buildTurnChildTaskBatch({ children = [], turnId = null, messages = [] }) {
  const assignments = messages.flatMap(getDelegateTaskAssignments);
  if (assignments.length === 0) return [];

  const childrenForTurn = children.filter((child) => {
    const matchesAssignment = assignments.some((assignment) => (
      taskIdentityMatches(child, assignment)
    ));
    if (!turnId) return matchesAssignment;
    return child.parent_turn_id === turnId || (!child.parent_turn_id && matchesAssignment);
  });
  const claimed = new Set();
  const batch = assignments.map((assignment) => {
    const match = childrenForTurn.find((child) => (
      !claimed.has(child.operation_id || child.child_thread_id)
      && taskIdentityMatches(child, assignment)
    ));
    if (!match) return assignment;
    claimed.add(match.operation_id || match.child_thread_id);
    return { ...assignment, ...match, title: match.title || assignment.title };
  });

  childrenForTurn.forEach((child) => {
    const key = child.operation_id || child.child_thread_id;
    if (key && !claimed.has(key)) batch.push(child);
  });
  return batch;
}
