/**
 * The session list only needs to answer whether a Turn is active. A locked
 * Session process may be idle while it waits for the next user turn.
 */
export function getThreadStatusPresentation(thread = {}) {
  const turnActive = Boolean(
    thread.turn_active ?? thread.last_turn_status === 'in_progress',
  );
  return {
    turnActive,
    isRunning: turnActive,
  };
}
