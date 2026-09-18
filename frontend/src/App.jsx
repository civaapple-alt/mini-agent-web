import React, { useState, useEffect, useRef } from 'react';
import AppLayout from './components/AppLayout';
import { api, createAgentWebSocket, setActiveProjectId } from './api';
import {
  shouldAcceptEventForThread,
  aggregateItemLifecycle,
  aggregateStreamEvent,
  aggregateThreadItems,
  assignHistoryTurnIds,
  filterEmptyMessages,
  approvalIdentity,
  mergeApprovalEvent,
  shouldIgnoreApprovalWhileInterrupting,
  shouldIgnoreStreamEventWhileInterrupting,
  shouldSettleActiveTurnFromError,
} from './utils/messageState';
import {
  appendGoalMessage as appendGoalMessageToMessages,
  createGoalMessage,
  createGoalVerificationMessage,
  extractGoalObjective,
} from './utils/goalMessages';
import {
  readRuntimeGeneration,
  readStateRevision,
  shouldApplyRuntimeGeneration,
  shouldApplyStateRevision,
} from './utils/revisionState';
import {
  ACTIVE_RUNTIME_PHASES,
  MAX_PENDING_SESSION_EVENTS,
  SELECTED_SESSION_STORAGE_KEY,
  formatRunFailure,
  normalizeGoal,
  normalizeInputPayload,
  readPersistedSessionSelection,
  scopedThreadKey,
} from './utils/sessionState.js';
import { getStatusViewModel, normalizeTheme } from './utils/statusModel.js';
import { parseSkillPrompt, parseWorkflowPrompt } from './utils/skillTokens.js';
import { buildAutoThreadTitle, isDefaultThreadTitle } from './utils/threadTitle.js';
import {
  cleanInputText,
  createInputTrace,
  extractTextAttachmentNames,
  isInternalCompactionMessage,
} from './utils/inputTrace.js';
import { startImplementationTurn } from './utils/planWorkflow.js';
import './App.css';

function readThreadMeta(thread, fallbackTitle = null) {
  const source = thread || {};
  return {
    title: source.title || source.thread_id || fallbackTitle || '默认会话 (Default Session)',
    summary: source.summary || '',
    sessionId: source.session_id || null,
    parentSessionId: source.parent_session_id || null,
    parentCheckpointSeq: source.parent_checkpoint_seq ?? null,
    sessionBytes: source.session_bytes ?? null,
    contextBeforeBytes: source.context_before_bytes ?? null,
    contextAfterBytes: source.context_after_bytes ?? null,
    compacted: source.compacted ?? false,
    compactionMethod: source.compaction_method || null,
  };
}

const HISTORY_PAGE_SIZE = 128;

async function listThreadItemsForHistory(threadId, projectId, options = {}) {
  const entries = [];
  let cursor = null;
  const seenCursors = new Set();

  while (true) {
    const page = await api.listThreadItems(threadId, {
      limit: HISTORY_PAGE_SIZE,
      cursor,
      projectId,
      signal: options.signal,
    });
    const data = Array.isArray(page.data) ? page.data : [];
    entries.push(...data);
    const nextCursor = page.next_cursor || page.nextCursor || null;
    if (!nextCursor || data.length === 0 || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return entries;
}

export default function App() {
  const [threads, setThreads] = useState([]);
  const [currentThread, setCurrentThread] = useState(
    () => readPersistedSessionSelection().threadId || 'default',
  );
  const [currentThreadProject, setCurrentThreadProject] = useState(
    () => readPersistedSessionSelection().projectId || null,
  );
  const [currentThreadMeta, setCurrentThreadMeta] = useState(() => readThreadMeta());
  const [messages, setMessages] = useState([]);
  const [threadItems, setThreadItems] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isInterrupting, setIsInterrupting] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [pendingMessages, setPendingMessages] = useState([]);
  const [composerDraft, setComposerDraft] = useState(null);
  const [lastTurnResult, setLastTurnResult] = useState(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [currentSessionReadOnly, setCurrentSessionReadOnly] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [skillCatalog, setSkillCatalog] = useState([]);
  const [skillGroups, setSkillGroups] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState(null);
  const [skillInsertion, setSkillInsertion] = useState(null);

  // Workflow & Environment
  const [planActive, setPlanActive] = useState(false);
  const [planReviewPending, setPlanReviewPending] = useState(false);
  const [goalState, setGoalState] = useState(null);
  const [runtimeStatus, setRuntimeStatus] = useState(null);
  const [lastWorkflowEvent, setLastWorkflowEvent] = useState(null);
  const [accessScope, setAccessScope] = useState('project');
  const [policy, setPolicy] = useState('interactive');
  const [continuationMode, setContinuationMode] = useState('manual');
  const [userSettings, setUserSettings] = useState({
    access: 'project',
    policy: 'interactive',
    default_mode: 'chat',
    reasoning_effort: 'high',
    theme: 'light',
    auto_scroll: true,
    word_wrap: true,
    font_size: 13,
  });

  // Panels & Modals
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState('status');
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState('offline');

  const wsRef = useRef(null);
  const workflowRevisionsRef = useRef(new Map());
  const eventCursorsRef = useRef(new Map());
  const hasConnectedRef = useRef(false);
  const runtimeGenerationRef = useRef(0);
  const queueDispatchingRef = useRef(false);
  const interruptPendingRef = useRef(false);
  const interruptTurnIdRef = useRef(null);
  const interruptedTurnIdsRef = useRef(new Set());
  const activeTurnIdRef = useRef(activeTurnId);
  const planActiveRef = useRef(planActive);
  const currentThreadRef = useRef(currentThread);
  const currentThreadProjectRef = useRef(currentThreadProject);
  const goalStateRef = useRef(goalState);
  const pendingApprovalRef = useRef(pendingApproval);
  const pendingApprovalsRef = useRef(pendingApprovals);
  const approvalSubmissionRef = useRef(new Map());
  const resolvedApprovalIdsRef = useRef(new Set());
  const selectionPersistenceReadyRef = useRef(false);
  const sessionEpochRef = useRef(0);
  const sessionRequestControllerRef = useRef(null);
  const sessionSyncRef = useRef(null);
  const loadThreadsRef = useRef(null);
  const catalogEpochRef = useRef(0);
  const catalogRequestControllerRef = useRef(null);
  const runtimeRecoveryRef = useRef(new Set());
  const pendingUserMessageIdRef = useRef(null);
  const autoTitleAttemptsRef = useRef(new Set());
  activeTurnIdRef.current = activeTurnId;
  planActiveRef.current = planActive;
  currentThreadRef.current = currentThread;
  currentThreadProjectRef.current = currentThreadProject;
  pendingApprovalRef.current = pendingApproval;
  pendingApprovalsRef.current = pendingApprovals;
  setActiveProjectId(currentThreadProject);

  const clearPendingApprovals = () => {
    setPendingApprovals([]);
    setPendingApproval(null);
  };

  const rememberInterruptedTurn = (turnId) => {
    if (!turnId) return;
    const interruptedTurnIds = interruptedTurnIdsRef.current;
    interruptedTurnIds.add(String(turnId));
    while (interruptedTurnIds.size > 64) {
      const oldest = interruptedTurnIds.values().next().value;
      interruptedTurnIds.delete(oldest);
    }
  };

  const forgetInterruptedTurn = (turnId) => {
    if (turnId) interruptedTurnIdsRef.current.delete(String(turnId));
  };

  const enqueuePendingApproval = (approval) => {
    if (!approval?.requestId) return;
    const key = approvalIdentity(approval);
    setPendingApprovals((previous) => {
      const existingIndex = previous.findIndex(
        (item) => approvalIdentity(item) === key,
      );
      if (existingIndex === -1) return [...previous, approval];
      const copy = [...previous];
      copy[existingIndex] = approval;
      return copy;
    });
    setPendingApproval((current) => {
      if (!current || approvalIdentity(current) === key) return approval;
      return current;
    });
  };

  const removePendingApproval = (approval) => {
    const key = approvalIdentity(approval);
    setPendingApprovals((previous) => previous.filter(
      (item) => approvalIdentity(item) !== key,
    ));
    setPendingApproval((current) => (
      current && approvalIdentity(current) === key ? null : current
    ));
  };

  useEffect(() => {
    if (!pendingApproval && pendingApprovals.length > 0) {
      setPendingApproval(pendingApprovals[0]);
    }
  }, [pendingApproval, pendingApprovals]);

  const showToast = (message, type = 'info', duration = 3000) => {
    const id = 'toast_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  };

  const dismissToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const beginSessionRequest = (threadId, projectId) => {
    sessionRequestControllerRef.current?.abort();
    const controller = new AbortController();
    sessionRequestControllerRef.current = controller;
    sessionEpochRef.current += 1;
    setActiveProjectId(projectId);
    return {
      epoch: sessionEpochRef.current,
      threadId,
      projectId,
      signal: controller.signal,
    };
  };

  const currentSessionRequest = () => ({
    epoch: sessionEpochRef.current,
    threadId: currentThreadRef.current,
    projectId: currentThreadProjectRef.current,
    signal: sessionRequestControllerRef.current?.signal,
  });

  const isCurrentSessionRequest = (context) => (
    context
      && context.epoch === sessionEpochRef.current
      && context.threadId === currentThreadRef.current
      && (context.projectId || null) === (currentThreadProjectRef.current || null)
  );

  const isAbortError = (err) => err?.name === 'AbortError';

  const startSessionSync = (threadId, projectId) => {
    sessionSyncRef.current = {
      key: scopedThreadKey(threadId, projectId),
      pendingEvents: [],
      syncing: true,
    };
  };

  const clearSessionSync = (threadId, projectId) => {
    const key = scopedThreadKey(threadId, projectId);
    if (sessionSyncRef.current?.key === key) {
      sessionSyncRef.current = null;
    }
  };

  const finishSessionSync = (threadId, projectId) => {
    const key = scopedThreadKey(threadId, projectId);
    const sync = sessionSyncRef.current;
    if (!sync || sync.key !== key) return;
    sessionSyncRef.current = null;
    [...sync.pendingEvents]
      .sort((left, right) => (left.sequence || 0) - (right.sequence || 0))
      .forEach((event) => handleServerEvent(event, { fromReplay: true }));
  };

  const beginCatalogRequest = () => {
    catalogRequestControllerRef.current?.abort();
    const controller = new AbortController();
    catalogRequestControllerRef.current = controller;
    catalogEpochRef.current += 1;
    return {
      epoch: catalogEpochRef.current,
      projectId: currentThreadProjectRef.current,
      signal: controller.signal,
    };
  };

  const isCurrentCatalogRequest = (context) => (
    context && context.epoch === catalogEpochRef.current
  );

  const resetSessionProjections = ({ loadingHistory = false } = {}) => {
    setIsGenerating(false);
    setIsInterrupting(false);
    activeTurnIdRef.current = null;
    setActiveTurnId(null);
    setCurrentSessionReadOnly(false);
    interruptPendingRef.current = false;
    interruptTurnIdRef.current = null;
    interruptedTurnIdsRef.current.clear();
    queueDispatchingRef.current = false;
    clearPendingApprovals();
    approvalSubmissionRef.current.clear();
    setPendingMessages([]);
    setComposerDraft(null);
    setLastTurnResult(null);
    pendingUserMessageIdRef.current = null;
    setPlanReviewPending(false);
    setPlanActive(false);
    goalStateRef.current = null;
    setGoalState(null);
    setRuntimeStatus(null);
    setLastWorkflowEvent(null);
    setMessages([]);
    setThreadItems([]);
    setIsLoadingHistory(loadingHistory);
  };

  // ---------------------------------------------------------------------------
  // Lifecycle & Initial Fetch
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!selectionPersistenceReadyRef.current) {
      selectionPersistenceReadyRef.current = true;
      return;
    }
    try {
      window.localStorage.setItem(
        SELECTED_SESSION_STORAGE_KEY,
        JSON.stringify({
          threadId: currentThread,
          projectId: currentThreadProject,
        }),
      );
    } catch {
      // Selection persistence is a convenience; private browsing may reject it.
    }
  }, [currentThread, currentThreadProject]);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSettingsModalOpen(false);
        setSidePanelOpen(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    initializeSession();

    // Establish WebSocket Connection
    const wsClient = createAgentWebSocket(
      handleServerEvent,
      () => {
        setIsConnected(true);
        setConnectionState('online');
        wsRef.current?.send({
          action: 'ping',
          project_id: currentThreadProjectRef.current,
        });
        // A reconnect may follow an App Server restart, whose in-memory
        // revision sequence starts over. Re-read the canonical projection to
        // rebuild the Web cursor before accepting new notifications.
        workflowRevisionsRef.current.clear();
        runtimeGenerationRef.current = 0;
        const context = currentSessionRequest();
        loadWorkflows(context.threadId, context.projectId, context);
        loadRuntimeStatus(context.threadId, context.projectId, context);
        loadPendingApproval(context.threadId, context.projectId, context);
        if (hasConnectedRef.current) {
          replayMissedEvents(context.threadId, context.projectId, context);
        }
        hasConnectedRef.current = true;
        showToast('✓ 已连接到 Agent Gateway 服务端', 'success', 2000);
      },
      () => {
        setIsConnected(false);
        setConnectionState('reconnecting');
        showToast('⚠️ 与 Agent Gateway 连接断开，尝试重连中...', 'warning', 2500);
      },
      () => currentThreadProjectRef.current,
    );
    wsRef.current = wsClient;

    return () => {
      sessionRequestControllerRef.current?.abort();
      catalogRequestControllerRef.current?.abort();
      wsClient.close();
    };
  }, []);

  useEffect(() => {
    // Keep the gateway's project-scoped WebSocket subscription aligned with
    // the selected Session even before the next turn-control action.
    if (wsRef.current?.isOpen()) {
      wsRef.current.send({
        action: 'ping',
        project_id: currentThreadProject || null,
      });
    }
  }, [currentThreadProject]);

  useEffect(() => {
    const controller = new AbortController();
    setSkillsLoading(true);
    setSkillsError(null);
    api.listSkills({ projectId: currentThreadProject, signal: controller.signal })
      .then((data) => {
        setSkillCatalog(Array.isArray(data?.skills) ? data.skills : []);
        setSkillGroups(Array.isArray(data?.builtinSkillGroups) ? data.builtinSkillGroups : []);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setSkillCatalog([]);
        setSkillGroups([]);
        setSkillsError(err.message || '技能目录加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setSkillsLoading(false);
      });
    return () => controller.abort();
  }, [currentThreadProject]);

  const handleInsertSkill = (name) => {
    setSkillInsertion({ name, nonce: Date.now() });
  };

  const handleToggleSkillGroup = async (groupId, enabled) => {
    const projectId = currentThreadProjectRef.current;
    if (!projectId) return;
    try {
      const enabledGroups = skillGroups
        .filter((group) => group.id !== groupId && group.enabled)
        .map((group) => group.id);
      if (enabled) enabledGroups.push(groupId);
      await api.updateProject(
        projectId,
        { builtin_skill_groups: [...new Set(enabledGroups)] },
        { projectId },
      );
      showToast(enabled ? `已启用技能组: ${groupId}` : `已关闭技能组: ${groupId}`, 'success');
      const data = await api.listSkills({ projectId });
      setSkillCatalog(Array.isArray(data?.skills) ? data.skills : []);
      setSkillGroups(Array.isArray(data?.builtinSkillGroups) ? data.builtinSkillGroups : []);
    } catch (err) {
      showToast(`更新技能组失败: ${err.message}`, 'error');
    }
  };

  const loadSettings = async (context = null) => {
    try {
      const data = await api.getSettings({
        projectId: context ? context.projectId : currentThreadProjectRef.current,
        signal: context?.signal,
      });
      if (context && !isCurrentSessionRequest(context)) return;
      setUserSettings((prev) => ({ ...prev, ...data }));
      if (data.access) setAccessScope(data.access);
      if (data.policy) setPolicy(data.policy);
      const activeTheme = normalizeTheme(data.theme);
      document.body.className = `theme-${activeTheme}`;
    } catch (err) {
      if (isAbortError(err) || (context && !isCurrentSessionRequest(context))) return;
      console.error('Failed to load settings:', err);
      document.body.className = 'theme-light';
    }
  };

  const loadPendingApproval = async (
    threadId = currentThreadRef.current,
    projectId = currentThreadProjectRef.current,
    context = null,
  ) => {
    const requestContext = context || currentSessionRequest();
    try {
      const snapshot = await api.getWorldApproval({
        projectId,
        threadId,
        signal: requestContext.signal,
      });
      if (!isCurrentSessionRequest(requestContext)) return;
      const approvals = (snapshot.pending_requests || [])
        .map((pending) => {
          const data = pending.data || {};
          return {
            requestId: pending.request_id || data.requestId,
            data: {
              ...data,
              projectId: pending.project_id || data.projectId || projectId,
              threadId: pending.thread_id || data.threadId || threadId,
              turnId: pending.turn_id || data.turnId || null,
            },
          };
        })
        .filter((approval) => (
          approval.requestId
          && !resolvedApprovalIdsRef.current.has(approvalIdentity(approval))
        ));
      const uniqueApprovals = approvals.filter((approval, index) => (
        approvals.findIndex(
          (item) => approvalIdentity(item) === approvalIdentity(approval),
        ) === index
      ));
      if (uniqueApprovals.length === 0) {
        clearPendingApprovals();
        return;
      }
      setPendingApprovals(uniqueApprovals);
      setPendingApproval((current) => (
        current && uniqueApprovals.some(
          (item) => approvalIdentity(item) === approvalIdentity(current),
        )
          ? current
          : uniqueApprovals[0]
      ));
    } catch (err) {
      if (isAbortError(err) || !isCurrentSessionRequest(requestContext)) return;
      console.debug('Failed to load pending approval:', err);
    }
  };

  const loadThreads = async (options = {}) => {
    const requestContext = options.context || beginCatalogRequest();
    try {
      const data = await api.listThreads({
        projectId: requestContext.projectId,
        signal: requestContext.signal,
      });
      if (!isCurrentCatalogRequest(requestContext)) return null;
      let cur = null;
      setThreads(data.threads || []);
      if (data.threads && data.threads.length > 0) {
        const preferredProject =
          currentThreadProjectRef.current || data.current_project || null;
        cur = data.threads.find(
          (t) =>
            t.thread_id === currentThreadRef.current &&
            (!preferredProject || t.project === preferredProject),
        ) || data.threads.find((t) => t.thread_id === currentThreadRef.current);
        if (cur) {
          if (!currentThreadProjectRef.current && cur.project) {
            currentThreadProjectRef.current = cur.project;
            setCurrentThreadProject(cur.project);
          }
          setCurrentThreadMeta(readThreadMeta(cur));
        }
      }
      return cur;
    } catch (err) {
      console.error('Failed to load threads:', err);
      return null;
    }
  };

  loadThreadsRef.current = loadThreads;

  useEffect(() => {
    if (!isConnected) return undefined;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadThreadsRef.current?.();
      }
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [isConnected]);

  const initializeSession = async () => {
    const selected = await loadThreads();
    if (!selected) {
      await loadSettings();
      return;
    }

    const nextThread = selected.thread_id || 'default';
    const nextProject =
      selected.project || currentThreadProjectRef.current || null;
    const context = beginSessionRequest(nextThread, nextProject);
    startSessionSync(nextThread, nextProject);
    currentThreadRef.current = nextThread;
    currentThreadProjectRef.current = nextProject;
    setCurrentThread(nextThread);
    setCurrentThreadProject(nextProject);
    setCurrentThreadMeta(readThreadMeta(selected, nextThread));

    // Establish the project-qualified routing context before reading the
    // project-agnostic history/workflow endpoints. A locked external Session
    // remains readable and will be retried by an explicit later attach.
    try {
      const result = await api.attachThread(nextThread, nextProject, { signal: context.signal });
      if (!isCurrentSessionRequest(context)) return;
      setCurrentSessionReadOnly(
        result.attached === false && result.session_status === 'locked',
      );
    } catch (err) {
      if (isAbortError(err) || !isCurrentSessionRequest(context)) return;
      console.debug('Failed to attach persisted session during startup:', err);
    }
    await Promise.all([
      loadSettings(context),
      loadThreadHistory(nextThread, nextProject, context),
      loadWorkflows(nextThread, nextProject, context),
      loadRuntimeStatus(nextThread, nextProject, context),
      loadPendingApproval(nextThread, nextProject, context),
    ]);
    await replayMissedEvents(nextThread, nextProject, context);
    finishSessionSync(nextThread, nextProject);
  };

  const loadWorkflows = async (
    threadId = currentThreadRef.current,
    projectId = currentThreadProjectRef.current,
    context = null,
  ) => {
    const requestContext = context || currentSessionRequest();
    try {
      const wfState = await api.getWorkflowState(threadId, {
        projectId,
        signal: requestContext.signal,
      });
      if (!isCurrentSessionRequest(requestContext)) return;
      const normalizedState = { ...wfState, goal: normalizeGoal(wfState.goal) };
      if (!applyWorkflowState(threadId, normalizedState, projectId)) return;
      goalStateRef.current = normalizedState.goal;
      setGoalState(normalizedState.goal);
    } catch (err) {
      if (isAbortError(err) || !isCurrentSessionRequest(requestContext)) return;
      console.error('Failed to load workflow state:', err);
    }
  };

  const loadRuntimeStatus = async (
    threadId = currentThreadRef.current,
    projectId = currentThreadProjectRef.current,
    context = null,
  ) => {
    const requestContext = context || currentSessionRequest();
    try {
      const status = await api.getRuntimeStatus(threadId, {
        projectId,
        signal: requestContext.signal,
      });
      if (
        isCurrentSessionRequest(requestContext)
      ) {
        setRuntimeStatus(status);
        const runtimeTurnId = status.turn_id || status.turnId;
        if (status.phase === 'stopping' && runtimeTurnId) {
          rememberInterruptedTurn(runtimeTurnId);
          activeTurnIdRef.current = runtimeTurnId;
          interruptTurnIdRef.current = runtimeTurnId;
          interruptPendingRef.current = true;
          setActiveTurnId(runtimeTurnId);
          setIsGenerating(false);
          setIsInterrupting(true);
        }
        const stoppedTurn = shouldIgnoreApprovalWhileInterrupting(
          { turnId: runtimeTurnId },
          interruptPendingRef.current,
          interruptTurnIdRef.current,
        );
        if (ACTIVE_RUNTIME_PHASES.has(status.phase) && status.phase !== 'stopping' && !stoppedTurn) {
          setIsGenerating(true);
          if (runtimeTurnId) {
            activeTurnIdRef.current = runtimeTurnId;
            setActiveTurnId(runtimeTurnId);
          }
        }
      }
    } catch (err) {
      if (isAbortError(err) || !isCurrentSessionRequest(requestContext)) return;
      console.debug('Failed to load runtime status:', err);
    }
  };

  const replayMissedEvents = async (
    threadId = currentThreadRef.current,
    projectId = currentThreadProjectRef.current,
    context = null,
  ) => {
    const requestContext = context || currentSessionRequest();
    const afterSequence = eventCursorsRef.current.get(
      scopedThreadKey(threadId, projectId),
    );
    try {
      const page = await api.replayThreadEvents(threadId, afterSequence ?? 0, 128, {
        projectId,
        signal: requestContext.signal,
      });
      if (!isCurrentSessionRequest(requestContext)) return;
      if (page.has_gap) {
        // The bounded App Server cache no longer contains the complete gap;
        // canonical history is the safe reconciliation boundary.
        showToast('事件回放存在缺口，已从最近会话快照恢复。', 'warning', 3500);
        await loadThreadHistory(threadId, projectId, requestContext);
      }
      for (const event of page.data || []) {
        handleServerEvent({ type: 'event', ...event }, { fromReplay: true });
      }
    } catch (err) {
      console.debug('Failed to replay runtime events:', err);
      if (isAbortError(err) || !isCurrentSessionRequest(requestContext)) return;
      await loadThreadHistory(threadId, projectId, requestContext);
    }
  };

  const applyWorkflowState = (
    threadId,
    workflowState,
    projectId = currentThreadProjectRef.current,
  ) => {
    const nextRevision = readStateRevision(workflowState);
    const stateKey = scopedThreadKey(threadId, projectId);
    const currentRevision = workflowRevisionsRef.current.get(stateKey);
    if (!shouldApplyStateRevision(currentRevision, nextRevision)) return false;
    if (nextRevision !== null) {
      workflowRevisionsRef.current.set(stateKey, nextRevision);
    }
    if (
      currentThreadRef.current !== threadId ||
      (projectId && currentThreadProjectRef.current !== projectId)
    ) return false;
    const mode = workflowState.collaboration_mode || workflowState.collaborationMode;
    const planEnabled = mode?.mode === 'plan';
    setPlanActive(planEnabled);
    if (!planEnabled) setPlanReviewPending(false);
    const reviewPending = workflowState.plan_review_pending
      ?? workflowState.planReviewPending;
    if (reviewPending !== undefined) setPlanReviewPending(Boolean(reviewPending));
    const nextContinuation = workflowState.continuation_mode || workflowState.continuationMode;
    if (nextContinuation) setContinuationMode(nextContinuation);
    return true;
  };

  const applyGoalState = (
    threadId,
    goal,
    payload = {},
    projectId = currentThreadProjectRef.current,
  ) => {
    const nextGoal = normalizeGoal(goal);
    const nextRevision = readStateRevision(payload);
    const stateKey = scopedThreadKey(threadId, projectId);
    const currentRevision = workflowRevisionsRef.current.get(stateKey);
    if (!shouldApplyStateRevision(currentRevision, nextRevision)) return false;
    if (nextRevision !== null) {
      workflowRevisionsRef.current.set(stateKey, nextRevision);
    }
    if (
      currentThreadRef.current !== threadId ||
      (projectId && currentThreadProjectRef.current !== projectId)
    ) return false;
    const previousGoal = goalStateRef.current;
    goalStateRef.current = nextGoal;
    setGoalState(nextGoal);
    if (nextGoal) {
      setMessages((prev) => appendGoalMessageToMessages(prev, nextGoal));
      if (
        nextGoal.verification_status !== previousGoal?.verification_status &&
        ['running', 'completed', 'failed'].includes(nextGoal.verification_status)
      ) {
        const verificationMessage = createGoalVerificationMessage(nextGoal);
        setMessages((prev) => (
          prev.some((message) => message.id === verificationMessage.id)
            ? prev
            : [...prev, verificationMessage]
        ));
      }
    }
    return true;
  };

  const loadThreadHistory = async (
    threadId,
    projectId = currentThreadProjectRef.current,
    context = null,
  ) => {
    const requestContext = context || currentSessionRequest();
    setIsLoadingHistory(true);
    try {
      const [cp, itemEntries] = await Promise.all([
        api.readThread(threadId, { projectId, signal: requestContext.signal }),
        listThreadItemsForHistory(threadId, projectId, requestContext),
      ]);
      if (!isCurrentSessionRequest(requestContext)) return;
      setThreadItems(itemEntries);
      const sessionSnapshot = cp.session || {};
      setCurrentThreadMeta((previous) => ({
        title: cp.metadata?.title || previous.title || threadId,
        summary: cp.metadata ? (cp.metadata.summary || '') : (previous.summary || ''),
        sessionId: sessionSnapshot.session_id || cp.session_id || previous.sessionId || null,
        parentSessionId: sessionSnapshot.parent_session_id || previous.parentSessionId || null,
        parentCheckpointSeq: sessionSnapshot.parent_checkpoint_seq ?? previous.parentCheckpointSeq ?? null,
        sessionBytes: sessionSnapshot.session_bytes ?? previous.sessionBytes ?? null,
        contextBeforeBytes: sessionSnapshot.context_before_bytes ?? previous.contextBeforeBytes ?? null,
        contextAfterBytes: sessionSnapshot.context_after_bytes ?? previous.contextAfterBytes ?? null,
        compacted: sessionSnapshot.compacted ?? previous.compacted ?? false,
        compactionMethod: sessionSnapshot.compaction_method || previous.compactionMethod || null,
      }));
      const turnActive = Boolean(
        cp.turn_active ?? sessionSnapshot.turn_active,
      );
      const restoredTurnId = turnActive
        ? cp.active_turn_id
          || sessionSnapshot.active_turn_id
          || cp.last_turn_id
          || sessionSnapshot.last_turn_id
        : null;
      setIsGenerating(turnActive);
      setIsInterrupting(false);
      interruptPendingRef.current = false;
      interruptTurnIdRef.current = null;
      activeTurnIdRef.current = restoredTurnId;
      setActiveTurnId(restoredTurnId);
      const persistedTurn = cp.last_turn_status || cp.session?.last_turn_status;
      if (!turnActive && persistedTurn && persistedTurn !== 'completed') {
        setLastTurnResult({
          status: persistedTurn,
          stopReason: cp.last_stop_reason || cp.session?.last_stop_reason || null,
          steps: cp.last_turn_steps || cp.session?.last_turn_steps || 0,
          turnId: cp.last_turn_id || cp.session?.last_turn_id || null,
          error: cp.last_turn_error || cp.session?.last_turn_error || null,
        });
      } else {
        setLastTurnResult(null);
      }
      const rawMessages = assignHistoryTurnIds(cp.messages || [], itemEntries);
      const persistedGoalObjective = cp.session?.goal?.objective?.trim() || '';
      let historyGoalObjective = persistedGoalObjective;
      let goalMessageAdded = false;
      const formatted = rawMessages.reduce((result, m, idx) => {
        if (isInternalCompactionMessage(m)) return result;
        const text = (m.text || '').trim();
        const internalGoalObjective = extractGoalObjective(text);
        if (internalGoalObjective) {
          historyGoalObjective = historyGoalObjective || internalGoalObjective;
          if (!goalMessageAdded) {
            result.push(createGoalMessage(
              historyGoalObjective,
              `goal_hist_${threadId}_${idx}`,
            ));
            goalMessageAdded = true;
          }
          return result;
        }
        // Tool/context records are represented by the bounded ThreadItem
        // projection below. Rendering them as messages creates blank assistant
        // rows (or duplicates internal runtime text) during history replay.
        if (m.role !== 'user' && m.role !== 'assistant') return result;
        if (text.startsWith('<world_state') || text.includes('</world_state>')) return result;
        const messageId = m.id || `hist_${threadId}_${idx}`;
        const reasoning = m.reasoning || m.thinking || '';
        const toolCalls = Array.isArray(m.tool_calls)
          ? m.tool_calls
          : Array.isArray(m.toolCalls)
            ? m.toolCalls
            : [];
        const isUserMessage = m.role === 'user';
        const displayText = isUserMessage ? cleanInputText(m.text) : m.text;
        const textAttachmentNames = isUserMessage
          ? extractTextAttachmentNames(m.text)
          : [];
        result.push({
          id: messageId,
          role: m.role,
          turnId: m.turnId || null,
          text: displayText || '',
          ...(isUserMessage && textAttachmentNames.length > 0
            ? { textAttachments: textAttachmentNames.map((name) => ({ name })) }
            : {}),
          thinking: reasoning,
          tools: [],
          ...(isUserMessage
            ? {
              inputTrace: createInputTrace({
                threadId,
                projectId,
                turnId: m.turnId || null,
                source: 'user',
                capturedAt: m.capturedAt || m.createdAt || m.created_at || null,
                images: m.images,
                textAttachments: textAttachmentNames,
                referencedFiles: m.referencedFiles,
                attachmentText: m.text,
                historical: true,
                attachmentsKnown: Object.prototype.hasOwnProperty.call(m, 'images')
                  || Object.prototype.hasOwnProperty.call(m, 'referencedFiles'),
              }),
            }
            : {}),
          toolCallIds: toolCalls.map((call) => call?.id || call?.call_id).filter(Boolean),
          blocks: [
            ...(reasoning
              ? [{ type: 'thinking', id: `${messageId}:reasoning`, content: reasoning }]
              : []),
            ...(displayText
              ? [{ type: 'text', id: `${messageId}:text`, content: displayText }]
              : []),
          ],
        });
        return result;
      }, []);
      if (historyGoalObjective && !goalMessageAdded) {
        formatted.push(createGoalMessage(historyGoalObjective, `goal_hist_${threadId}`));
      }
      setMessages(
        filterEmptyMessages(aggregateThreadItems(formatted, itemEntries)),
      );
    } catch (err) {
      if (isAbortError(err) || !isCurrentSessionRequest(requestContext)) return;
      console.error(`Failed to load thread ${threadId}:`, err);
      showToast(`加载会话历史失败: ${err.message}`, 'error');
      setMessages([]);
    } finally {
      if (isCurrentSessionRequest(requestContext)) setIsLoadingHistory(false);
    }
  };

  function loadTurnFailureDetails(threadId, turnId, projectId = currentThreadProjectRef.current) {
    const requestContext = currentSessionRequest();
    return api.readThread(threadId, {
      projectId,
      signal: requestContext.signal,
    }).then((checkpoint) => {
      const lastTurnId = checkpoint.last_turn_id || checkpoint.session?.last_turn_id;
      const error = checkpoint.last_turn_error || checkpoint.session?.last_turn_error;
      if (!error || !isCurrentSessionRequest(requestContext)) return;
      if (turnId && lastTurnId && lastTurnId !== turnId) return;
      setLastTurnResult((previous) => (previous
        ? { ...previous, turnId: previous.turnId || lastTurnId || turnId, error }
        : previous));
    }).catch((err) => {
      if (isAbortError(err) || !isCurrentSessionRequest(requestContext)) return;
      console.debug('Failed to load turn failure details:', err);
    });
  }

  const recoverRuntimeAfterConnectionLoss = (threadId, projectId) => {
    const recoveryKey = scopedThreadKey(threadId, projectId);
    if (runtimeRecoveryRef.current.has(recoveryKey)) return;
    runtimeRecoveryRef.current.add(recoveryKey);
    setConnectionState('reconnecting');
    const context = beginSessionRequest(threadId, projectId);
    startSessionSync(threadId, projectId);

    void (async () => {
      try {
        let attached = null;
        try {
          attached = await api.attachThread(threadId, projectId, {
            signal: context.signal,
          });
        } catch (err) {
          if (!isAbortError(err)) {
            console.debug('Runtime recovery attach is not available:', err);
          }
        }
        if (isCurrentSessionRequest(context) && attached) {
          setCurrentSessionReadOnly(
            attached.attached === false && attached.session_status === 'locked',
          );
        }
        await Promise.all([
          loadThreadHistory(threadId, projectId, context),
          loadWorkflows(threadId, projectId, context),
          loadRuntimeStatus(threadId, projectId, context),
          loadPendingApproval(threadId, projectId, context),
        ]);
        await replayMissedEvents(threadId, projectId, context);
        finishSessionSync(threadId, projectId);
        if (isCurrentSessionRequest(context) && wsRef.current?.isOpen?.()) {
          setConnectionState('online');
          showToast('运行状态已恢复，会话历史已重新对账。', 'success', 2500);
        }
      } catch (err) {
        if (!isAbortError(err) && isCurrentSessionRequest(context)) {
          console.debug('Runtime recovery failed:', err);
          finishSessionSync(threadId, projectId);
          setConnectionState('offline');
          showToast('运行时恢复失败，请稍后重新 attach 当前会话。', 'warning', 4000);
        }
      } finally {
        if (sessionSyncRef.current?.key === recoveryKey) {
          finishSessionSync(threadId, projectId);
        }
        runtimeRecoveryRef.current.delete(recoveryKey);
      }
    })();
  };

  // ---------------------------------------------------------------------------
  // WebSocket Message / Event Dispatcher
  // ---------------------------------------------------------------------------

  const handleServerEvent = (data, { fromReplay = false } = {}) => {
    if (!data) return;

    const eventThread = data.threadId || data.thread_id || data.data?.threadId || data.data?.thread_id;
    const eventProject = data.projectId || data.project_id || data.data?.projectId || data.data?.project_id || currentThreadProjectRef.current;
    const eventKey = scopedThreadKey(eventThread || currentThreadRef.current, eventProject);
    const acceptsEvent = shouldAcceptEventForThread(
      data,
      currentThreadRef.current,
      currentThreadProjectRef.current,
    );

    // A2: Isolate stream events by active thread to prevent cross-thread pollution
    if (!acceptsEvent) {
      if (data.type === 'event') {
        const evtType = data.event?.type;
        if (evtType === 'turn_finished' || evtType === 'run_finished' || evtType === 'run_failed') {
          loadThreads();
        }
      }
      return;
    }

    const sync = sessionSyncRef.current;
    if (!fromReplay && sync?.syncing && sync.key === eventKey) {
      sync.pendingEvents = [...sync.pendingEvents, data].slice(-MAX_PENDING_SESSION_EVENTS);
      return;
    }

    if (data.type === 'event' && data.sequence) {
      const sequence = Number(data.sequence);
      const currentSequence = eventCursorsRef.current.get(eventKey) || 0;
      if (sequence <= currentSequence) return;
      eventCursorsRef.current.set(eventKey, sequence);
    }

    if (data.type === 'child_operation_updated') {
      window.dispatchEvent(
        new CustomEvent('mini-agent:child-operation-updated', { detail: data }),
      );
      return;
    }

    if (
      data.type === 'notification'
      && data.method === 'session/notebook/updated'
    ) {
      window.dispatchEvent(
        new CustomEvent('mini-agent:notebook-updated', { detail: data }),
      );
      return;
    }

    // 1. Capture Turn ID from submission
    if (data.type === '_turn_submission') {
      const turnId = data.data?.turn_id || data.submission?.turn_id;
      if (turnId) {
        const submittedMessageId = pendingUserMessageIdRef.current;
        if (submittedMessageId) {
          setMessages((previous) => previous.map((message) => (
            message.id === submittedMessageId
              ? {
                ...message,
                turnId,
                inputTrace: message.inputTrace
                  ? {
                    ...message.inputTrace,
                    scope: { ...message.inputTrace.scope, turnId },
                  }
                  : message.inputTrace,
              }
              : message
          )));
          pendingUserMessageIdRef.current = null;
        }
        activeTurnIdRef.current = turnId;
        setActiveTurnId(turnId);
        setIsGenerating(true);
        setIsInterrupting(false);
        queueDispatchingRef.current = false;
        interruptPendingRef.current = false;
        interruptTurnIdRef.current = null;
        setLastTurnResult(null);
      }
      return;
    }

    if (data.type === 'interrupt_ack') {
      console.info('[Studio][turn-control]', {
        action: 'interrupt-ack',
        source: data.source || 'gateway',
        threadId: data.threadId || currentThreadRef.current,
        turnId: data.turnId || null,
      });
      return;
    }

    if (data.type === 'steer_ack') {
      showToast('✓ 纠偏指令已下发，模型正在安全结算转向...', 'info', 2000);
      return;
    }

    if (data.type === 'error') {
      const visibleActiveTurnId = activeTurnIdRef.current;
      console.warn('[Studio][turn-control]', {
        action: 'gateway-error',
        source: data.source || data.scope || 'gateway',
        threadId: data.threadId || currentThreadRef.current,
        turnId: data.turnId || visibleActiveTurnId || null,
        message: data.message || '操作异常',
      });
      if (data.scope === 'runtime') {
        const runtimeThreadId = data.threadId || data.thread_id || currentThreadRef.current;
        const runtimeProjectId = data.projectId || data.project_id || currentThreadProjectRef.current;
        recoverRuntimeAfterConnectionLoss(runtimeThreadId, runtimeProjectId);
        return;
      }
      if (data.scope === 'approval') {
        const requestId = data.requestId || data.request_id;
        const reportedCallId = data.callId || data.call_id;
        const reportedProjectId = data.projectId || data.project_id;
        const reportedThreadId = data.threadId || data.thread_id;
        const reportedTurnId = data.turnId || data.turn_id;
        const matchingApprovals = pendingApprovalsRef.current.filter((item) => {
          const approvalData = item.data || {};
          const itemCallId = approvalData.callId || approvalData.call_id;
          const itemProjectId = approvalData.projectId || approvalData.project_id;
          const itemThreadId = approvalData.threadId || approvalData.thread_id;
          const itemTurnId = approvalData.turnId || approvalData.turn_id;
          return item.requestId === requestId
            && (!reportedCallId || itemCallId === reportedCallId)
            && (!reportedProjectId || itemProjectId === reportedProjectId)
            && (!reportedThreadId || itemThreadId === reportedThreadId)
            && (!reportedTurnId || itemTurnId === reportedTurnId);
        });
        const trackedApproval = matchingApprovals.length === 1
          ? matchingApprovals[0]
          : null;
        const trackedData = trackedApproval?.data || {};
        const errorApproval = {
          requestId: requestId || trackedApproval?.requestId,
          data: {
            ...trackedData,
            callId: reportedCallId || trackedData.callId || trackedData.call_id,
            projectId: data.projectId || data.project_id || trackedData.projectId || trackedData.project_id,
            threadId: data.threadId || data.thread_id || trackedData.threadId || trackedData.thread_id,
            turnId: data.turnId || data.turn_id || trackedData.turnId || trackedData.turn_id,
          },
        };
        const errorKey = approvalIdentity(errorApproval);
        const knownPending = Boolean(trackedApproval);
        const locallySubmitted = approvalSubmissionRef.current.has(errorKey);
        if (knownPending) {
          setMessages((prev) => mergeApprovalEvent(prev, {
            ...(trackedApproval.data || {}),
            requestId,
            phase: 'resolved',
            state: 'expired',
            reason: '审批请求已失效，当前操作未执行。',
          }));
        }
        if (knownPending || locallySubmitted) {
          removePendingApproval(errorApproval);
          approvalSubmissionRef.current.delete(errorKey);
          showToast(
            '安全审批未生效：该请求可能已由其他浏览器处理或已失效，当前操作未执行。',
            'warning',
            5000,
          );
          loadPendingApproval(currentThreadRef.current, currentThreadProjectRef.current);
        } else {
          showToast(`⚠️ ${data.message || '安全审批操作失败'}`, 'error', 4000);
        }
        return;
      }
      showToast(`⚠️ ${data.message || '操作异常'}`, 'error', 4000);
      if (
        data.scope === 'turn'
        && data.terminal === false
        && data.turnId
        && data.turnId === interruptTurnIdRef.current
      ) {
        // The remote interrupt was not admitted. Keep the Turn live and make
        // the Stop action available again instead of showing a false terminal
        // state or allowing a new message to race the old Turn.
        interruptPendingRef.current = false;
        interruptTurnIdRef.current = null;
        setIsInterrupting(false);
        activeTurnIdRef.current = data.turnId;
        setActiveTurnId(data.turnId);
        setIsGenerating(true);
      }
      if (data.terminal && data.scope === 'turn') {
        if (!shouldSettleActiveTurnFromError(data, visibleActiveTurnId)) return;
        setLastTurnResult({
          status: data.status || 'failed',
          stopReason: data.stopReason || data.stop_reason || 'failed',
          steps: data.steps || 0,
          turnId: data.turnId || visibleActiveTurnId || null,
          error: data.message || '网关/运行时错误',
        });
        queueDispatchingRef.current = false;
        interruptPendingRef.current = false;
        interruptTurnIdRef.current = null;
        setIsInterrupting(false);
        setIsGenerating(false);
        activeTurnIdRef.current = null;
        setActiveTurnId(null);
        clearPendingApprovals();
        loadThreads();
      }
      return;
    }

    // 2. Security Approval Interception
    if (data.type === 'approval_request') {
      const incoming = {
        requestId: data.requestId,
        data: {
          ...(data.data || {}),
          projectId: data.data?.projectId || data.projectId || data.project_id,
          threadId: data.data?.threadId || data.threadId || data.thread_id,
          turnId: data.data?.turnId || data.turnId || data.turn_id,
        },
      };
      if (incoming.requestId) {
        resolvedApprovalIdsRef.current.delete(approvalIdentity(incoming));
      }
      if (
        shouldIgnoreApprovalWhileInterrupting(
          incoming.data,
          interruptPendingRef.current,
          interruptTurnIdRef.current,
        )
      ) {
        return;
      }
      enqueuePendingApproval(incoming);
      setMessages((prev) => mergeApprovalEvent(prev, {
        ...(data.data || {}),
        requestId: data.requestId,
        phase: 'requested',
      }));
      return;
    }

    if (data.type === 'approval') {
      const approval = data.approval || {};
      if (approval.phase === 'requested') {
        if (approval.requestId) {
          resolvedApprovalIdsRef.current.delete(approvalIdentity(approval));
        }
        if (
          shouldIgnoreApprovalWhileInterrupting(
            approval,
            interruptPendingRef.current,
            interruptTurnIdRef.current,
          )
        ) {
          return;
        }
        enqueuePendingApproval({
          requestId: approval.requestId,
          data: approval,
        });
        setMessages((prev) => mergeApprovalEvent(prev, approval));
      } else if (approval.phase === 'resolved') {
        const requestId = approval.requestId;
        const approvalKey = approvalIdentity(approval);
        if (!requestId || !resolvedApprovalIdsRef.current.has(approvalKey)) {
          if (requestId) {
            resolvedApprovalIdsRef.current.add(approvalKey);
            if (resolvedApprovalIdsRef.current.size > 128) {
              const oldest = resolvedApprovalIdsRef.current.values().next().value;
              resolvedApprovalIdsRef.current.delete(oldest);
            }
          }
          const locallySubmitted = approvalSubmissionRef.current.has(approvalKey);
          const stoppedHere = shouldIgnoreApprovalWhileInterrupting(
            approval,
            interruptPendingRef.current,
            interruptTurnIdRef.current,
          );
          setMessages((prev) => mergeApprovalEvent(prev, {
            ...approval,
            source: locallySubmitted
              ? 'current_window'
              : stoppedHere ? 'interrupted' : 'other_window',
          }));
          removePendingApproval({ requestId, data: approval });
          if (locallySubmitted) {
            approvalSubmissionRef.current.delete(approvalKey);
          } else if (stoppedHere) {
            showToast('当前 Turn 已停止，待审批已失效。', 'info', 3500);
          } else {
            showToast(
              '审批状态已同步：该请求可能已由其他浏览器处理或已失效。',
              'info',
              4000,
            );
          }
          loadPendingApproval(currentThreadRef.current, currentThreadProjectRef.current);
        }
      }
      return;
    }

    if (data.type === 'notification') {
      const notification = data.data || {};
      if (data.method === 'gateway/runtime/restarted') {
        const nextGeneration = readRuntimeGeneration(notification);
        if (!shouldApplyRuntimeGeneration(runtimeGenerationRef.current, nextGeneration)) {
          return;
        }
        runtimeGenerationRef.current = nextGeneration;
        workflowRevisionsRef.current.clear();
        loadWorkflows(currentThreadRef.current);
        showToast('运行时已重启，正在同步控制面状态', 'info', 2500);
      } else if (data.method === 'runtime/status/updated') {
        const notificationProjectId = notification.projectId || notification.project_id;
        if (
          notification.threadId === currentThreadRef.current
          && (!notificationProjectId || notificationProjectId === currentThreadProjectRef.current)
        ) {
          setRuntimeStatus(notification);
          const runtimeTurnId = notification.turnId || notification.turn_id;
        if (notification.phase === 'stopping' && runtimeTurnId) {
            rememberInterruptedTurn(runtimeTurnId);
            activeTurnIdRef.current = runtimeTurnId;
            interruptTurnIdRef.current = runtimeTurnId;
            interruptPendingRef.current = true;
            setActiveTurnId(runtimeTurnId);
            setIsGenerating(false);
            setIsInterrupting(true);
          }
        }
      } else if (data.method?.startsWith('checkpoint/') || data.method?.startsWith('goal/') || data.method?.startsWith('plan/')) {
        setLastWorkflowEvent({ method: data.method, ...notification });
        if (notification.threadId === currentThreadRef.current) {
          loadWorkflows(currentThreadRef.current);
        }
      } else if (data.method === 'item/started' || data.method === 'item/completed') {
        setMessages((prev) => aggregateItemLifecycle(prev, data));
      } else if (data.method === 'thread/settings/updated') {
        applyWorkflowState(
          notification.threadId || notification.thread_id || currentThreadRef.current,
          notification,
        );
      } else if (data.method === 'thread/goal/updated') {
        applyGoalState(
          notification.threadId || notification.thread_id || currentThreadRef.current,
          notification.goal,
          notification,
        );
      } else if (data.method === 'thread/goal/cleared') {
        applyGoalState(
          notification.threadId || notification.thread_id || currentThreadRef.current,
          null,
          notification,
        );
      }
      return;
    }

    // 3. Engine Typed Events
    if (data.type === 'event') {
      const eventTurnId = data.turnId || data.turn_id;
      const stoppedTurn = shouldIgnoreApprovalWhileInterrupting(
        { turnId: eventTurnId },
        interruptPendingRef.current,
        interruptTurnIdRef.current,
      ) || interruptedTurnIdsRef.current.has(String(eventTurnId || ''));
      if (shouldIgnoreStreamEventWhileInterrupting(
        data,
        interruptPendingRef.current,
        interruptTurnIdRef.current,
        interruptedTurnIdsRef.current,
      )) {
        console.debug('[Studio][turn-control] ignored late Turn event', {
          turnId: eventTurnId || null,
          eventType: data.event?.type || null,
        });
        return;
      }
      if (eventTurnId && !stoppedTurn) {
        activeTurnIdRef.current = eventTurnId;
        setActiveTurnId(eventTurnId);
      }
      const evt = data.event || {};
      if (evt.type === 'turn_started') {
        const goalObjective = extractGoalObjective(evt.prompt);
        if (goalObjective) {
          setMessages((prev) => appendGoalMessageToMessages(prev, goalObjective));
        }
        if (!stoppedTurn) {
          setIsGenerating(true);
          setIsInterrupting(false);
          setPlanReviewPending(false);
        }
      } else if (evt.type === 'run_failed') {
        // RunFailed is diagnostic only. The durable turn_finished event below
        // is the lifecycle boundary and owns generating/queue settlement.
        setLastTurnResult((previous) => ({
          status: 'failed',
          stopReason: evt.stop_reason || evt.status || previous?.stopReason || 'failed',
          steps: evt.steps ?? previous?.steps ?? 0,
          turnId: data.turnId || previous?.turnId || null,
          error: evt.error || previous?.error || formatRunFailure(evt.reason),
        }));
      } else if (evt.type === 'run_finished') {
        // Preserve this run-level diagnostic until turn_finished supplies the
        // authoritative TurnStatus and any persisted error detail.
        const diagnosticStatus = evt.stop_reason || evt.status || 'unknown';
        setLastTurnResult((previous) => ({
          status: diagnosticStatus,
          stopReason: diagnosticStatus,
          steps: evt.steps ?? previous?.steps ?? 0,
          turnId: data.turnId || previous?.turnId || null,
          error: evt.error || previous?.error || null,
        }));
      } else if (evt.type === 'turn_finished') {
        const turnStatus = evt.status || evt.stop_reason || 'unknown';
        if (turnStatus === 'steered') {
          showToast('✓ 纠偏已生效，正在应用新指令继续生成...', 'info', 2500);
        } else {
          if (turnStatus !== 'completed') {
            setLastTurnResult((previous) => ({
              status: turnStatus,
              stopReason: evt.stop_reason || evt.status || previous?.stopReason || null,
              steps: evt.steps ?? previous?.steps ?? 0,
              turnId: data.turnId || previous?.turnId || null,
              error: evt.error || previous?.error || null,
            }));
          } else {
            setLastTurnResult(null);
          }
          if (turnStatus === 'completed' && planActiveRef.current) {
            setPlanReviewPending(true);
          }
          setIsGenerating(false);
          setIsInterrupting(false);
          activeTurnIdRef.current = null;
          setActiveTurnId(null);
          interruptPendingRef.current = false;
          interruptTurnIdRef.current = null;
          clearPendingApprovals();
          loadThreads();
          loadWorkflows(currentThreadRef.current);
          if (turnStatus === 'failed') {
            loadTurnFailureDetails(currentThreadRef.current, data.turnId);
          }
        }
      }
      setMessages((prev) => aggregateStreamEvent(prev, data));
    }
  };

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------

  const maybeAutoTitleThread = (prompt) => {
    const threadId = currentThreadRef.current;
    const projectId = currentThreadProjectRef.current;
    const key = scopedThreadKey(threadId, projectId);
    if (
      autoTitleAttemptsRef.current.has(key)
      || !isDefaultThreadTitle(currentThreadMeta.title, threadId)
      || messages.some((message) => message.role === 'user')
    ) return;

    const nextTitle = buildAutoThreadTitle(prompt);
    if (!nextTitle) return;

    autoTitleAttemptsRef.current.add(key);
    const previousTitle = currentThreadMeta.title;
    setCurrentThreadMeta((previous) => ({ ...previous, title: nextTitle }));
    void api.renameThread(threadId, nextTitle, { projectId })
      .then(() => loadThreads())
      .catch(() => {
        autoTitleAttemptsRef.current.delete(key);
        if (
          currentThreadRef.current === threadId
          && (currentThreadProjectRef.current || null) === (projectId || null)
        ) {
          setCurrentThreadMeta((previous) => (
            previous.title === nextTitle
              ? { ...previous, title: previousTitle }
              : previous
          ));
        }
      });
  };

  const handleSendMessage = (inputPayload) => {
    const {
      prompt: promptText,
      images,
      textAttachments,
      fileAttachments,
      referencedFiles,
      selectedSkills = [],
      workflow: requestedWorkflow = null,
    } = normalizeInputPayload(inputPayload);

    const parsedWorkflow = parseWorkflowPrompt(promptText, skillGroups);
    if (parsedWorkflow.unknownWorkflows.length > 0) {
      showToast(
        '未知或已关闭插件技能组: '
          + parsedWorkflow.unknownWorkflows.map((name) => '+ ' + name).join('、'),
        'warning',
      );
      return false;
    }
    const parsedSkills = parseSkillPrompt(parsedWorkflow.prompt, skillCatalog);
    if (parsedSkills.unknownSkills.length > 0) {
      showToast(
        '未知或已禁用技能: '
          + parsedSkills.unknownSkills.map((name) => '$' + name).join('、'),
        'warning',
      );
      return false;
    }
    const normalizedSkills = [...new Set([
      ...selectedSkills,
      ...parsedSkills.selectedSkills,
    ])].slice(0, 8);
    const workflow = requestedWorkflow || parsedWorkflow.workflow;
    if (
      workflow
      && !skillGroups.some(
        (group) => group.id === workflow.id && group.enabled !== false,
      )
    ) {
      showToast('插件技能组已关闭或不可用: + ' + workflow.id, 'warning');
      return false;
    }
    if (
      !parsedWorkflow.prompt.trim()
      && images.length === 0
      && textAttachments.length === 0
      && fileAttachments.length === 0
      && normalizedSkills.length === 0
      && !workflow
    ) return false;
    if (isInterrupting || interruptPendingRef.current || pendingApproval) {
      showToast('当前轮次正在停止，请等待结算后再发送。', 'info', 2500);
      return false;
    }
    if (currentSessionReadOnly) {
      showToast('当前会话由其他进程运行，只能查看，暂不能发送消息。', 'info', 3000);
      return false;
    }

    // A1: Check WebSocket ready state (isOpen) before sending
    if (!wsRef.current || !wsRef.current.isOpen || !wsRef.current.isOpen()) {
      showToast('⚠️ 无法发送消息：当前与服务端的 WebSocket 连接尚未就绪，请稍候重试。', 'warning');
      return false;
    }

    // R1: Do not send 'mode: chat' or 'effort' (preserve standard turn contract)
    const payload = {
      action: 'turn',
      prompt: parsedWorkflow.prompt,
      images,
      textAttachments,
      fileAttachments,
      referencedFiles,
      selectedSkills: normalizedSkills,
      workflow,
      threadId: currentThread,
      project_id: currentThreadProject,
    };
    const messageId = 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const inputTrace = createInputTrace({
      threadId: currentThread,
      projectId: currentThreadProject,
      source: 'user',
      capturedAt: new Date().toISOString(),
      accessScope,
      policy,
      continuationMode,
      planActive,
      goalActive: goalState?.status === 'active',
      images,
      textAttachments,
      fileAttachments,
      referencedFiles,
    });

    setPlanReviewPending(false);

    const sent = wsRef.current.send(payload);
    if (!sent) {
      showToast('⚠️ 消息发送失败：底层连接异常断开。', 'error');
      return false;
    }

    maybeAutoTitleThread(parsedSkills.prompt || parsedWorkflow.prompt || promptText);
    pendingUserMessageIdRef.current = messageId;
    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        role: 'user',
        text: parsedWorkflow.prompt,
        images,
        textAttachments,
        fileAttachments,
        referencedFiles,
        selectedSkills: normalizedSkills,
        workflow,
        thinking: '',
        tools: [],
        inputTrace,
        blocks: [{ type: 'text', content: promptText }],
      },
    ]);
    return true;
  };

  const handleQueueMessage = (inputPayload) => {
    const normalized = normalizeInputPayload(inputPayload);
    if (
      !normalized.prompt.trim()
      && normalized.images.length === 0
      && !normalized.textAttachments?.length
      && !normalized.fileAttachments?.length
      && !normalized.selectedSkills?.length
      && !normalized.workflow
    ) return;
    if (currentSessionReadOnly) {
      showToast('当前会话由其他进程运行，只能查看，暂不能排队消息。', 'info', 3000);
      return;
    }

    setPendingMessages((prev) => [
      ...prev,
      {
        id: `queued_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ...normalized,
        status: 'queued',
      },
    ]);
    showToast('已加入待处理队列，当前任务结束后按顺序发送', 'info', 2200);
  };

  const handleRemoveQueuedMessage = (messageId) => {
    setPendingMessages((prev) => prev.filter((item) => item.id !== messageId));
  };

  const handleEditQueuedMessage = (item) => {
    setPendingMessages((prev) => prev.filter((queued) => queued.id !== item.id));
    setComposerDraft({ ...item, editToken: Date.now() });
    showToast('已将消息退回输入框，可编辑后重新发送', 'info', 1800);
  };

  const handleUpdateQueuedMessage = (messageId, prompt) => {
    const parsedWorkflow = parseWorkflowPrompt(prompt, skillGroups);
    if (parsedWorkflow.unknownWorkflows.length > 0) {
      showToast(
        '未知或已关闭插件技能组: '
          + parsedWorkflow.unknownWorkflows.map((name) => '+ ' + name).join('、'),
        'warning',
      );
      return;
    }
    const parsed = parseSkillPrompt(parsedWorkflow.prompt, skillCatalog);
    if (parsed.unknownSkills.length > 0) {
      showToast(
        `未知或已禁用技能: ${parsed.unknownSkills.map((name) => `$${name}`).join('、')}`,
        'warning',
      );
      return;
    }
    if (parsed.selectedSkills.length > 8) {
      showToast('每个 Turn 最多加载 8 个技能', 'warning');
      return;
    }
    setPendingMessages((prev) => prev.map((item) => (
      item.id === messageId
        ? {
          ...item,
          prompt: parsed.prompt,
          selectedSkills: parsed.selectedSkills,
          workflow: parsedWorkflow.workflow || item.workflow || null,
        }
        : item
    )));
  };

  const handleSteerQueuedMessage = (item) => {
    setPendingMessages((prev) => prev.filter((queued) => queued.id !== item.id));
    handleSteerMessage(item, 'queue-steer');
  };

  useEffect(() => {
    if (isGenerating || interruptPendingRef.current || queueDispatchingRef.current) return;
    const nextMessage = pendingMessages.find((item) => item.status === 'queued');
    if (!nextMessage) return;

    queueDispatchingRef.current = true;
    setPendingMessages((prev) => prev.filter((item) => item.id !== nextMessage.id));
    void (async () => {
      let sent;
      if (nextMessage.directive?.kind === 'plan') {
        sent = await handleStartPlanTask(nextMessage);
      } else if (nextMessage.directive?.kind === 'goal') {
        sent = await handleStartGoal(nextMessage);
      } else {
        sent = handleSendMessage(nextMessage);
      }
      queueDispatchingRef.current = false;
      if (!sent) setPendingMessages((prev) => [nextMessage, ...prev]);
    })();
  }, [isGenerating, pendingMessages]);

  const handleClearChat = () => {
    if (isGenerating) {
      handleInterrupt('clear-chat');
    }
    setMessages([]);
    showToast('已清空当前界面显示；会话历史未删除，重新进入会恢复', 'info', 2600);
  };

  const handleSteerMessage = (text, source = 'direct-steer') => {
    const {
      prompt: promptText,
      images,
      textAttachments,
      referencedFiles,
    } = normalizeInputPayload(text);
    if (!promptText.trim() && images.length === 0 && !textAttachments.length) return;
    if (currentSessionReadOnly) {
      showToast('当前会话由其他进程运行，只能查看，暂不能纠偏。', 'info', 3000);
      return;
    }

    const inputTrace = createInputTrace({
      threadId: currentThread,
      projectId: currentThreadProject,
      turnId: activeTurnId,
      source: 'steer',
      capturedAt: new Date().toISOString(),
      accessScope,
      policy,
      continuationMode,
      planActive,
      goalActive: goalState?.status === 'active',
      images,
      textAttachments,
      referencedFiles,
    });

    // 1. Render user's steer prompt in chat log immediately so it is clearly visible
    setMessages((prev) => [
      ...prev,
      {
        id: 'user_steer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        role: 'user',
        text: promptText,
        isSteer: true,
        messageKind: 'steer',
        steerTurnId: activeTurnId,
        images,
        textAttachments,
        referencedFiles,
        thinking: '',
        tools: [],
        inputTrace,
        blocks: [{ type: 'text', content: promptText }],
      },
    ]);

    // 2. Transmit steer action over WebSocket
    if (wsRef.current) {
      const payload = {
        action: 'steer',
        turnId: activeTurnId,
        text: promptText,
        textAttachments,
        threadId: currentThread,
        project_id: currentThreadProject,
        source,
      };
      const sent = wsRef.current.send(payload);
      console.info('[Studio][turn-control]', {
        action: 'steer',
        source,
        threadId: currentThread,
        turnId: activeTurnId,
        sent,
        hasAttachments: images.length > 0 || textAttachments.length > 0,
      });
      showToast('已发送实时纠偏指令 (Steer)', 'info', 2000);
    }
  };

  const handleInterrupt = (source = 'composer-stop') => {
    if (currentSessionReadOnly) {
      showToast('当前会话由其他进程运行，只能查看，暂不能中断。', 'info', 3000);
      return;
    }
    const approvalTurnId = pendingApproval?.data?.turnId || pendingApproval?.data?.turn_id;
    const turnId = activeTurnIdRef.current || approvalTurnId || activeTurnId;
    if (!turnId) {
      showToast('当前没有可停止的任务轮次。', 'info', 2500);
      return;
    }
    interruptPendingRef.current = true;
    interruptTurnIdRef.current = turnId;
    rememberInterruptedTurn(turnId);
    setIsInterrupting(true);
    setIsGenerating(false);
    // Keep the approval dock visible while the interrupt settles. Its actions
    // are disabled by isInterrupting, which makes the cancellation boundary
    // observable and prevents a stale approval from looking actionable.
    const hasPendingApproval = pendingApprovalsRef.current.length > 0
      || Boolean(pendingApprovalRef.current);
    const restoreAfterInterruptFailure = (err) => {
      if (interruptTurnIdRef.current !== turnId) return;
      forgetInterruptedTurn(turnId);
      interruptPendingRef.current = false;
      interruptTurnIdRef.current = null;
      setIsInterrupting(false);
      setIsGenerating(true);
      showToast(`停止请求发送失败：${err.message || '服务端未确认'}。`, 'error', 4000);
    };
    let sent = false;
    if (!hasPendingApproval && wsRef.current) {
      sent = wsRef.current.send({
        action: 'interrupt',
        turnId,
        threadId: currentThread,
        project_id: currentThreadProject,
        source,
      });
    }
    if (hasPendingApproval || !sent) {
      // A WebSocket send only means that the browser accepted the frame. When
      // an approval is pending, use the REST boundary whose response includes
      // the Gateway's approval cancellation and App Server interrupt result.
      sent = true;
      void api.interruptTurn(turnId, currentThread, {
        projectId: currentThreadProject,
      }).catch(restoreAfterInterruptFailure);
    }
    console.info('[Studio][turn-control]', {
      action: 'interrupt',
      source,
      threadId: currentThread,
      turnId,
      sent,
    });
    // Keep the Turn identity until the authoritative turn_finished/error
    // arrives. Clearing it here makes a late terminal event look unscoped and
    // leaves the UI in "stopping" when the approval path settles first.
    const approvals = pendingApprovalsRef.current;
    if (approvals.length > 0) {
      setMessages((prev) => approvals.reduce(
        (next, approval) => mergeApprovalEvent(next, {
          ...(approval.data || {}),
          requestId: approval.requestId,
          phase: 'resolved',
          state: 'expired',
          source: 'interrupted',
          reason: '当前 Turn 已停止，审批已失效。',
        }),
        prev,
      ));
    }
    showToast('已发送停止生成请求', 'info', 1800);
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      const last = { ...copy[copy.length - 1] };
      if (last.blocks) {
        last.blocks = last.blocks.map((b) => {
          if (b.type === 'thinking') return { ...b, isStreaming: false };
          if (b.type === 'tool' && b.status === 'running')
            return { ...b, status: 'failed', error: 'User stopped' };
          return b;
        });
      }
      copy[copy.length - 1] = last;
      return copy;
    });
  };

  const handleRespondApproval = async (
    requestId,
    decision,
    reason = '',
    requestedScope = 'once',
    callId = null,
  ) => {
    if (interruptPendingRef.current || isInterrupting) {
      // The dock is disabled during interruption. Keep its non-actionable
      // state visible until the Gateway publishes the resolved approval so a
      // user can see why a click cannot release the tool.
      showToast('当前轮次正在停止，该审批已失效。', 'info', 2500);
      return;
    }
    const approval = pendingApprovalsRef.current.find((item) => (
      item.requestId === requestId
      && (!callId || (item.data?.callId || item.data?.call_id) === callId)
    )) || pendingApprovalRef.current;
    if (!approval) {
      showToast('该审批已失效，请刷新当前会话状态。', 'warning', 3000);
      return;
    }
    const approvalKey = approvalIdentity(approval);
    if (approvalSubmissionRef.current.has(approvalKey)) {
      showToast('该审批正在提交，请等待其他浏览器同步结果。', 'info', 2500);
      return;
    }
    const approvalData = approval?.data || {};
    const approvalCallId = approvalData.callId || approvalData.call_id || callId;
    const approvalProjectId = approvalData.projectId || approvalData.project_id || currentThreadProject;
    const approvalThreadId = approvalData.threadId || approvalData.thread_id || currentThread;
    const approvalTurnId = approvalData.turnId || approvalData.turn_id || null;
    const allowedScopes = approvalData.allowedGrantScopes || [];
    const selectedScope = allowedScopes.includes(requestedScope)
      ? requestedScope
      : decision === 'approve' ? allowedScopes[0] : null;
    const payload = {
      action: 'approval_response',
      requestId,
      decision,
      reason,
      grantScope: decision === 'approve' ? selectedScope : null,
      project_id: approvalProjectId,
      threadId: approvalThreadId,
      turnId: approvalTurnId,
      callId: approvalCallId,
    };
    approvalSubmissionRef.current.set(approvalKey, {
      requestId,
      callId: approvalCallId,
      identity: approvalKey,
      decision,
    });
    try {
      const sent = wsRef.current?.send(payload) || false;
      if (!sent) {
        await api.respondApproval(
          requestId,
          decision,
          decision === 'approve' ? selectedScope : null,
          reason,
          {
            projectId: approvalProjectId,
            threadId: approvalThreadId,
            turnId: approvalTurnId,
            callId: approvalCallId,
          },
        );
      }
    } catch {
      approvalSubmissionRef.current.delete(approvalKey);
      enqueuePendingApproval(approval);
      showToast(
        '安全审批提交失败：该请求可能已由其他浏览器处理或已失效。',
        'warning',
        5000,
      );
      loadPendingApproval(currentThreadRef.current, currentThreadProjectRef.current);
      return;
    }
    removePendingApproval(approval);
    showToast(`已提交安全审批决定: ${decision === 'approve' ? '允许执行' : '拒绝'}，正在同步其他浏览器`, 'info', 2500);
  };

  const handleSelectThread = async (threadId, projectId = null) => {
    const selected = threads.find(
      (thread) =>
        thread.thread_id === threadId &&
        (!projectId || thread.project === projectId),
    );
    const nextProject = projectId || selected?.project || null;
    if (
      threadId === currentThread
      && (nextProject || null) === (currentThreadProject || null)
    ) return;
    const context = beginSessionRequest(threadId, nextProject);
    startSessionSync(threadId, nextProject);

    // Clear every projection before the new session can render. The epoch and
    // AbortController below make late history/workflow/file responses unable
    // to repopulate this freshly selected session.
    resetSessionProjections({ loadingHistory: true });
    workflowRevisionsRef.current.delete(scopedThreadKey(threadId, nextProject));
    currentThreadRef.current = threadId;
    currentThreadProjectRef.current = nextProject;
    setActiveProjectId(nextProject);
    setCurrentThread(threadId);
    setCurrentThreadProject(nextProject);
    if (selected) {
      setCurrentThreadMeta(readThreadMeta(selected, threadId));
    }
    try {
      // Attach first. All project-agnostic thread APIs use this active
      // project context after the attach completes.
      const result = await api.attachThread(threadId, nextProject, { signal: context.signal });
      if (!isCurrentSessionRequest(context)) return;
      setCurrentSessionReadOnly(
        result.attached === false && result.session_status === 'locked',
      );
      if (!result.attached && result.session_status === 'locked') {
        showToast('该 Session 正在另一个进程运行，当前为只读查看；结束后可重新 attach', 'info', 3500);
      }
      await Promise.all([
        loadSettings(context),
        loadThreadHistory(threadId, nextProject, context),
        loadWorkflows(threadId, nextProject, context),
        loadRuntimeStatus(threadId, nextProject, context),
        loadPendingApproval(threadId, nextProject, context),
      ]);
      await replayMissedEvents(threadId, nextProject, context);
      finishSessionSync(threadId, nextProject);
    } catch (err) {
      if (isAbortError(err) || !isCurrentSessionRequest(context)) return;
      setIsLoadingHistory(false);
      clearSessionSync(threadId, nextProject);
      showToast(`切换 Session 失败: ${err.message}`, 'error');
    }
  };

  const handleNewThread = async (customProject = null, customTitle = null) => {
    const tid = `t-${Date.now().toString(36)}`;
    const finalTitle =
      customTitle && customTitle.trim() ? customTitle.trim() : `新会话 ${tid}`;
    try {
      const result = await api.startThread(tid, finalTitle, customProject, {
        projectId: customProject,
      });
      const nextProject = result.project || customProject || null;
      await loadThreads();
      const context = beginSessionRequest(tid, nextProject);
      resetSessionProjections();
      currentThreadRef.current = tid;
      currentThreadProjectRef.current = nextProject;
      setActiveProjectId(nextProject);
      setCurrentThread(tid);
      setCurrentThreadProject(nextProject);
      setCurrentThreadMeta(readThreadMeta({
        title: finalTitle,
        summary: '',
        session_id: result.session_id,
      }, tid));
      await Promise.all([
        loadSettings(context),
        loadThreadHistory(tid, nextProject, context),
      ]);
      showToast(`已创建新会话: ${finalTitle}`, 'success');
    } catch (err) {
      showToast(`创建新会话失败: ${err.message}`, 'error');
    }
  };

  const handleForkThread = async (
    sourceThreadId,
    sourceProjectId = null,
    contextPolicy = 'exact',
  ) => {
    const newId = `${sourceThreadId}_fork_${Date.now().toString(36).slice(2, 6)}`;
    try {
      const sourceProject = sourceProjectId || currentThreadProjectRef.current || null;
      const source = threads.find(
        (thread) =>
          thread.thread_id === sourceThreadId &&
          (!sourceProject || thread.project === sourceProject),
      );
      const result = await api.forkThread(
        sourceThreadId,
        newId,
        null,
        source?.project || sourceProject,
        {
          projectId: source?.project || sourceProject,
          contextPolicy,
        },
      );
      const nextProject = result.project || source?.project || null;
      await loadThreads();
      const context = beginSessionRequest(newId, nextProject);
      resetSessionProjections({ loadingHistory: true });
      currentThreadRef.current = newId;
      currentThreadProjectRef.current = nextProject;
      setActiveProjectId(nextProject);
      setCurrentThread(newId);
      setCurrentThreadProject(nextProject);
      setCurrentThreadMeta(readThreadMeta({
        title: result.title || `${sourceThreadId} (Fork)`,
        summary: `Forked from ${sourceThreadId}`,
        session_id: result.session_id,
        parent_session_id: result.parent_session_id,
        parent_checkpoint_seq: result.parent_checkpoint_seq,
        session_bytes: result.session_bytes,
        context_before_bytes: result.context_before_bytes,
        context_after_bytes: result.context_after_bytes,
        compacted: result.compacted,
        compaction_method: result.method,
      }, newId));
      await loadThreadHistory(newId, nextProject, context);
      await Promise.all([
        loadSettings(context),
        loadWorkflows(newId, nextProject, context),
        loadRuntimeStatus(newId, nextProject, context),
      ]);
      showToast(
        `${contextPolicy === 'compact' ? '已派生并压缩分支' : '已派生独立分支'}: ${newId} · Session ${result.session_id || '未知'}`,
        'success',
      );
    } catch (err) {
      showToast(`派生分支失败: ${err.message}`, 'error');
    }
  };

  const handleCloseThread = async (threadId, projectId = null) => {
    try {
      const closingProject =
        projectId ||
        threads.find((thread) => thread.thread_id === threadId)?.project ||
        (threadId === currentThread ? currentThreadProjectRef.current : null);
      await api.closeThread(threadId, { projectId: closingProject });
      await loadThreads();
      if (currentThread === threadId) {
        const context = beginSessionRequest('default', null);
        resetSessionProjections({ loadingHistory: true });
        currentThreadRef.current = 'default';
        currentThreadProjectRef.current = null;
        setActiveProjectId(null);
        setCurrentThread('default');
        setCurrentThreadProject(null);
        await Promise.all([
          loadSettings(context),
          loadThreadHistory('default', null, context),
        ]);
      }
      showToast(`已关闭并归档会话: ${threadId}`, 'info');
    } catch (err) {
      showToast(`关闭会话失败: ${err.message}`, 'error');
    }
  };

  const handleRenameThread = async (threadId, newTitle, projectId = null) => {
    try {
      const targetId = typeof threadId === 'string' ? threadId : currentThread;
      const targetProject =
        projectId ||
        threads.find((thread) => thread.thread_id === targetId)?.project ||
        (targetId === currentThread ? currentThreadProjectRef.current : null);
      await api.renameThread(targetId, newTitle, { projectId: targetProject });
      if (targetId === currentThread) {
        setCurrentThreadMeta((prev) => ({ ...prev, title: newTitle }));
      }
      loadThreads();
      showToast(`已重命名会话为: ${newTitle}`, 'success');
    } catch (err) {
      showToast(`重命名失败: ${err.message}`, 'error');
    }
  };

  const handleUpdateSummary = async (threadId, newSummary, projectId = null) => {
    try {
      const targetId = typeof threadId === 'string' ? threadId : currentThread;
      const targetProject =
        projectId ||
        threads.find((thread) => thread.thread_id === targetId)?.project ||
        (targetId === currentThread ? currentThreadProjectRef.current : null);
      await api.updateThreadSummary(targetId, newSummary, { projectId: targetProject });
      if (targetId === currentThread) {
        setCurrentThreadMeta((prev) => ({ ...prev, summary: newSummary }));
      }
      loadThreads();
      showToast('已更新阶段摘要', 'success');
    } catch (err) {
      showToast(`设置摘要失败: ${err.message}`, 'error');
    }
  };

  const handleSetPlanMode = async (active) => {
    if (
      isGenerating
      || activeTurnIdRef.current
      || isInterrupting
      || interruptPendingRef.current
      || pendingApproval
    ) {
      showToast('当前轮次正在执行，Plan Mode 将在本轮结束后才能切换。', 'info', 3000);
      return false;
    }
    try {
      const res = await api.setCollaborationMode(
        active ? 'plan' : 'default',
        currentThread,
        null,
        { projectId: currentThreadProject },
      );
      applyWorkflowState(currentThread, res, currentThreadProject);
      const confirmedActive = (res.collaboration_mode || res.collaborationMode)?.mode === 'plan';
      if (!confirmedActive) setPlanReviewPending(false);
      showToast(
        confirmedActive
          ? 'Plan Mode 已开启（源码只读规划）'
          : 'Plan Mode 已关闭',
        'info',
      );
      return confirmedActive === active;
    } catch (err) {
      await loadWorkflows(currentThreadRef.current, currentThreadProjectRef.current);
      showToast(`切换 Plan Mode 失败: ${err.message}`, 'error');
      return false;
    }
  };

  const handleTogglePlan = async () => handleSetPlanMode(!planActive);

  const handleStartPlanTask = async ({
    prompt,
    images = [],
    textAttachments = [],
    fileAttachments = [],
    referencedFiles = [],
    selectedSkills = [],
    workflow = null,
  }) => {
    if (
      isGenerating
      || activeTurnIdRef.current
      || isInterrupting
      || interruptPendingRef.current
      || pendingApproval
    ) {
      showToast('当前轮次正在执行，Plan 任务请在本轮结束后发送。', 'info', 3000);
      return false;
    }
    if (!planActive) {
      const enabled = await handleSetPlanMode(true);
      if (!enabled) return false;
    }
    return handleSendMessage({
      prompt,
      images,
      textAttachments,
      fileAttachments,
      referencedFiles,
      selectedSkills,
      workflow,
    });
  };

  const handleContinuePlanning = () => {
    setPlanReviewPending(false);
    showToast('继续保持 Plan Mode，可补充或调整规划', 'info', 2200);
  };

  const handleStartImplementation = async () => {
    const started = await startImplementationTurn({
      disablePlanMode: () => handleSetPlanMode(false),
      sendTurn: handleSendMessage,
    });
    if (started) {
      showToast('已根据当前计划开始实施', 'success', 2500);
    }
    return started;
  };

  const handleStartGoal = async (objectiveOrPayload) => {
    const isPayload = objectiveOrPayload && typeof objectiveOrPayload === 'object';
    const objective = isPayload ? objectiveOrPayload.prompt : objectiveOrPayload;
    if (!String(objective || '').trim()) return false;
    try {
      const result = await api.setGoal(
        objective,
        null,
        'active',
        currentThread,
        { projectId: currentThreadProject },
      );
      const goal = result.goal || result;
      applyGoalState(currentThread, goal, result, currentThreadProject);
      if (isPayload) {
        const sent = handleSendMessage(objectiveOrPayload);
        if (sent) showToast('Goal 已启动，并已发送当前任务', 'success');
        return sent;
      }
      showToast('Goal 已启动，并会在状态栏与详情抽屉中显示', 'success');
      return true;
    } catch (err) {
      showToast(`启动 Goal 失败: ${err.message}`, 'error');
      return false;
    }
  };

  const handleOpenSidePanel = (tab = 'status') => {
    setSidePanelTab(tab);
    setSidePanelOpen(true);
  };

  const handleUpdateExecution = async (nextAccess, nextPolicy) => {
    if (isGenerating || activeTurnIdRef.current || isInterrupting || interruptPendingRef.current || pendingApproval) {
      showToast('当前轮次正在执行，策略未切换；请在本轮结束后重试。', 'info', 3000);
      return;
    }
    try {
      await api.setWorldExecution(nextAccess, nextPolicy, { projectId: currentThreadProject });
      setAccessScope(nextAccess);
      setPolicy(nextPolicy);
      setUserSettings((prev) => ({
        ...prev,
        access: nextAccess,
        policy: nextPolicy,
      }));
    } catch (err) {
      showToast(`更新执行范围失败: ${err.message}`, 'error');
    }
  };

  const handleUpdateContinuation = async (nextMode) => {
    if (isGenerating || activeTurnIdRef.current || isInterrupting || interruptPendingRef.current || pendingApproval) {
      showToast('当前轮次正在执行，推进方式未切换；请在本轮结束后重试。', 'info', 3000);
      return;
    }
    try {
      const res = await api.updateThreadSettings(
        planActive ? 'plan' : 'default',
        null,
        currentThread,
        nextMode,
        { projectId: currentThreadProject },
      );
      applyWorkflowState(currentThread, res, currentThreadProject);
      showToast(
        nextMode === 'continuous'
          ? '已开启连续执行；普通 Chat 不再受 8 步上限限制'
          : '已切回有界单轮执行（默认 8 步）',
        'info',
      );
    } catch (err) {
      showToast(`更新推进方式失败: ${err.message}`, 'error');
    }
  };

  const handleEnableAutoCopilot = async () => {
    if (isGenerating || activeTurnIdRef.current || isInterrupting || interruptPendingRef.current || pendingApproval) {
      showToast('当前轮次正在执行，暂时无法开启 Auto Copilot；请在本轮结束后重试。', 'info', 3000);
      return;
    }
    try {
      await api.setWorldExecution(accessScope, 'trusted', { projectId: currentThreadProject });
      const res = await api.updateThreadSettings(
        planActive ? 'plan' : 'default',
        null,
        currentThread,
        'continuous',
        { projectId: currentThreadProject },
      );
      setPolicy('trusted');
      setUserSettings((prev) => ({ ...prev, policy: 'trusted' }));
      applyWorkflowState(currentThread, res, currentThreadProject);
      showToast('Auto Copilot 已显式开启：连续执行 + 信任执行，高风险仍需确认', 'success');
    } catch (err) {
      showToast(`开启 Auto Copilot 失败: ${err.message}`, 'error');
    }
  };

  const statusModel = getStatusViewModel({
    projectId: currentThreadProject,
    threadId: currentThread,
    isConnected,
    isGenerating,
    isInterrupting,
    activeTurnId,
    pendingApproval,
    planActive,
    planReviewPending: planReviewPending && !isGenerating,
    goalState,
    runtimeStatus,
    lastWorkflowEvent,
    lastTurnResult,
    connectionState,
    accessScope,
    policy,
    continuationMode,
    sessionReadOnly: currentSessionReadOnly,
  });

  return (
    <AppLayout
      currentThread={currentThread}
      threadTitle={currentThreadMeta.title}
      threadSummary={currentThreadMeta.summary}
      sessionId={currentThreadMeta.sessionId}
      sessionMeta={currentThreadMeta}
      isConnected={isConnected}
      onOpenSidePanel={handleOpenSidePanel}
      onOpenSettings={() => setSettingsModalOpen(true)}
      onRenameThread={handleRenameThread}
      onUpdateSummary={handleUpdateSummary}
      onRenameCurrentThread={(title) => handleRenameThread(currentThread, title)}
      onUpdateCurrentSummary={(summary) => handleUpdateSummary(currentThread, summary)}
      threads={threads}
      currentThreadProject={currentThreadProject}
      isGenerating={isGenerating}
      onSelectThread={handleSelectThread}
      onNewThread={handleNewThread}
      onForkThread={handleForkThread}
      onCloseThread={handleCloseThread}
      onRefreshThreads={loadThreads}
      onToast={showToast}
      planActive={planActive}
      statusModel={statusModel}
      isInterrupting={isInterrupting}
      pendingApproval={pendingApproval}
      pendingApprovalCount={pendingApprovals.length}
      onContinuePlanning={handleContinuePlanning}
      onStartImplementation={handleStartImplementation}
      onClosePlan={() => handleSetPlanMode(false)}
      goalState={goalState}
      messages={messages}
      threadItems={threadItems}
      lastTurnResult={lastTurnResult}
      policy={policy}
      onSendMessage={handleSendMessage}
      userSettings={userSettings}
      isLoadingHistory={isLoadingHistory}
      sessionReadOnly={currentSessionReadOnly}
      onRespondApproval={handleRespondApproval}
      onChangeExecution={handleUpdateExecution}
      onChangeContinuation={handleUpdateContinuation}
      onEnableAutoCopilot={handleEnableAutoCopilot}
      onStartPlanTask={handleStartPlanTask}
      onStartGoal={handleStartGoal}
      onQueueMessage={handleQueueMessage}
      pendingMessages={pendingMessages}
      onSteerQueuedMessage={handleSteerQueuedMessage}
      onEditQueuedMessage={handleEditQueuedMessage}
      onUpdateQueuedMessage={handleUpdateQueuedMessage}
      onRemoveQueuedMessage={handleRemoveQueuedMessage}
      composerDraft={composerDraft}
      onComposerDraftApplied={() => setComposerDraft(null)}
      onInterrupt={handleInterrupt}
      onClearChat={handleClearChat}
      onTogglePlanMode={handleTogglePlan}
      sidePanelOpen={sidePanelOpen}
      sidePanelTab={sidePanelTab}
      onCloseSidePanelPanel={() => setSidePanelOpen(false)}
      onGoalChanged={(goal, payload) => applyGoalState(
        currentThread,
        goal,
        payload,
        currentThreadProject,
      )}
      onTogglePlan={handleTogglePlan}
      settingsModalOpen={settingsModalOpen}
      onCloseSettings={() => setSettingsModalOpen(false)}
      onSettingsSaved={(newSettings) => {
        if (newSettings.theme) {
          document.body.className = `theme-${normalizeTheme(newSettings.theme)}`;
        }
        showToast('偏好设置已保存并生效', 'success', 2000);
      }}
      toasts={toasts}
      onDismissToast={dismissToast}
      skillCatalog={skillCatalog}
      skillGroups={skillGroups}
      skillsLoading={skillsLoading}
      skillsError={skillsError}
      onToggleSkillGroup={handleToggleSkillGroup}
      onInsertSkill={handleInsertSkill}
      onOpenThread={handleSelectThread}
      skillInsertion={skillInsertion}
      onSkillInsertionApplied={() => setSkillInsertion(null)}
    />
  );
}
