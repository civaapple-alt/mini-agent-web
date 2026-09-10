/**
 * Keep Turn activity and the SessionStore process lock as separate concepts.
 * A locked process may be idle while it waits for the next user turn.
 */
export function getThreadStatusPresentation(thread = {}) {
  const turnActive = Boolean(
    thread.turn_active ?? thread.last_turn_status === 'in_progress',
  );
  const processOnline = Boolean(
    thread.process_online ?? (
      thread.session_status === 'locked' || thread.runtime_status === 'running'
    ),
  );
  const hasState = Boolean(
    thread.runtime_status ||
      thread.session_status ||
      thread.goal_status ||
      thread.last_turn_status ||
      thread.cleanup_pending ||
      thread.resumable ||
      thread.turn_active ||
      thread.process_online,
  );

  let lifecycleLabel = null;
  let lifecycleClass = 'historical';
  if (hasState) {
    if (turnActive) {
      lifecycleLabel = '运行中';
      lifecycleClass = 'running';
    } else if (
      thread.runtime_status === 'paused' ||
      thread.goal_status === 'paused'
    ) {
      lifecycleLabel = '已暂停';
      lifecycleClass = 'paused';
    } else if (thread.last_turn_status === 'completed' || thread.last_turn_complete) {
      lifecycleLabel = '已完成';
      lifecycleClass = 'completed';
    } else if (
      thread.last_turn_status === 'cancelled' ||
      thread.last_turn_status === 'interrupted'
    ) {
      lifecycleLabel = '已中断';
      lifecycleClass = 'interrupted';
    } else if (thread.last_turn_status === 'step_limit') {
      lifecycleLabel = '回答未完成';
      lifecycleClass = 'step-limit';
    } else if (thread.last_turn_status === 'failed') {
      lifecycleLabel = '运行失败';
      lifecycleClass = 'failed';
    } else if (thread.cleanup_pending) {
      lifecycleLabel = '清理待处理';
      lifecycleClass = 'cleanup';
    } else if (thread.resumable) {
      lifecycleLabel = '可恢复';
      lifecycleClass = 'resumable';
    } else {
      lifecycleLabel = '历史';
    }
  }

  return {
    turnActive,
    processOnline,
    lifecycleLabel,
    lifecycleClass,
    processLabel: processOnline ? (turnActive ? '在线' : '待命') : null,
  };
}
