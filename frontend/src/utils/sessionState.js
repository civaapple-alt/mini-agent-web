import { normalizeTextAttachments } from './pasteAttachments.js';
import { normalizeFileAttachments } from './fileAttachments.js';

export const RUNTIME_PHASE_LABELS = {
  idle: '空闲',
  starting_turn: '启动 Turn',
  model: '模型调用',
  tool: '工具执行',
  waiting_approval: '等待审批',
  stopping: '正在停止',
  compaction: '上下文压缩',
  persisting: '保存状态',
  goal_verification: 'Goal Verify',
  goal_continuation_queued: 'Goal 排队',
  resuming: '恢复运行',
  completed: '已完成',
  failed: '失败',
};

export const ACTIVE_RUNTIME_PHASES = new Set([
  'starting_turn',
  'model',
  'tool',
  'waiting_approval',
  'stopping',
  'compaction',
  'persisting',
  'goal_verification',
  'goal_continuation_queued',
  'resuming',
]);

export const MAX_PENDING_SESSION_EVENTS = 128;
export const SELECTED_SESSION_STORAGE_KEY = 'mini-agent-studio.selected-session';

// Clear query-based routes left by earlier Web Studio versions. Current routes
// identify a Thread by pathname and never resolve a Session ID.
const STUDIO_ROUTE_QUERY_KEYS_TO_CLEAR = [
  'thread',
  'thread_id',
  'session',
  'session_id',
  'project',
  'project_id',
];

export function readStudioRoute(location = globalThis.location) {
  const pathname = location?.pathname || '/';
  const params = new URLSearchParams(location?.search || '');
  const routePath = pathname.replace(/\/+$/, '') || '/';
  const threadPath = routePath.match(/^\/threads\/(.+)$/);
  const legacyThreadId = routePath === '/'
    ? params.get('thread') || params.get('thread_id') || null
    : null;
  let threadId = legacyThreadId;
  if (threadPath) {
    try {
      threadId = decodeURIComponent(threadPath[1]);
    } catch {
      threadId = null;
    }
  }
  const projectId = params.get('project_id') || params.get('project') || null;
  return {
    threadId,
    projectId: threadId ? projectId : null,
    hasThreadTarget: Boolean(threadId),
    isInvalidPath: routePath !== '/' && !threadPath,
  };
}

export function writeStudioRoute(
  { threadId = null, projectId = null, mode = 'replace' } = {},
  browserWindow = globalThis.window,
) {
  if (!browserWindow?.history?.replaceState || !browserWindow.location) return;

  const url = new URL(browserWindow.location.href);
  STUDIO_ROUTE_QUERY_KEYS_TO_CLEAR.forEach((key) => url.searchParams.delete(key));
  if (threadId) {
    url.pathname = `/threads/${encodeURIComponent(threadId)}`;
    if (projectId) url.searchParams.set('project_id', projectId);
  } else {
    url.pathname = '/';
  }
  url.hash = '';
  const query = url.searchParams.toString();
  const nextUrl = `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
  const currentUrl = `${browserWindow.location.pathname}${browserWindow.location.search}${browserWindow.location.hash}`;
  if (nextUrl === currentUrl) return;
  const updateHistory = mode === 'push' ? 'pushState' : 'replaceState';
  browserWindow.history[updateHistory](browserWindow.history.state, '', nextUrl);
}

export function scopedThreadKey(threadId, projectId) {
  return `${projectId || ''}:${threadId}`;
}

export function normalizeInputPayload(inputPayload) {
  if (typeof inputPayload === 'string') {
    return {
      prompt: inputPayload,
      images: [],
      referencedFiles: [],
      textAttachments: [],
      fileAttachments: [],
    };
  }
  if (typeof inputPayload === 'object' && inputPayload !== null) {
    const normalized = {
      prompt: inputPayload.prompt || '',
      images: inputPayload.images || [],
      referencedFiles: inputPayload.referencedFiles || [],
      textAttachments: normalizeTextAttachments(
        inputPayload.textAttachments || inputPayload.text_attachments,
      ),
      fileAttachments: normalizeFileAttachments(
        inputPayload.fileAttachments || inputPayload.file_attachments,
      ),
    };
    const selectedSkills = inputPayload.selectedSkills || inputPayload.selected_skills;
    if (selectedSkills) normalized.selectedSkills = selectedSkills;
    if (inputPayload.workflow) normalized.workflow = inputPayload.workflow;
    if (inputPayload.directive) normalized.directive = inputPayload.directive;
    return normalized;
  }
  return {
    prompt: '', images: [], referencedFiles: [], textAttachments: [], fileAttachments: [],
  };
}

export function formatRunFailure(reason) {
  if (!reason) return '运行时失败';
  if (typeof reason === 'string') return reason;
  if (reason.type === 'model') return '模型请求失败';
  if (reason.type === 'compaction') return '上下文压缩失败';
  if (reason.type === 'limit_exceeded') {
    const detail = reason.detail || {};
    return detail.kind ? `达到运行限制（${detail.kind}）` : '达到上下文或输入限制';
  }
  return reason.type ? `运行时失败（${reason.type}）` : '运行时失败';
}

export function normalizeGoal(goal) {
  if (!goal) return null;
  return {
    ...goal,
    thread_id: goal.thread_id || goal.threadId,
    token_budget: goal.token_budget ?? goal.tokenBudget ?? null,
    tokens_used: goal.tokens_used ?? goal.tokensUsed ?? 0,
    time_used_seconds: goal.time_used_seconds ?? goal.timeUsedSeconds ?? 0,
    created_at: goal.created_at ?? goal.createdAt ?? 0,
    updated_at: goal.updated_at ?? goal.updatedAt ?? 0,
    current_milestone: goal.current_milestone ?? goal.currentMilestone ?? 0,
    total_milestones: goal.total_milestones ?? goal.totalMilestones ?? 0,
    loop_count: goal.loop_count ?? goal.loopCount ?? 0,
    last_verifier_score: goal.last_verifier_score ?? goal.lastVerifierScore ?? null,
    last_error: goal.last_error ?? goal.lastError ?? null,
    verification_status: goal.verification_status || goal.verificationStatus || 'idle',
  };
}

export function readPersistedSessionSelection(storage = globalThis.localStorage) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(SELECTED_SESSION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
