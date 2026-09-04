import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import InputBar from './components/InputBar';
import SidePanel from './components/SidePanel';
import SettingsModal from './components/SettingsModal';
import Toast from './components/Toast';
import { api, createAgentWebSocket } from './api';
import {
  shouldAcceptEventForThread,
  aggregateItemLifecycle,
  aggregateStreamEvent,
  aggregateThreadItems,
} from './utils/messageState';
import './App.css';

export default function App() {
  const [threads, setThreads] = useState([]);
  const [currentThread, setCurrentThread] = useState('default');
  const [currentThreadMeta, setCurrentThreadMeta] = useState({
    title: '默认会话 (Default Session)',
    summary: '',
  });
  const [messages, setMessages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [toasts, setToasts] = useState([]);

  // Workflow & Environment
  const [planActive, setPlanActive] = useState(false);
  const [goalState, setGoalState] = useState(null);
  const [accessScope, setAccessScope] = useState('project');
  const [approvalMode, setApprovalMode] = useState('per_action');
  const [userSettings, setUserSettings] = useState({
    access: 'project',
    approval: 'per_action',
    default_mode: 'chat',
    reasoning_effort: 'medium',
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
  const currentThreadRef = useRef(currentThread);
  currentThreadRef.current = currentThread;

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
    loadThreads();
    loadWorkflows('default');
    loadThreadHistory('default');

    // Establish WebSocket Connection
    const wsClient = createAgentWebSocket(
      handleServerEvent,
      () => {
        setIsConnected(true);
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
      if (data.approval) setApprovalMode(data.approval);
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
      if (data.threads && data.threads.length > 0) {
        setThreads(data.threads);
        const cur = data.threads.find((t) => t.thread_id === currentThreadRef.current);
        if (cur) {
          setCurrentThreadMeta({
            title: cur.title || cur.thread_id,
            summary: cur.summary || '',
          });
        }
      }
    } catch (err) {
      console.error('Failed to load threads:', err);
    }
  };

  const loadWorkflows = async (threadId = currentThreadRef.current) => {
    try {
      const wfState = await api.getWorkflowState(threadId);
      setPlanActive(wfState.collaboration_mode?.mode === 'plan');
      setGoalState(wfState.goal || null);
    } catch (err) {
      console.error('Failed to load workflow state:', err);
    }
  };

  const loadThreadHistory = async (threadId) => {
    setIsLoadingHistory(true);
    try {
      const [cp, itemPage] = await Promise.all([
        api.readThread(threadId),
        api.listThreadItems(threadId, { limit: 128 }),
      ]);
      if (cp.metadata) {
        setCurrentThreadMeta({
          title: cp.metadata.title || threadId,
          summary: cp.metadata.summary || '',
        });
      }
      if (cp.session) {
        setPlanActive(Boolean(cp.session.plan_active));
        setGoalState(cp.session.goal || null);
      }
      const rawMessages = cp.messages || [];
      const formatted = rawMessages
        .filter((m) => {
          if (m.role === 'system') return false;
          const text = (m.text || '').trim();
          if (text.startsWith('<world_state') || text.includes('</world_state>')) return false;
          return true;
        })
        .map((m, idx) => ({
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
        }));
      setMessages(aggregateThreadItems(formatted, itemPage.data || []));
    } catch (err) {
      console.error(`Failed to load thread ${threadId}:`, err);
      showToast(`加载会话历史失败: ${err.message}`, 'error');
      setMessages([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // ---------------------------------------------------------------------------
  // WebSocket Message / Event Dispatcher
  // ---------------------------------------------------------------------------

  const handleServerEvent = (data) => {
    if (!data) return;

    // A2: Isolate stream events by active thread to prevent cross-thread pollution
    if (!shouldAcceptEventForThread(data, currentThreadRef.current)) {
      if (data.type === 'event') {
        const evtType = data.event?.type;
        if (evtType === 'turn_finished' || evtType === 'run_failed') {
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
      }
      return;
    }

    if (data.type === 'interrupt_ack') {
      setIsGenerating(false);
      setActiveTurnId(null);
      return;
    }

    if (data.type === 'steer_ack') {
      showToast('✓ 纠偏指令已下发，模型正在安全结算转向...', 'info', 2000);
      return;
    }

    if (data.type === 'error') {
      showToast(`⚠️ ${data.message || '操作异常'}`, 'error', 4000);
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
      if (data.method === 'item/started' || data.method === 'item/completed') {
        setMessages((prev) => aggregateItemLifecycle(prev, data));
      } else if (data.method === 'thread/settings/updated') {
        setPlanActive(notification.collaborationMode?.mode === 'plan');
      } else if (data.method === 'thread/goal/updated') {
        setGoalState(notification.goal || null);
      } else if (data.method === 'thread/goal/cleared') {
        setGoalState(null);
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
        setIsGenerating(true);
      } else if (
        evt.type === 'turn_finished' ||
        evt.type === 'run_finished' ||
        evt.type === 'run_failed'
      ) {
        if (evt.type === 'turn_finished' && evt.stop_reason === 'steered') {
          showToast('✓ 纠偏已生效，正在应用新指令继续生成...', 'info', 2500);
        } else {
          setIsGenerating(false);
          setActiveTurnId(null);
          loadThreads();
        }
      }
      setMessages((prev) => aggregateStreamEvent(prev, data));
    }
  };

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------

  const handleSendMessage = (inputPayload) => {
    let promptText = '';
    let images = [];
    let referencedFiles = [];

    if (typeof inputPayload === 'string') {
      promptText = inputPayload;
    } else if (typeof inputPayload === 'object' && inputPayload !== null) {
      promptText = inputPayload.prompt || '';
      images = inputPayload.images || [];
      referencedFiles = inputPayload.referencedFiles || [];
    }

    if (!promptText.trim() && images.length === 0) return;

    // A1: Check WebSocket ready state (isOpen) before sending
    if (!wsRef.current || !wsRef.current.isOpen || !wsRef.current.isOpen()) {
      showToast('⚠️ 无法发送消息：当前与服务端的 WebSocket 连接尚未就绪，请稍候重试。', 'warning');
      return;
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
      return;
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
  };

  const handleClearChat = () => {
    if (isGenerating) {
      handleInterrupt();
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

  const handleSteerMessage = (text) => {
    // 1. Render user's steer prompt in chat log immediately so it is clearly visible
    setMessages((prev) => [
      ...prev,
      {
        id: 'user_steer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        role: 'user',
        text,
        isSteer: true,
        images: [],
        referencedFiles: [],
        thinking: '',
        tools: [],
        blocks: [{ type: 'text', content: text }],
      },
    ]);

    // 2. Transmit steer action over WebSocket
    if (wsRef.current) {
      wsRef.current.send({
        action: 'steer',
        turnId: activeTurnId,
        text,
        threadId: currentThread,
      });
      showToast('已发送实时纠偏指令 (Steer)', 'info', 2000);
    }
  };

  const handleInterrupt = () => {
    setIsGenerating(false);
    if (wsRef.current) {
      wsRef.current.send({
        action: 'interrupt',
        turnId: activeTurnId,
        threadId: currentThread,
      });
    }
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

  const handleRespondApproval = async (requestId, decision, reason = '', requestedApproval = approvalMode) => {
    const approval = pendingApproval?.data || {};
    const selectedAccess = approval.access || accessScope;
    const selectedApproval = approval.allowedApprovalModes?.includes(requestedApproval)
      ? requestedApproval
      : approval.allowedApprovalModes?.[0] || approvalMode;
    if (wsRef.current) {
      wsRef.current.send({
        action: 'approval_response',
        requestId,
        decision,
        reason,
        access: selectedAccess,
        approval: selectedApproval,
      });
    } else {
      await api.respondApproval(requestId, decision, selectedAccess, selectedApproval, reason);
    }
    setPendingApproval(null);
    showToast(`已提交安全审批决定: ${decision === 'approve' ? '允许执行' : '拒绝'}`, 'info', 2000);
  };

  const handleSelectThread = (threadId) => {
    if (threadId === currentThread) return;
    const selected = threads.find((thread) => thread.thread_id === threadId);
    setIsGenerating(false);
    setActiveTurnId(null);
    setPendingApproval(null);
    setCurrentThread(threadId);
    if (selected) {
      setCurrentThreadMeta({
        title: selected.title || threadId,
        summary: selected.summary || '',
      });
    }
    loadThreadHistory(threadId);
    loadWorkflows(threadId);
    api.attachThread(threadId, selected?.project).then((result) => {
      if (!result.attached && result.session_status === 'locked') {
        showToast('该 Session 正在另一个进程运行，当前为只读查看；结束后可重新 attach', 'info', 3500);
      }
    }).catch((err) => {
      showToast(`切换 Session 失败: ${err.message}`, 'error');
    });
  };

  const handleNewThread = async (customProject = null, customTitle = null) => {
    const tid = `t-${Date.now().toString(36)}`;
    const finalTitle =
      customTitle && customTitle.trim() ? customTitle.trim() : `新会话 ${tid}`;
    try {
      await api.startThread(tid, finalTitle, customProject);
      await loadThreads();
      setCurrentThread(tid);
      setCurrentThreadMeta({ title: finalTitle, summary: '' });
      setMessages([]);
      showToast(`已创建新会话: ${finalTitle}`, 'success');
    } catch (err) {
      showToast(`创建新会话失败: ${err.message}`, 'error');
    }
  };

  const handleForkThread = async (sourceThreadId) => {
    const newId = `${sourceThreadId}_fork_${Date.now().toString(36).slice(2, 6)}`;
    try {
      await api.forkThread(sourceThreadId, newId);
      await loadThreads();
      setCurrentThread(newId);
      loadThreadHistory(newId);
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
        setCurrentThread('default');
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
      const active = res.collaboration_mode?.mode === 'plan';
      setPlanActive(active);
      showToast(`Plan Mode 已${active ? '开启 (只读规划)' : '关闭'}`, 'info');
    } catch (err) {
      showToast(`切换 Plan Mode 失败: ${err.message}`, 'error');
    }
  };

  const handleStartGoal = async (objective) => {
    try {
      const result = await api.setGoal(objective, null, 'active', currentThread);
      setGoalState(result.goal || result);
      showToast('Goal 已启动，并会在当前任务顶部持续显示', 'success');
    } catch (err) {
      showToast(`启动 Goal 失败: ${err.message}`, 'error');
    }
  };

  const handlePauseGoal = async () => {
    try {
      if (isGenerating) handleInterrupt();
      const result = await api.pauseGoal(currentThread);
      setGoalState(result.goal || null);
      showToast('Goal 已暂停，可随时恢复', 'info');
    } catch (err) {
      showToast(`暂停 Goal 失败: ${err.message}`, 'error');
    }
  };

  const handleResumeGoal = async () => {
    try {
      const result = await api.resumeGoal(currentThread);
      setGoalState(result.goal || null);
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
      setGoalState(result.goal || null);
      showToast('Goal 目标已更新', 'success');
    } catch (err) {
      showToast(`更新 Goal 失败: ${err.message}`, 'error');
    }
  };

  const handleClearGoal = async () => {
    try {
      await api.clearGoal(currentThread);
      setGoalState(null);
      showToast('Goal 已删除，Session 历史仍然保留', 'info');
    } catch (err) {
      showToast(`删除 Goal 失败: ${err.message}`, 'error');
    }
  };

  const handleOpenSidePanel = (tab = 'world') => {
    setSidePanelTab(tab);
    setSidePanelOpen(true);
  };

  const handleUpdateExecution = async (nextAccess, nextApproval) => {
    try {
      await api.setWorldExecution(nextAccess, nextApproval);
      setAccessScope(nextAccess);
      setApprovalMode(nextApproval);
      setUserSettings((prev) => ({
        ...prev,
        access: nextAccess,
        approval: nextApproval,
      }));
    } catch (err) {
      showToast(`更新执行范围失败: ${err.message}`, 'error');
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
      <ChatArea
            messages={messages}
            isGenerating={isGenerating}
            pendingApproval={pendingApproval}
        onRespondApproval={handleRespondApproval}
        approvalMode={approvalMode}
            onQuickPrompt={handleSendMessage}
            onRetryPrompt={handleSendMessage}
            autoScroll={userSettings.auto_scroll}
            wordWrap={userSettings.word_wrap}
            fontSize={userSettings.font_size}
            isLoadingHistory={isLoadingHistory}
          />

          <InputBar
            isGenerating={isGenerating}
            accessScope={accessScope}
            approvalMode={approvalMode}
            pendingApproval={pendingApproval}
            onRespondApproval={handleRespondApproval}
            onChangeExecution={handleUpdateExecution}
            onStartGoal={handleStartGoal}
            onSendMessage={handleSendMessage}
            onSteerMessage={handleSteerMessage}
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
      <SidePanel
        isOpen={sidePanelOpen}
        initialTab={sidePanelTab}
        onClose={() => setSidePanelOpen(false)}
        planActive={planActive}
        goalState={goalState}
        threadId={currentThread}
        onGoalChanged={setGoalState}
        onTogglePlan={handleTogglePlan}
        onToast={showToast}
      />

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
