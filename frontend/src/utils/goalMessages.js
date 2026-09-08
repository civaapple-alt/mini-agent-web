/**
 * Convert the internal Goal turn prompt into a bounded, user-visible message.
 * The full autonomous prompt remains an execution detail and must not be
 * rendered as if it were a normal user question.
 */
export const GOAL_TURN_PROMPT_PREFIX = 'Autonomous Goal Mode is active.';
const GOAL_OBJECTIVE_MARKER = '\n\nObjective:\n';

export function extractGoalObjective(text) {
  if (typeof text !== 'string' || !text.startsWith(GOAL_TURN_PROMPT_PREFIX)) {
    return '';
  }
  const markerIndex = text.indexOf(GOAL_OBJECTIVE_MARKER);
  return markerIndex === -1
    ? ''
    : text.slice(markerIndex + GOAL_OBJECTIVE_MARKER.length).trim();
}

export function createGoalMessage(objective, id = null) {
  const normalizedObjective = typeof objective === 'string' ? objective.trim() : '';
  return {
    id: id || `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role: 'user',
    text: `/goal ${normalizedObjective}`,
    isGoal: true,
    messageKind: 'goal',
    goalObjective: normalizedObjective,
    thinking: '',
    tools: [],
    blocks: [{ type: 'text', content: `/goal ${normalizedObjective}` }],
  };
}

export function appendGoalMessage(messages, goal) {
  const objective = typeof goal === 'string' ? goal.trim() : goal?.objective?.trim();
  if (!objective) return messages;
  if (messages.some((message) => message.isGoal && message.goalObjective === objective)) {
    return messages;
  }
  return [...messages, createGoalMessage(objective)];
}

const VERIFICATION_LABELS = {
  running: 'Verify 进行中',
  completed: 'Verify 已完成',
  failed: 'Verify 失败',
};

export function createGoalVerificationMessage(goal, id = null) {
  const status = goal?.verification_status || goal?.verificationStatus;
  const label = VERIFICATION_LABELS[status] || 'Goal Verify';
  const milestone = goal?.current_milestone || goal?.currentMilestone;
  const total = goal?.total_milestones || goal?.totalMilestones;
  const progress = milestone && total ? `第 ${milestone}/${total} 个里程碑` : '当前里程碑';
  let text = `${label}：${progress}。`;
  if (status === 'running') {
    text += ' 正在读取已结算检查点并独立评估。验收依据：goal/plan.md；结果将写入：goal/verifier_verdict.md。';
  } else if (status === 'completed') {
    const score = goal?.last_verifier_score ?? goal?.lastVerifierScore;
    text += ` 已生成验证结果${score === null || score === undefined ? '' : `，评分 ${score}`}。详情：goal/verifier_verdict.md。`;
  } else if (status === 'failed') {
    const error = goal?.last_error || goal?.lastError;
    text += ` ${error || '请打开 Goal 详情检查验证结果。'}`;
  }
  return {
    id: id || `goal_verify_${goal?.thread_id || goal?.threadId || 'default'}_${status}_${goal?.updated_at || goal?.updatedAt || Date.now()}`,
    role: 'system',
    text,
    messageKind: 'goal_verification',
    thinking: '',
    tools: [],
    blocks: [],
  };
}
