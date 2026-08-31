import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import InputBar from './components/InputBar';
import ApprovalDialog from './components/ApprovalDialog';
import WorldDrawer from './components/WorldDrawer';
import { api, createAgentWebSocket } from './api';
import './App.css';

export default function App() {
  const [threads, setThreads] = useState(['default']);
  const [currentThread, setCurrentThread] = useState('default');
  const [messages, setMessages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(null);
  const [worldState, setWorldState] = useState(null);
  const [mcpStatus, setMcpStatus] = useState(null);
  const [planActive, setPlanActive] = useState(false);
  const [isWorldDrawerOpen, setIsWorldDrawerOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef(null);
  const currentThreadRef = useRef(currentThread);
  currentThreadRef.current = currentThread;

  // ---------------------------------------------------------------------------
  // Lifecycle & Initial Fetch
  // ---------------------------------------------------------------------------

  useEffect(() => {
    loadThreads();
    loadWorldAndWorkflows();
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

  const loadThreads = async () => {
    try {
      const data = await api.listThreads();
      if (data.threads && data.threads.length > 0) {
        setThreads(data.threads);
      }
    } catch (err) {
      console.error('Failed to load threads:', err);
    }
  };

  const loadWorldAndWorkflows = async () => {
    try {
      const [wState, mState, wfState] = await Promise.all([
        api.getWorldState(),
        api.getMcpStatus(),
        api.getWorkflowState(),
      ]);
      setWorldState(wState);
      setMcpStatus(mState);
      setPlanActive(!!wfState.plan_active);
    } catch (err) {
      console.error('Failed to load world/workflows:', err);
    }
  };

  const loadThreadHistory = async (threadId) => {
    try {
      const cp = await api.readThread(threadId);
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
        }));
      setMessages(formatted);
    } catch (err) {
      console.error(`Failed to load thread ${threadId}:`, err);
      setMessages([]);
    }
  };

  // ---------------------------------------------------------------------------
  // WebSocket Event Dispatcher
  // ---------------------------------------------------------------------------

  const handleServerEvent = (data) => {
    // 1. Approval Request
    if (data.type === 'approval_request') {
      setPendingApproval({
        requestId: data.requestId,
        data: data.data,
      });
      return;
    }

    // 2. Turn Submission ID
    if (data.type === '_turn_submission') {
      if (data.data?.turn_id) {
        setActiveTurnId(data.data.turn_id);
      }
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
          { role: 'assistant', text: '', thinking: '', tools: [] },
        ]);
      } else if (type === 'assistant_reasoning_delta') {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const copy = [...prev];
          const last = { ...copy[copy.length - 1] };
          last.thinking = (last.thinking || '') + (evt.delta || '');
          copy[copy.length - 1] = last;
          return copy;
        });
      } else if (type === 'assistant_text_delta') {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const copy = [...prev];
          const last = { ...copy[copy.length - 1] };
          last.text = (last.text || '') + (evt.delta || '');
          copy[copy.length - 1] = last;
          return copy;
        });
      } else if (type === 'tool_started') {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const copy = [...prev];
          const last = { ...copy[copy.length - 1] };
          const callId = evt.call_id || evt.id || `tool_${Date.now()}`;
          const newTool = {
            id: callId,
            name: evt.name || evt.tool || 'tool',
            status: 'running',
            arguments: evt.arguments,
            output: null,
          };
          last.tools = [...(last.tools || []), newTool];
          copy[copy.length - 1] = last;
          return copy;
        });
      } else if (type === 'tool_finished') {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const copy = [...prev];
          const last = { ...copy[copy.length - 1] };
          const callId = evt.call_id || evt.id;
          last.tools = (last.tools || []).map((t) => {
            if (t.id === callId || (!callId && t.status === 'running')) {
              return {
                ...t,
                status: evt.error ? 'failed' : 'completed',
                output: evt.output || evt.result,
                error: evt.error,
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
        loadThreads();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------

  const handleSendMessage = (prompt) => {
    // Optimistic user bubble
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: prompt, thinking: '', tools: [] },
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

  const handleRespondApproval = async (requestId, decision) => {
    if (wsRef.current) {
      wsRef.current.send({
        action: 'approval_response',
        requestId,
        decision,
      });
    } else {
      await api.respondApproval(requestId, decision);
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
      await api.startThread(tid);
      setCurrentThread(tid);
      setMessages([]);
      await loadThreads();
    } catch (err) {
      console.error('Failed to create new thread:', err);
    }
  };

  const handleForkThread = async (sourceId) => {
    const newId = prompt(`从 ${sourceId} 派生新分支会话名:`, `${sourceId}_fork`);
    if (!newId) return;

    try {
      await api.forkThread(sourceId, newId);
      setCurrentThread(newId);
      await loadThreads();
      await loadThreadHistory(newId);
    } catch (err) {
      console.error('Failed to fork thread:', err);
    }
  };

  const handleCloseThread = async (threadId) => {
    if (!confirm(`确定关闭会话 ${threadId} 吗?`)) return;
    try {
      await api.closeThread(threadId);
      if (currentThread === threadId) {
        setCurrentThread('default');
        loadThreadHistory('default');
      }
      loadThreads();
    } catch (err) {
      console.error('Failed to close thread:', err);
    }
  };

  const handleTogglePlan = async () => {
    const next = !planActive;
    try {
      const res = await api.setPlanMode(next);
      setPlanActive(!!res.plan_active);
    } catch (err) {
      console.error('Failed to toggle plan mode:', err);
    }
  };

  const handleRetryMcp = async () => {
    try {
      const res = await api.retryMcp();
      setMcpStatus(res);
    } catch (err) {
      console.error('Failed to retry MCP:', err);
    }
  };

  return (
    <div className="app-layout">
      {/* Top Header */}
      <Header
        currentThread={currentThread}
        isConnected={isConnected}
        planActive={planActive}
        onTogglePlan={handleTogglePlan}
        onOpenWorld={() => setIsWorldDrawerOpen(true)}
      />

      {/* Main Content Area */}
      <div className="app-main">
        {/* Left Sidebar */}
        <Sidebar
          threads={threads}
          currentThread={currentThread}
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
          onForkThread={handleForkThread}
          onCloseThread={handleCloseThread}
          onRefreshThreads={loadThreads}
        />

        {/* Center Workspace */}
        <main className="chat-container">
          <ChatArea
            messages={messages}
            isGenerating={isGenerating}
            onQuickPrompt={handleSendMessage}
          />

          {/* Security Approval Floating Box */}
          {pendingApproval && (
            <div className="approval-floating-wrapper">
              <ApprovalDialog
                request={pendingApproval}
                onRespond={handleRespondApproval}
              />
            </div>
          )}

          {/* Bottom Input Controls */}
          <InputBar
            isGenerating={isGenerating}
            onSendMessage={handleSendMessage}
            onSteerMessage={handleSteerMessage}
            onInterrupt={handleInterrupt}
          />
        </main>
      </div>

      {/* Right Drawer */}
      <WorldDrawer
        isOpen={isWorldDrawerOpen}
        onClose={() => setIsWorldDrawerOpen(false)}
        worldState={worldState}
        mcpStatus={mcpStatus}
        onRetryMcp={handleRetryMcp}
      />
    </div>
  );
}
