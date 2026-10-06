const subscribers = new Map();
const eventBuffers = new Map();
// A child viewer may open after the page has already received its live events.
const MAX_BUFFERED_THREADS = 16;
const MAX_BUFFERED_EVENTS_PER_THREAD = 256;
const MAX_BUFFERED_EVENT_CHARS_PER_THREAD = 256 * 1024;
const BUFFERABLE_EVENT_TYPES = new Set([
  'turn_started',
  'assistant_reasoning_delta',
  'assistant_text_delta',
  'model_responded',
  'tool_started',
  'tool_finished',
  'context_compaction_started',
  'context_compaction_finished',
]);

function eventSequence(data) {
  const sequence = Number(data?.sequence);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
}

function bufferEvent(key, data) {
  const sequence = eventSequence(data);
  if (sequence === null) return;

  const eventType = data.event?.type;
  if (!BUFFERABLE_EVENT_TYPES.has(eventType)) return;

  const event = { type: eventType };
  if (eventType === 'assistant_reasoning_delta' || eventType === 'assistant_text_delta') {
    if (typeof data.event.delta !== 'string') return;
    event.delta = data.event.delta;
  } else if (eventType === 'turn_started') {
    const input = data.items?.find((item) => item.type === 'userMessage');
    if (typeof input?.text === 'string') event.prompt = input.text;
  }

  const bufferedEvent = {
    type: 'event',
    sequence,
    threadId: data.threadId || data.thread_id,
    projectId: data.projectId || data.project_id || null,
    event,
  };
  const turnId = data.turnId || data.turn_id;
  const itemId = data.itemId || data.item_id;
  const turnSource = data.turnSource || data.turn_source;
  if (turnId) bufferedEvent.turnId = turnId;
  if (itemId) bufferedEvent.itemId = itemId;
  if (turnSource) bufferedEvent.turnSource = turnSource;
  if (['model_responded', 'tool_started', 'tool_finished', 'context_compaction_started', 'context_compaction_finished'].includes(eventType)) {
    bufferedEvent.items = Array.isArray(data.items) ? data.items.slice(0, 32) : [];
  }

  let serialized;
  try {
    serialized = JSON.stringify(bufferedEvent);
  } catch {
    return;
  }
  if (typeof serialized !== 'string' || serialized.length > MAX_BUFFERED_EVENT_CHARS_PER_THREAD) {
    return;
  }

  const buffer = eventBuffers.get(key) || { events: new Map(), chars: 0 };
  if (buffer.events.has(sequence)) return;
  buffer.events.set(sequence, { data: bufferedEvent, chars: serialized.length });
  buffer.chars += serialized.length;

  while (
    buffer.events.size > MAX_BUFFERED_EVENTS_PER_THREAD
    || buffer.chars > MAX_BUFFERED_EVENT_CHARS_PER_THREAD
  ) {
    const oldestSequence = buffer.events.keys().next().value;
    const oldest = buffer.events.get(oldestSequence);
    buffer.events.delete(oldestSequence);
    buffer.chars -= oldest?.chars || 0;
  }

  eventBuffers.delete(key);
  eventBuffers.set(key, buffer);
  while (eventBuffers.size > MAX_BUFFERED_THREADS) {
    eventBuffers.delete(eventBuffers.keys().next().value);
  }
}

function scopeKey(projectId, threadId) {
  return JSON.stringify([projectId || null, threadId || null]);
}

export function subscribeChildRuntimeEvents(projectId, threadId, handler) {
  if (!threadId || typeof handler !== 'function') return () => {};

  const key = scopeKey(projectId, threadId);
  const handlers = subscribers.get(key) || new Set();
  handlers.add(handler);
  subscribers.set(key, handlers);

  const buffered = eventBuffers.get(key);
  if (buffered) {
    eventBuffers.delete(key);
    eventBuffers.set(key, buffered);
    const recent = [...buffered.events.values()]
      .sort((left, right) => eventSequence(left.data) - eventSequence(right.data));
    for (const { data } of recent) {
      try {
        handler(data);
      } catch (error) {
        console.debug('Buffered child runtime event observer failed:', error);
      }
    }
  }

  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) subscribers.delete(key);
  };
}

export function publishChildRuntimeEvent(data) {
  if (data?.type !== 'event') return;

  const nested = data.data && typeof data.data === 'object' ? data.data : {};
  const threadId = data.threadId || data.thread_id || nested.threadId || nested.thread_id;
  if (!threadId) return;
  const projectId = data.projectId || data.project_id || nested.projectId || nested.project_id || null;
  const key = scopeKey(projectId, threadId);
  bufferEvent(key, data);
  const handlers = subscribers.get(key);
  if (!handlers) return;

  for (const handler of handlers) {
    try {
      handler(data);
    } catch (error) {
      console.debug('Child runtime event observer failed:', error);
    }
  }
}
