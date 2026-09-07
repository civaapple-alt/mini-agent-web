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
