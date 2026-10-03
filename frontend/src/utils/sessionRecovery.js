import { isIncompleteTurnStatus } from './turnHistory.js';

/** Whether the authoritative status snapshot has no active Turn. */
export function isRuntimeSettled(status) {
  return ['idle', 'completed', 'failed'].includes(status?.phase);
}

/** Project the durable stop cause and progress while a Turn awaits recovery. */
export function projectRecoverableTurnResult(checkpoint = {}, recovery = null) {
  const session = checkpoint?.session || {};
  const result = recovery || checkpoint?.execution_recovery || checkpoint?.executionRecovery || {};
  const recoveryTurnId = result.turn_id || result.turnId || null;
  const checkpointTurnId = checkpoint.last_turn_id || session.last_turn_id || null;
  const sameTurn = !recoveryTurnId
    || !checkpointTurnId
    || String(recoveryTurnId) === String(checkpointTurnId);
  const checkpointStatus = sameTurn
    ? checkpoint.last_turn_status || session.last_turn_status
    : null;
  const status = isIncompleteTurnStatus(checkpointStatus)
    ? checkpointStatus
    : isIncompleteTurnStatus(result.reason)
      ? result.reason
      : 'in_progress';

  return {
    status,
    turnId: recoveryTurnId || checkpointTurnId,
    stopReason: (sameTurn && (checkpoint.last_stop_reason || session.last_stop_reason))
      || result.reason
      || null,
    steps: sameTurn
      ? checkpoint.last_turn_steps ?? session.last_turn_steps ?? 0
      : 0,
    error: result.status === 'needs_reconciliation'
      ? result.reason || null
      : sameTurn
        ? checkpoint.last_turn_error || session.last_turn_error || null
        : null,
    recovery: result,
  };
}

/** Reload the authoritative snapshot when a stop may have settled or advanced. */
export function shouldRefreshAfterInterruptStatus(status, interruptedTurnId) {
  if (!interruptedTurnId) return false;
  const runtimeTurnId = status?.turn_id || status?.turnId;
  return isRuntimeSettled(status)
    || Boolean(runtimeTurnId && String(runtimeTurnId) !== String(interruptedTurnId));
}

/** Reconcile a replay response after its retained event window has a gap. */
export function projectReplayPage(page) {
  const events = Array.isArray(page?.data) ? page.data : [];
  const eventSequence = events.reduce((latest, event) => {
    const sequence = Number(event?.sequence);
    return Number.isSafeInteger(sequence) && sequence >= 0
      ? Math.max(latest, sequence)
      : latest;
  }, 0);
  const cursor = Number(page?.next_cursor ?? page?.nextCursor);
  const nextCursor = Number.isSafeInteger(cursor) && cursor >= 0
    ? Math.max(cursor, eventSequence)
    : eventSequence;
  const hasGap = page?.has_gap === true || page?.hasGap === true;
  const oldest = Number(page?.oldest_sequence ?? page?.oldestSequence);
  const gapBoundary = hasGap && Number.isSafeInteger(oldest) && oldest > 1
    ? oldest - 1
    : null;

  return {
    hasGap,
    cursor: nextCursor > 0 ? nextCursor : gapBoundary,
    events: hasGap ? [] : events,
  };
}
