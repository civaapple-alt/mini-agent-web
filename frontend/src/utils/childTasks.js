export const childTaskStatusLabels = {
  queued: '排队中',
  running: '运行中',
  in_progress: '运行中',
  awaiting_approval: '等待审批',
  cancelling: '正在取消',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  step_limit: '达到步数限制',
};

export const childTaskLifecycleLabels = {
  queued: '已分配',
  running: '已开始',
  in_progress: '已开始',
  awaiting_approval: '等待审批',
  cancelling: '正在取消',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  step_limit: '达到步数限制',
};

const collapsedChildTaskStatuses = new Set(['completed', 'cancelled', 'step_limit']);
const prioritizedChildTaskStatuses = new Set([
  'running',
  'in_progress',
  'awaiting_approval',
  'queued',
  'cancelling',
]);

export function getChildTaskStatus(task) {
  return typeof task?.status === 'string' && task.status ? task.status : 'queued';
}

export function orderChildTasksForRuntime(children) {
  return children
    .map((child, index) => ({ child, index }))
    .sort((left, right) => {
      const leftStatus = getChildTaskStatus(left.child);
      const rightStatus = getChildTaskStatus(right.child);
      const leftPriority = prioritizedChildTaskStatuses.has(leftStatus) ? 0 : 1;
      const rightPriority = prioritizedChildTaskStatuses.has(rightStatus) ? 0 : 1;
      return leftPriority - rightPriority || left.index - right.index;
    })
    .map(({ child }) => child);
}

export function isCollapsedChildTask(task) {
  return collapsedChildTaskStatuses.has(getChildTaskStatus(task));
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
