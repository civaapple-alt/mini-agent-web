import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import InputBar from './components/InputBar';
import SidePanel from './components/SidePanel';
import SettingsModal from './components/SettingsModal';
import { api, createAgentWebSocket } from './api';
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

  // Workflow & Environment
  const [planActive, setPlanActive] = useState(false);
  const [goalState, setGoalState] = useState(null);
  const [approvalPolicy, setApprovalPolicy] = useState('per_action');

  // Panels & Modals
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState('world');
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef(null);
  const currentThreadRef = useRef(currentThread);
  currentThreadRef.current = currentThread;

  // ---------------------------------------------------------------------------
  // Lifecycle & Initial Fetch
  // ---------------------------------------------------------------------------

  useEffect(() => {
    loadSettings();
    loadThreads();
    loadWorkflows();
    loadThreadHistory('default');

    // Establish WebSocket Connection
    const wsClient = createAgentWebSocket(
      handleServerEvent,
      () => setIsConnected(true),
      () => setIsConnected(false)
    );
    wsRef.current = wsClient;

    return () => {
      wsClient.close();
    };
  }, []);

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      if (data.approval_policy) setApprovalPolicy(data.approval_policy);
      if (data.theme) document.body.className = `theme-${data.theme}`;
    } catch (err) {
      console.error('Failed to load settings:', err);
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

  const loadWorkflows = async () => {
    try {
      const wfState = await api.getWorkflowState();
      setPlanActive(Boolean(wfState.plan_active));
      setGoalState(wfState.goal || null);
    } catch (err) {
      console.error('Failed to load workflow state:', err);
    }
  };

  const loadThreadHistory = async (threadId) => {
    try {
      const cp = await api.readThread(threadId);
      if (cp.metadata) {
        setCurrentThreadMeta({
          title: cp.metadata.title || threadId,
          summary: cp.metadata.summary || '',
        });
      }
      const rawMessages = cp.messages || [];
      const formatted = rawMessages
        .filter((m) => {
          if (m.role === 'system') return false;
          const text = (m.text || '').trim();
          if (text.startsWith('<world_state') || text.includes('</world_state>')) return false;
          return true;
        })
        .map((m) => ({
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
      setMessages(formatted);
    } catch (err) {
      console.error(`Failed to load thread ${threadId}:`, err);
      setMessages([]);
    }
  };

  // ---------------------------------------------------------------------------
  // WebSocket Message / Event Dispatcher
  // ---------------------------------------------------------------------------

  const handleServerEvent = (data) => {
    if (!data) return;

    // 1. Correlated Action Responses
    if (data.type === 'response') {
      if (data.action === 'turn') {
        setActiveTurnId(data.turnId);
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

    // 3. Engine Typed Events
    if (data.type === 'event') {
      const evt = data.event || {};
      const type = evt.type;

      if (type === 'turn_started') {
        setIsGenerating(true);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: '', thinking: '', tools: [], blocks: [] },
        ]);
      } else if (type === 'assistant_reasoning_delta') {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const copy = [...prev];
          const last = { ...copy[copy.length - 1] };
          const blocks = [...(last.blocks || [])];

          const lastBlock = blocks[blocks.length - 1];
          if (!lastBlock || lastBlock.type !== 'thinking') {
            blocks.push({
              type: 'thinking',
              content: evt.delta || '',
              isStreaming: true,
            });
          } else {
            blocks[blocks.length - 1] = {
              ...lastBlock,
              content: (lastBlock.content || '') + (evt.delta || ''),
              isStreaming: true,
            };
          }

          last.blocks = blocks;
          last.thinking = (last.thinking || '') + (evt.delta || '');
          copy[copy.length - 1] = last;
          return copy;
        });
      } else if (type === 'assistant_text_delta') {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const copy = [...prev];
          const last = { ...copy[copy.length - 1] };
          const blocks = [...(last.blocks || [])];

          // Mark previous thinking blocks as completed
          for (let i = 0; i < blocks.length; i++) {
            if (blocks[i].type === 'thinking') {
              blocks[i] = { ...blocks[i], isStreaming: false };
            }
          }

          const lastBlock = blocks[blocks.length - 1];
          if (!lastBlock || lastBlock.type !== 'text') {
            blocks.push({
              type: 'text',
              content: evt.delta || '',
            });
          } else {
            blocks[blocks.length - 1] = {
              ...lastBlock,
              content: (lastBlock.content || '') + (evt.delta || ''),
            };
          }

          last.blocks = blocks;
          last.text = (last.text || '') + (evt.delta || '');
          copy[copy.length - 1] = last;
          return copy;
        });
      } else if (type === 'tool_started') {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const copy = [...prev];
          const last = { ...copy[copy.length - 1] };
          const blocks = [...(last.blocks || [])];

          for (let i = 0; i < blocks.length; i++) {
            if (blocks[i].type === 'thinking') {
              blocks[i] = { ...blocks[i], isStreaming: false };
            }
          }

          const call = evt.call || {};
          const callId =
            evt.call_id ||
            evt.callId ||
            call.id ||
            call.call_id ||
            evt.id ||
            `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const name = evt.name || evt.tool || call.name || 'tool';
          const args = evt.arguments !== undefined ? evt.arguments : call.arguments;

          const toolBlock = {
            type: 'tool',
            id: callId,
            name,
            arguments: args,
            status: 'running',
            output: null,
            error: null,
          };

          blocks.push(toolBlock);
          last.blocks = blocks;
          last.tools = [...(last.tools || []), toolBlock];
          copy[copy.length - 1] = last;
          return copy;
        });
      } else if (type === 'tool_finished') {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const copy = [...prev];
          const last = { ...copy[copy.length - 1] };
          const blocks = [...(last.blocks || [])];

          const callId = evt.call_id || evt.callId || evt.id;
          const content =
            evt.content !== undefined
              ? evt.content
              : evt.output !== undefined
              ? evt.output
              : evt.result;
          const isError = Boolean(evt.is_error || evt.isError || evt.error);

          last.blocks = blocks.map((b) => {
            if (
              b.type === 'tool' &&
              (b.id === callId || (!callId && b.status === 'running'))
            ) {
              return {
                ...b,
                status: isError ? 'failed' : 'completed',
                output: content,
                error: isError ? evt.error || content : null,
              };
            }
            return b;
          });

          last.tools = (last.tools || []).map((t) => {
            if (t.id === callId || (!callId && t.status === 'running')) {
              return {
                ...t,
                status: isError ? 'failed' : 'completed',
                output: content,
                error: isError ? evt.error || content : null,
              };
            }
            return t;
          });

          copy[copy.length - 1] = last;
          return copy;
        });
      } else if (type === 'turn_finished' || type === 'run_failed') {
        setIsGenerating(false);
        setActiveTurnId(null);
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const copy = [...prev];
          const last = { ...copy[copy.length - 1] };
          if (last.blocks) {
            last.blocks = last.blocks.map((b) => {
              if (b.type === 'thinking') return { ...b, isStreaming: false };
              if (b.type === 'tool' && b.status === 'running')
                return { ...b, status: 'completed' };
              return b;
            });
          }
          copy[copy.length - 1] = last;
          return copy;
        });
        loadThreads();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------

  const handleSendMessage = (prompt) => {
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: prompt, thinking: '', tools: [], blocks: [{ type: 'text', content: prompt }] },
    ]);

    if (wsRef.current) {
      wsRef.current.send({
        action: 'turn',
        prompt,
        threadId: currentThread,
      });
    }
  };

  const handleSteerMessage = (text) => {
    if (!activeTurnId) return;
    if (wsRef.current) {
      wsRef.current.send({
        action: 'steer',
        turnId: activeTurnId,
        text,
        threadId: currentThread,
      });
    }
  };

  const handleInterrupt = () => {
    if (!activeTurnId) return;
    if (wsRef.current) {
      wsRef.current.send({
        action: 'interrupt',
        turnId: activeTurnId,
        threadId: currentThread,
      });
    }
  };

  const handleRespondApproval = async (requestId, decision, reason = '', remember = false) => {
    if (wsRef.current) {
      wsRef.current.send({
        action: 'approval_response',
        requestId,
        decision,
        reason,
        remember,
      });
    } else {
      await api.respondApproval(requestId, decision, reason, remember);
    }
    setPendingApproval(null);
  };

  const handleSelectThread = (threadId) => {
    if (threadId === currentThread) return;
    setCurrentThread(threadId);
    loadThreadHistory(threadId);
  };

  const handleNewThread = async () => {
    const tid = `thread_${Date.now().toString(36)}`;
    try {
      await api.startThread(tid, `新会话 ${tid}`);
      await loadThreads();
      setCurrentThread(tid);
      setCurrentThreadMeta({ title: `新会话 ${tid}`, summary: '' });
      setMessages([]);
    } catch (err) {
      alert(`创建新会话失败: ${err.message}`);
    }
  };

  const handleForkThread = async (sourceThreadId) => {
    const newId = `${sourceThreadId}_fork_${Date.now().toString(36).slice(2, 6)}`;
    try {
      await api.forkThread(sourceThreadId, newId);
      await loadThreads();
      setCurrentThread(newId);
      loadThreadHistory(newId);
    } catch (err) {
      alert(`派生分支失败: ${err.message}`);
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
    } catch (err) {
      alert(`关闭会话失败: ${err.message}`);
    }
  };

  const handleRenameThread = async (threadId, newTitle) => {
    try {
      const targetId = typeof threadId === 'string' ? threadId : currentThread;
      const res = await api.renameThread(targetId, newTitle);
      if (targetId === currentThread) {
        setCurrentThreadMeta((prev) => ({ ...prev, title: newTitle }));
      }
      loadThreads();
    } catch (err) {
      alert(`重命名失败: ${err.message}`);
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
    } catch (err) {
      alert(`设置摘要失败: ${err.message}`);
    }
  };

  const handleTogglePlan = async () => {
    const nextState = !planActive;
    try {
      const res = await api.setPlanMode(nextState);
      setPlanActive(Boolean(res.plan_active));
    } catch (err) {
      alert(`切换 Plan Mode 失败: ${err.message}`);
    }
  };

  const handleOpenSidePanel = (tab = 'world') => {
    setSidePanelTab(tab);
    setSidePanelOpen(true);
  };

  const handleUpdateApprovalPolicy = async (newPolicy) => {
    setApprovalPolicy(newPolicy);
    try {
      await api.updateSettings({ approval_policy: newPolicy });
    } catch (err) {
      console.error('Failed to update approval policy:', err);
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
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
          onForkThread={handleForkThread}
          onCloseThread={handleCloseThread}
          onRenameThread={handleRenameThread}
          onUpdateSummary={handleUpdateSummary}
          onRefreshThreads={loadThreads}
        />

        <main className="app-content">
          <ChatArea
            messages={messages}
            isGenerating={isGenerating}
            pendingApproval={pendingApproval}
            onRespondApproval={handleRespondApproval}
            onQuickPrompt={handleSendMessage}
            onRetryPrompt={handleSendMessage}
          />

          <InputBar
            isGenerating={isGenerating}
            planActive={planActive}
            goalState={goalState}
            approvalPolicy={approvalPolicy}
            pendingApproval={pendingApproval}
            onRespondApproval={handleRespondApproval}
            onChangeApprovalPolicy={handleUpdateApprovalPolicy}
            onSendMessage={handleSendMessage}
            onSteerMessage={handleSteerMessage}
            onInterrupt={handleInterrupt}
            onTogglePlan={handleTogglePlan}
            onOpenSidePanel={handleOpenSidePanel}
          />
        </main>
      </div>

      {/* Multi-Tab Side Panel */}
      <SidePanel
        isOpen={sidePanelOpen}
        initialTab={sidePanelTab}
        onClose={() => setSidePanelOpen(false)}
        planActive={planActive}
        onTogglePlan={handleTogglePlan}
      />

      {/* System Settings Modal */}
      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        onSettingsSaved={(newSettings) => {
          if (newSettings.theme) {
            document.body.className = `theme-${newSettings.theme}`;
          }
          if (newSettings.approval_policy) {
            setApprovalPolicy(newSettings.approval_policy);
          }
        }}
      />
    </div>
  );
}
