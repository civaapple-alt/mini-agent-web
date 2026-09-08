import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import InputBar from './components/InputBar';
import SidePanel from './components/SidePanel';
import SettingsModal from './components/SettingsModal';
import Toast from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import { api, createAgentWebSocket } from './api';
import {
  shouldAcceptEventForThread,
  aggregateItemLifecycle,
  aggregateStreamEvent,
  aggregateThreadItems,
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
import './App.css';

function normalizeInputPayload(inputPayload) {
  if (typeof inputPayload === 'string') {
    return { prompt: inputPayload, images: [], referencedFiles: [] };
  }
  if (typeof inputPayload === 'object' && inputPayload !== null) {
    return {
      prompt: inputPayload.prompt || '',
      images: inputPayload.images || [],
      referencedFiles: inputPayload.referencedFiles || [],
    };
  }
  return { prompt: '', images: [], referencedFiles: [] };
}

function formatRunFailure(reason) {
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

function normalizeGoal(goal) {
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

const RUNTIME_PHASE_LABELS = {
  idle: '空闲',
  starting_turn: '启动 Turn',
  model: '模型调用',
  tool: '工具执行',
  waiting_approval: '等待审批',
  compaction: '上下文压缩',
  persisting: '保存状态',
  goal_verification: 'Goal Verify',
  goal_continuation_queued: 'Goal 排队',
  resuming: '恢复运行',
  completed: '已完成',
  failed: '失败',
};

function scopedThreadKey(threadId, projectId) {
  return `${projectId || ''}:${threadId}`;
}

const SELECTED_SESSION_STORAGE_KEY = 'mini-agent-studio.selected-session';

function readPersistedSessionSelection() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SELECTED_SESSION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export default function App() {
  const [threads, setThreads] = useState([]);
  const [currentThread, setCurrentThread] = useState(
    () => readPersistedSessionSelection().threadId || 'default',
  );
  const [currentThreadProject, setCurrentThreadProject] = useState(
    () => readPersistedSessionSelection().projectId || null,
  );
  const [currentThreadMeta, setCurrentThreadMeta] = useState({
    title: '默认会话 (Default Session)',
    summary: '',
  });
  const [messages, setMessages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(null);
  const [pendingMessages, setPendingMessages] = useState([]);
  const [composerDraft, setComposerDraft] = useState(null);
  const [lastTurnResult, setLastTurnResult] = useState(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [toasts, setToasts] = useState([]);

  // Workflow & Environment
  const [planActive, setPlanActive] = useState(false);
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
  const [sidePanelTab, setSidePanelTab] = useState('world');
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef(null);
  const workflowRevisionsRef = useRef(new Map());
  const eventCursorsRef = useRef(new Map());
  const hasConnectedRef = useRef(false);
  const runtimeGenerationRef = useRef(0);
  const queueDispatchingRef = useRef(false);
  const interruptPendingRef = useRef(false);
  const currentThreadRef = useRef(currentThread);
  const currentThreadProjectRef = useRef(currentThreadProject);
  const goalStateRef = useRef(goalState);
  const selectionPersistenceReadyRef = useRef(false);
  currentThreadRef.current = currentThread;
  currentThreadProjectRef.current = currentThreadProject;

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
    loadSettings();
    initializeSession();

    // Establish WebSocket Connection
    const wsClient = createAgentWebSocket(
      handleServerEvent,
      () => {
        setIsConnected(true);
        // A reconnect may follow an App Server restart, whose in-memory
        // revision sequence starts over. Re-read the canonical projection to
        // rebuild the Web cursor before accepting new notifications.
        workflowRevisionsRef.current.clear();
        runtimeGenerationRef.current = 0;
        loadWorkflows(currentThreadRef.current);
        loadRuntimeStatus(currentThreadRef.current);
        if (hasConnectedRef.current) {
          replayMissedEvents(currentThreadRef.current);
        }
        hasConnectedRef.current = true;
        showToast('✓ 已连接到 Agent Gateway 服务端', 'success', 2000);
      },
      () => {
        setIsConnected(false);
        showToast('⚠️ 与 Agent Gateway 连接断开，尝试重连中...', 'warning', 2500);
      }
    );
    wsRef.current = wsClient;

    return () => {
      wsClient.close();
    };
  }, []);

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      setUserSettings((prev) => ({ ...prev, ...data }));
      if (data.access) setAccessScope(data.access);
      if (data.policy) setPolicy(data.policy);
      const activeTheme = data.theme || 'light';
      document.body.className = `theme-${activeTheme}`;
    } catch (err) {
      console.error('Failed to load settings:', err);
      document.body.className = 'theme-light';
    }
  };

  const loadThreads = async () => {
    try {
      const data = await api.listThreads();
      let cur = null;
      if (data.threads && data.threads.length > 0) {
        setThreads(data.threads);
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
          setCurrentThreadMeta({
            title: cur.title || cur.thread_id,
            summary: cur.summary || '',
          });
        }
      }
      return cur;
    } catch (err) {
      console.error('Failed to load threads:', err);
      return null;
    }
  };

  const initializeSession = async () => {
    const selected = await loadThreads();
    if (!selected) return;

    const nextThread = selected.thread_id || 'default';
    const nextProject =
      selected.project || currentThreadProjectRef.current || null;
    currentThreadRef.current = nextThread;
    currentThreadProjectRef.current = nextProject;
    setCurrentThread(nextThread);
    setCurrentThreadProject(nextProject);
    setCurrentThreadMeta({
      title: selected.title || nextThread,
      summary: selected.summary || '',
    });

    // Establish the project-qualified routing context before reading the
    // project-agnostic history/workflow endpoints. A locked external Session
    // remains readable and will be retried by an explicit later attach.
    try {
      await api.attachThread(nextThread, nextProject);
    } catch (err) {
      console.debug('Failed to attach persisted session during startup:', err);
    }
    await Promise.all([
      loadThreadHistory(nextThread, nextProject),
      loadWorkflows(nextThread, nextProject),
      loadRuntimeStatus(nextThread, nextProject),
    ]);
  };

  const loadWorkflows = async (
    threadId = currentThreadRef.current,
    projectId = currentThreadProjectRef.current,
  ) => {
    try {
      const wfState = await api.getWorkflowState(threadId);
      const normalizedState = { ...wfState, goal: normalizeGoal(wfState.goal) };
      if (!applyWorkflowState(threadId, normalizedState, projectId)) return;
      goalStateRef.current = normalizedState.goal;
      setGoalState(normalizedState.goal);
    } catch (err) {
      console.error('Failed to load workflow state:', err);
    }
  };

  const loadRuntimeStatus = async (
    threadId = currentThreadRef.current,
    projectId = currentThreadProjectRef.current,
  ) => {
    try {
      const status = await api.getRuntimeStatus(threadId);
      if (
        currentThreadRef.current === threadId &&
        (!projectId || currentThreadProjectRef.current === projectId)
      ) setRuntimeStatus(status);
    } catch (err) {
      console.debug('Failed to load runtime status:', err);
    }
  };

  const replayMissedEvents = async (
    threadId = currentThreadRef.current,
    projectId = currentThreadProjectRef.current,
  ) => {
    const afterSequence = eventCursorsRef.current.get(
      scopedThreadKey(threadId, projectId),
    );
    try {
      const page = await api.replayThreadEvents(threadId, afterSequence ?? 0, 128);
      if (page.has_gap) {
        // The bounded App Server cache no longer contains the complete gap;
        // canonical history is the safe reconciliation boundary.
        await loadThreadHistory(threadId);
      }
      for (const event of page.data || []) {
        handleServerEvent({ type: 'event', ...event });
      }
    } catch (err) {
      console.debug('Failed to replay runtime events:', err);
      await loadThreadHistory(threadId);
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
    setPlanActive(mode?.mode === 'plan');
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
  ) => {
    setIsLoadingHistory(true);
    try {
      const [cp, itemPage] = await Promise.all([
        api.readThread(threadId),
        api.listThreadItems(threadId, { limit: 128 }),
      ]);
      if (
        currentThreadRef.current !== threadId ||
        (projectId && currentThreadProjectRef.current !== projectId)
      ) return;
      if (cp.metadata) {
        setCurrentThreadMeta({
          title: cp.metadata.title || threadId,
          summary: cp.metadata.summary || '',
        });
      }
      const persistedTurn = cp.last_turn_status || cp.session?.last_turn_status;
      if (persistedTurn && persistedTurn !== 'completed') {
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
      const rawMessages = cp.messages || [];
      const persistedGoalObjective = cp.session?.goal?.objective?.trim() || '';
      let historyGoalObjective = persistedGoalObjective;
      let goalMessageAdded = false;
      const formatted = rawMessages.reduce((result, m, idx) => {
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
        if (m.role === 'system') return result;
        if (text.startsWith('<world_state') || text.includes('</world_state>')) return result;
        result.push({
          id: m.id || `hist_${threadId}_${idx}`,
          role: m.role,
          text: m.text || '',
          thinking: '',
          tools: [],
          blocks: [
            {
              type: 'text',
              content: m.text || '',
            },
          ],
        });
        return result;
      }, []);
      if (historyGoalObjective && !goalMessageAdded) {
        formatted.push(createGoalMessage(historyGoalObjective, `goal_hist_${threadId}`));
      }
      setMessages(aggregateThreadItems(formatted, itemPage.data || []));
    } catch (err) {
      console.error(`Failed to load thread ${threadId}:`, err);
      showToast(`加载会话历史失败: ${err.message}`, 'error');
      setMessages([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  function loadTurnFailureDetails(threadId, turnId) {
    return api.readThread(threadId).then((checkpoint) => {
      const lastTurnId = checkpoint.last_turn_id || checkpoint.session?.last_turn_id;
      const error = checkpoint.last_turn_error || checkpoint.session?.last_turn_error;
      if (!error || currentThreadRef.current !== threadId) return;
      if (turnId && lastTurnId && lastTurnId !== turnId) return;
      setLastTurnResult((previous) => (previous
        ? { ...previous, turnId: previous.turnId || lastTurnId || turnId, error }
        : previous));
    }).catch((err) => {
      console.debug('Failed to load turn failure details:', err);
    });
  }

  // ---------------------------------------------------------------------------
  // WebSocket Message / Event Dispatcher
  // ---------------------------------------------------------------------------

  const handleServerEvent = (data) => {
    if (!data) return;

    if (data.type === 'event' && data.threadId && data.sequence) {
      const eventProject = data.projectId || data.data?.projectId || currentThreadProjectRef.current;
      const eventKey = scopedThreadKey(data.threadId, eventProject);
      const current = eventCursorsRef.current.get(eventKey) || 0;
      if (data.sequence > current) {
        eventCursorsRef.current.set(eventKey, data.sequence);
      }
    }

    // A2: Isolate stream events by active thread to prevent cross-thread pollution
    if (!shouldAcceptEventForThread(
      data,
      currentThreadRef.current,
      currentThreadProjectRef.current,
    )) {
      if (data.type === 'event') {
        const evtType = data.event?.type;
        if (evtType === 'turn_finished' || evtType === 'run_finished' || evtType === 'run_failed') {
          loadThreads();
        }
      }
      return;
    }

    // 1. Capture Turn ID from submission
    if (data.type === '_turn_submission') {
      const turnId = data.data?.turn_id || data.submission?.turn_id;
      if (turnId) {
        setActiveTurnId(turnId);
        setIsGenerating(true);
        queueDispatchingRef.current = false;
        interruptPendingRef.current = false;
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
      console.warn('[Studio][turn-control]', {
        action: 'gateway-error',
        source: data.source || data.scope || 'gateway',
        threadId: data.threadId || currentThreadRef.current,
        turnId: data.turnId || activeTurnId || null,
        message: data.message || '操作异常',
      });
      showToast(`⚠️ ${data.message || '操作异常'}`, 'error', 4000);
      if (data.terminal && data.scope === 'turn') {
        setLastTurnResult({
          status: data.status || 'failed',
          stopReason: data.stopReason || data.stop_reason || 'failed',
          steps: data.steps || 0,
          turnId: data.turnId || activeTurnId || null,
          error: data.message || '网关/运行时错误',
        });
        queueDispatchingRef.current = false;
        interruptPendingRef.current = false;
        setIsGenerating(false);
        setActiveTurnId(null);
        setPendingApproval(null);
        loadThreads();
      }
      return;
    }

    // 2. Security Approval Interception
    if (data.type === 'approval_request') {
      setPendingApproval({
        requestId: data.requestId,
        data: data.data,
      });
      return;
    }

    if (data.type === 'approval') {
      const approval = data.approval || {};
      if (approval.phase === 'requested') {
        setPendingApproval({
          requestId: approval.requestId,
          data: approval,
        });
      } else if (approval.phase === 'resolved') {
        setPendingApproval((current) =>
          current?.requestId === approval.requestId ? null : current
        );
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
        if (notification.threadId === currentThreadRef.current) {
          setRuntimeStatus(notification);
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
      if (data.turnId) {
        setActiveTurnId(data.turnId);
      }
      const evt = data.event || {};
      if (evt.type === 'turn_started') {
        const goalObjective = extractGoalObjective(evt.prompt);
        if (goalObjective) {
          setMessages((prev) => appendGoalMessageToMessages(prev, goalObjective));
        }
        setIsGenerating(true);
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
          setIsGenerating(false);
          setActiveTurnId(null);
          interruptPendingRef.current = false;
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

  const handleSendMessage = (inputPayload) => {
    const { prompt: promptText, images, referencedFiles } = normalizeInputPayload(inputPayload);

    if (!promptText.trim() && images.length === 0) return false;

    // A1: Check WebSocket ready state (isOpen) before sending
    if (!wsRef.current || !wsRef.current.isOpen || !wsRef.current.isOpen()) {
      showToast('⚠️ 无法发送消息：当前与服务端的 WebSocket 连接尚未就绪，请稍候重试。', 'warning');
      return false;
    }

    // R1: Do not send 'mode: chat' or 'effort' (preserve standard turn contract)
    const payload = {
      action: 'turn',
      prompt: promptText,
      images,
      referencedFiles,
      threadId: currentThread,
    };

    const sent = wsRef.current.send(payload);
    if (!sent) {
      showToast('⚠️ 消息发送失败：底层连接异常断开。', 'error');
      return false;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        role: 'user',
        text: promptText,
        images,
        referencedFiles,
        thinking: '',
        tools: [],
        blocks: [{ type: 'text', content: promptText }],
      },
    ]);
    return true;
  };

  const handleQueueMessage = (inputPayload) => {
    const normalized = normalizeInputPayload(inputPayload);
    if (!normalized.prompt.trim() && normalized.images.length === 0) return;

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
    setPendingMessages((prev) => prev.map((item) => (
      item.id === messageId ? { ...item, prompt } : item
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
    if (!handleSendMessage(nextMessage)) {
      queueDispatchingRef.current = false;
      setPendingMessages((prev) => [nextMessage, ...prev]);
    }
  }, [isGenerating, pendingMessages]);

  const handleClearChat = () => {
    if (isGenerating) {
      handleInterrupt('clear-chat');
    }
    setMessages([]);
    showToast('已清空当前会话界面消息', 'info', 1800);
  };

  const handleOpenStatus = () => {
    setSidePanelTab('world');
    setSidePanelOpen(true);
  };

  const handleCopyLastResponse = async () => {
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    if (assistantMessages.length === 0) {
      showToast('当前会话暂无模型回复可复制', 'warning');
      return;
    }
    const lastMsg = assistantMessages[assistantMessages.length - 1];
    let fullText = lastMsg.text || '';
    if (!fullText && lastMsg.blocks) {
      fullText = lastMsg.blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.content)
        .join('\n\n');
    }
    if (!fullText) {
      showToast('当前模型回复暂无文本内容', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(fullText);
      showToast(`✓ 已复制模型最新回复 (${fullText.length} 字符, Markdown) 到系统剪贴板！`, 'success');
    } catch (err) {
      console.warn('Clipboard write failed:', err);
      showToast('复制到剪贴板失败，请手动选择复制', 'error');
    }
  };

  const handleSteerMessage = (text, source = 'direct-steer') => {
    const { prompt: promptText, images, referencedFiles } = normalizeInputPayload(text);
    if (!promptText.trim() && images.length === 0) return;

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
        referencedFiles,
        thinking: '',
        tools: [],
        blocks: [{ type: 'text', content: promptText }],
      },
    ]);

    // 2. Transmit steer action over WebSocket
    if (wsRef.current) {
      const payload = {
        action: 'steer',
        turnId: activeTurnId,
        text: promptText,
        threadId: currentThread,
        source,
      };
      const sent = wsRef.current.send(payload);
      console.info('[Studio][turn-control]', {
        action: 'steer',
        source,
        threadId: currentThread,
        turnId: activeTurnId,
        sent,
        hasAttachments: images.length > 0,
      });
      showToast('已发送实时纠偏指令 (Steer)', 'info', 2000);
    }
  };

  const handleInterrupt = (source = 'composer-stop') => {
    const turnId = activeTurnId;
    interruptPendingRef.current = true;
    setIsGenerating(false);
    let sent = false;
    if (wsRef.current) {
      sent = wsRef.current.send({
        action: 'interrupt',
        turnId,
        threadId: currentThread,
        source,
      });
    }
    console.info('[Studio][turn-control]', {
      action: 'interrupt',
      source,
      threadId: currentThread,
      turnId,
      sent,
    });
    setActiveTurnId(null);
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

  const handleRespondApproval = async (requestId, decision, reason = '', requestedScope = 'once') => {
    const approval = pendingApproval?.data || {};
    const allowedScopes = approval.allowedGrantScopes || [];
    const selectedScope = allowedScopes.includes(requestedScope)
      ? requestedScope
      : decision === 'approve' ? allowedScopes[0] : null;
    if (wsRef.current) {
      wsRef.current.send({
        action: 'approval_response',
        requestId,
        decision,
        reason,
        grantScope: decision === 'approve' ? selectedScope : null,
      });
    } else {
      await api.respondApproval(requestId, decision, decision === 'approve' ? selectedScope : null, reason);
    }
    setPendingApproval(null);
    showToast(`已提交安全审批决定: ${decision === 'approve' ? '允许执行' : '拒绝'}`, 'info', 2000);
  };

  const handleSelectThread = async (threadId, projectId = null) => {
    const selected = threads.find(
      (thread) =>
        thread.thread_id === threadId &&
        (!projectId || thread.project === projectId),
    );
    const nextProject = projectId || selected?.project || null;
    if (
      threadId === currentThread &&
      (!nextProject || !currentThreadProject || nextProject === currentThreadProject)
    ) return;
    setIsGenerating(false);
    setActiveTurnId(null);
    interruptPendingRef.current = false;
    setPendingApproval(null);
    setPendingMessages([]);
    setComposerDraft(null);
    setLastTurnResult(null);
    setRuntimeStatus(null);
    setLastWorkflowEvent(null);
    currentThreadRef.current = threadId;
    currentThreadProjectRef.current = nextProject;
    setCurrentThread(threadId);
    setCurrentThreadProject(nextProject);
    if (selected) {
      setCurrentThreadMeta({
        title: selected.title || threadId,
        summary: selected.summary || '',
      });
    }
    try {
      // Attach first. All project-agnostic thread APIs use this active
      // project context after the attach completes.
      const result = await api.attachThread(threadId, nextProject);
      if (!result.attached && result.session_status === 'locked') {
        showToast('该 Session 正在另一个进程运行，当前为只读查看；结束后可重新 attach', 'info', 3500);
      }
      loadThreadHistory(threadId, nextProject);
      loadWorkflows(threadId, nextProject);
      loadRuntimeStatus(threadId, nextProject);
    } catch (err) {
      showToast(`切换 Session 失败: ${err.message}`, 'error');
    }
  };

  const handleNewThread = async (customProject = null, customTitle = null) => {
    const tid = `t-${Date.now().toString(36)}`;
    const finalTitle =
      customTitle && customTitle.trim() ? customTitle.trim() : `新会话 ${tid}`;
    try {
      const result = await api.startThread(tid, finalTitle, customProject);
      const nextProject = result.project || customProject || null;
      await loadThreads();
      currentThreadRef.current = tid;
      currentThreadProjectRef.current = nextProject;
      setCurrentThread(tid);
      setCurrentThreadProject(nextProject);
      setCurrentThreadMeta({ title: finalTitle, summary: '' });
      setMessages([]);
      setPendingMessages([]);
      setComposerDraft(null);
      interruptPendingRef.current = false;
      setLastTurnResult(null);
      showToast(`已创建新会话: ${finalTitle}`, 'success');
    } catch (err) {
      showToast(`创建新会话失败: ${err.message}`, 'error');
    }
  };

  const handleForkThread = async (sourceThreadId) => {
    const newId = `${sourceThreadId}_fork_${Date.now().toString(36).slice(2, 6)}`;
    try {
      const source = threads.find(
        (thread) =>
          thread.thread_id === sourceThreadId &&
          (!currentThreadProjectRef.current ||
            thread.project === currentThreadProjectRef.current),
      );
      const result = await api.forkThread(
        sourceThreadId,
        newId,
        null,
        source?.project || currentThreadProjectRef.current || null,
      );
      const nextProject = result.project || source?.project || null;
      await loadThreads();
      currentThreadRef.current = newId;
      currentThreadProjectRef.current = nextProject;
      setCurrentThread(newId);
      setCurrentThreadProject(nextProject);
      setPendingMessages([]);
      setComposerDraft(null);
      interruptPendingRef.current = false;
      setLastTurnResult(null);
      loadThreadHistory(newId, nextProject);
      showToast(`已派生分支会话: ${newId}`, 'success');
    } catch (err) {
      showToast(`派生分支失败: ${err.message}`, 'error');
    }
  };

  const handleCloseThread = async (threadId) => {
    try {
      await api.closeThread(threadId);
      await loadThreads();
      if (currentThread === threadId) {
        currentThreadRef.current = 'default';
        currentThreadProjectRef.current = null;
        setCurrentThread('default');
        setCurrentThreadProject(null);
        loadThreadHistory('default');
      }
      showToast(`已关闭并归档会话: ${threadId}`, 'info');
    } catch (err) {
      showToast(`关闭会话失败: ${err.message}`, 'error');
    }
  };

  const handleRenameThread = async (threadId, newTitle) => {
    try {
      const targetId = typeof threadId === 'string' ? threadId : currentThread;
      await api.renameThread(targetId, newTitle);
      if (targetId === currentThread) {
        setCurrentThreadMeta((prev) => ({ ...prev, title: newTitle }));
      }
      loadThreads();
      showToast(`已重命名会话为: ${newTitle}`, 'success');
    } catch (err) {
      showToast(`重命名失败: ${err.message}`, 'error');
    }
  };

  const handleUpdateSummary = async (threadId, newSummary) => {
    try {
      const targetId = typeof threadId === 'string' ? threadId : currentThread;
      await api.updateThreadSummary(targetId, newSummary);
      if (targetId === currentThread) {
        setCurrentThreadMeta((prev) => ({ ...prev, summary: newSummary }));
      }
      loadThreads();
      showToast('已更新阶段摘要', 'success');
    } catch (err) {
      showToast(`设置摘要失败: ${err.message}`, 'error');
    }
  };

  const handleTogglePlan = async () => {
    const nextState = !planActive;
    try {
      const res = await api.setCollaborationMode(nextState ? 'plan' : 'default', currentThread);
      applyWorkflowState(currentThread, res);
      const active = (res.collaboration_mode || res.collaborationMode)?.mode === 'plan';
      showToast(`Plan Mode 已${active ? '开启 (只读规划)' : '关闭'}`, 'info');
    } catch (err) {
      showToast(`切换 Plan Mode 失败: ${err.message}`, 'error');
    }
  };

  const handleStartGoal = async (objective) => {
    try {
      const result = await api.setGoal(objective, null, 'active', currentThread);
      const goal = result.goal || result;
      applyGoalState(currentThread, goal, result);
      showToast('Goal 已启动，并会在当前任务顶部持续显示', 'success');
    } catch (err) {
      showToast(`启动 Goal 失败: ${err.message}`, 'error');
    }
  };

  const handlePauseGoal = async () => {
    try {
      const result = await api.pauseGoal(currentThread);
      applyGoalState(currentThread, result.goal, result);
      if (isGenerating) handleInterrupt('goal-pause');
      showToast('Goal 已暂停，可随时恢复', 'info');
    } catch (err) {
      showToast(`暂停 Goal 失败: ${err.message}`, 'error');
    }
  };

  const handleResumeGoal = async () => {
    try {
      const result = await api.resumeGoal(currentThread);
      applyGoalState(currentThread, result.goal, result);
      showToast('Goal 已恢复，运行时将继续推进', 'success');
    } catch (err) {
      showToast(`恢复 Goal 失败: ${err.message}`, 'error');
    }
  };

  const handleUpdateGoal = async () => {
    if (!goalState) return;
    const objective = window.prompt('更新当前 Thread Goal', goalState.objective);
    if (!objective || objective.trim() === goalState.objective.trim()) return;
    try {
      const result = await api.updateGoal(objective.trim(), goalState.token_budget, currentThread);
      const goal = result.goal || null;
      applyGoalState(currentThread, goal, result);
      showToast('Goal 目标已更新', 'success');
    } catch (err) {
      showToast(`更新 Goal 失败: ${err.message}`, 'error');
    }
  };

  const handleClearGoal = async () => {
    try {
      const result = await api.clearGoal(currentThread);
      applyGoalState(currentThread, null, result);
      showToast('Goal 已删除，Session 历史仍然保留', 'info');
    } catch (err) {
      showToast(`删除 Goal 失败: ${err.message}`, 'error');
    }
  };

  const handleOpenSidePanel = (tab = 'world') => {
    setSidePanelTab(tab);
    setSidePanelOpen(true);
  };

  const handleUpdateExecution = async (nextAccess, nextPolicy) => {
    try {
      await api.setWorldExecution(nextAccess, nextPolicy);
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
    try {
      const res = await api.updateThreadSettings(
        planActive ? 'plan' : 'default',
        null,
        currentThread,
        nextMode,
      );
      applyWorkflowState(currentThread, res);
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
    try {
      await api.setWorldExecution(accessScope, 'trusted');
      const res = await api.updateThreadSettings(
        planActive ? 'plan' : 'default',
        null,
        currentThread,
        'continuous',
      );
      setPolicy('trusted');
      setUserSettings((prev) => ({ ...prev, policy: 'trusted' }));
      applyWorkflowState(currentThread, res);
      showToast('Auto Copilot 已显式开启：连续执行 + 信任执行，高风险仍需确认', 'success');
    } catch (err) {
      showToast(`开启 Auto Copilot 失败: ${err.message}`, 'error');
    }
  };

  return (
    <div className="app-container">
      <Header
        currentThread={currentThread}
        threadTitle={currentThreadMeta.title}
        threadSummary={currentThreadMeta.summary}
        isConnected={isConnected}
        onOpenSidePanel={handleOpenSidePanel}
        onOpenSettings={() => setSettingsModalOpen(true)}
        onRenameThread={(title) => handleRenameThread(currentThread, title)}
        onUpdateSummary={(summary) => handleUpdateSummary(currentThread, summary)}
      />

      <div className="app-main-layout">
        <Sidebar
          threads={threads}
          currentThread={currentThread}
          currentThreadProject={currentThreadProject}
          isGenerating={isGenerating}
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
          onForkThread={handleForkThread}
          onCloseThread={handleCloseThread}
          onRenameThread={handleRenameThread}
          onUpdateSummary={handleUpdateSummary}
          onRefreshThreads={loadThreads}
          onToast={showToast}
        />

        <main className="app-content">
          {goalState && (
            <div className="goal-topbar" role="status">
              <div className="goal-topbar-main">
                {planActive && <span className="goal-topbar-mode">PLAN</span>}
                <span className="goal-topbar-label">GOAL</span>
                <span className={`goal-topbar-status ${goalState.status}`}>{goalState.status}</span>
                {goalState.verification_status && goalState.verification_status !== 'idle' && (
                  <span className={`goal-topbar-verification ${goalState.verification_status}`}>
                    VERIFY {goalState.verification_status}
                  </span>
                )}
                <span className="goal-topbar-objective" title={goalState.objective}>{goalState.objective}</span>
              </div>
              <div className="goal-topbar-actions">
                <button type="button" onClick={() => handleOpenSidePanel('plan_goal')}>详情</button>
                {goalState.status === 'paused' ? (
                  <button type="button" onClick={handleResumeGoal}>恢复</button>
                ) : goalState.status === 'active' ? (
                  <button type="button" onClick={handlePauseGoal}>暂停</button>
                ) : null}
                <button type="button" onClick={handleUpdateGoal}>更新</button>
                <button type="button" className="danger" onClick={handleClearGoal}>删除</button>
              </div>
            </div>
          )}
          {runtimeStatus && runtimeStatus.phase !== 'idle' && (
            <div className={`runtime-status-bar ${runtimeStatus.phase}`} role="status">
              <span className="runtime-status-label">RUNTIME</span>
              <span>{RUNTIME_PHASE_LABELS[runtimeStatus.phase] || runtimeStatus.phase}</span>
              {runtimeStatus.turnId && (
                <span className="runtime-status-meta">turn {runtimeStatus.turnId}</span>
              )}
              {runtimeStatus.checkpointSeq !== null && runtimeStatus.checkpointSeq !== undefined && (
                <span className="runtime-status-meta">checkpoint #{runtimeStatus.checkpointSeq}</span>
              )}
              {runtimeStatus.operationId && (
                <span className="runtime-status-operation" title={runtimeStatus.operationId}>
                  {runtimeStatus.operationId}
                </span>
              )}
              {lastWorkflowEvent?.method && (
                <span className="runtime-status-event">{lastWorkflowEvent.method}</span>
              )}
              {runtimeStatus.error && (
                <span className="runtime-status-error" title={runtimeStatus.error}>⚠ {runtimeStatus.error}</span>
              )}
            </div>
          )}
          <ErrorBoundary title="对话区域渲染异常 (Chat Area Render Error)">
            <ChatArea
              messages={messages}
              isGenerating={isGenerating}
              pendingApproval={pendingApproval}
              lastTurnResult={lastTurnResult}
              policy={policy}
              onQuickPrompt={handleSendMessage}
              onRetryPrompt={handleSendMessage}
              autoScroll={userSettings.auto_scroll}
              wordWrap={userSettings.word_wrap}
              fontSize={userSettings.font_size}
              isLoadingHistory={isLoadingHistory}
            />
          </ErrorBoundary>

          <InputBar
            isGenerating={isGenerating}
            accessScope={accessScope}
            policy={policy}
            continuationMode={continuationMode}
            goalState={goalState}
            pendingApproval={pendingApproval}
            onRespondApproval={handleRespondApproval}
            onChangeExecution={handleUpdateExecution}
            onChangeContinuation={handleUpdateContinuation}
            onEnableAutoCopilot={handleEnableAutoCopilot}
            onStartGoal={handleStartGoal}
            onSendMessage={handleSendMessage}
            onQueueMessage={handleQueueMessage}
            onSteerMessage={handleSteerMessage}
            pendingMessages={pendingMessages}
            onSteerQueuedMessage={handleSteerQueuedMessage}
            onEditQueuedMessage={handleEditQueuedMessage}
            onUpdateQueuedMessage={handleUpdateQueuedMessage}
            onRemoveQueuedMessage={handleRemoveQueuedMessage}
            composerDraft={composerDraft}
            onComposerDraftApplied={() => setComposerDraft(null)}
            onInterrupt={handleInterrupt}
            onClearChat={handleClearChat}
            onOpenStatus={handleOpenStatus}
            onCopyLastResponse={handleCopyLastResponse}
            onTogglePlanMode={handleTogglePlan}
            onToast={showToast}
          />
        </main>
      </div>

      {/* Multi-Tab Side Panel */}
      <ErrorBoundary title="侧边栏渲染异常 (Side Panel Render Error)">
        <SidePanel
          isOpen={sidePanelOpen}
          initialTab={sidePanelTab}
          onClose={() => setSidePanelOpen(false)}
          planActive={planActive}
          goalState={goalState}
          threadId={currentThread}
          onGoalChanged={(goal, payload) => applyGoalState(currentThread, goal, payload)}
          onTogglePlan={handleTogglePlan}
          onToast={showToast}
        />
      </ErrorBoundary>

      {/* System Settings Modal */}
      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        onToast={showToast}
        onSettingsSaved={(newSettings) => {
          if (newSettings.theme) {
            document.body.className = `theme-${newSettings.theme}`;
          }
          showToast('偏好设置已保存并生效', 'success', 2000);
        }}
      />

      {/* Toast Notification Container */}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
