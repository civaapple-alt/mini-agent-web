/**
 * API and WebSocket client for Mini Agent Web Backend.
 */

const API_BASE = '';

export const api = {
  // ---------------------------------------------------------------------------
  // Thread Management
  // ---------------------------------------------------------------------------

  async listThreads() {
    const res = await fetch(`${API_BASE}/api/threads`);
    if (!res.ok) throw new Error('Failed to list threads');
    return res.json();
  },

  async startThread(threadId = 'default') {
    const res = await fetch(`${API_BASE}/api/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId }),
    });
    if (!res.ok) throw new Error('Failed to start thread');
    return res.json();
  },

  async forkThread(sourceThreadId, newThreadId) {
    const res = await fetch(`${API_BASE}/api/threads/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_thread_id: sourceThreadId,
        new_thread_id: newThreadId,
      }),
    });
    if (!res.ok) throw new Error('Failed to fork thread');
    return res.json();
  },

  async readThread(threadId) {
    const res = await fetch(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}`);
    if (!res.ok) throw new Error(`Failed to read thread ${threadId}`);
    return res.json();
  },

  async closeThread(threadId) {
    const res = await fetch(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}/close`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`Failed to close thread ${threadId}`);
    return res.json();
  },

  // ---------------------------------------------------------------------------
  // World Governance & MCP
  // ---------------------------------------------------------------------------

  async getWorldState() {
    const res = await fetch(`${API_BASE}/api/world/state`);
    if (!res.ok) throw new Error('Failed to get world state');
    return res.json();
  },

  async refreshWorld() {
    const res = await fetch(`${API_BASE}/api/world/refresh`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to refresh world');
    return res.json();
  },

  async getMcpStatus() {
    const res = await fetch(`${API_BASE}/api/mcp/status`);
    if (!res.ok) throw new Error('Failed to get MCP status');
    return res.json();
  },

  async retryMcp() {
    const res = await fetch(`${API_BASE}/api/mcp/retry`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to retry MCP');
    return res.json();
  },

  // ---------------------------------------------------------------------------
  // Workflows (Plan Mode & Goals)
  // ---------------------------------------------------------------------------

  async getWorkflowState() {
    const res = await fetch(`${API_BASE}/api/workflows/state`);
    if (!res.ok) throw new Error('Failed to get workflow state');
    return res.json();
  },

  async setPlanMode(active, prompt = null) {
    const res = await fetch(`${API_BASE}/api/workflows/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active, prompt }),
    });
    if (!res.ok) throw new Error('Failed to set plan mode');
    return res.json();
  },

  async startGoal(objective) {
    const res = await fetch(`${API_BASE}/api/workflows/goal/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objective }),
    });
    if (!res.ok) throw new Error('Failed to start goal');
    return res.json();
  },

  // ---------------------------------------------------------------------------
  // Security Approval Response
  // ---------------------------------------------------------------------------

  async respondApproval(requestId, decision, reason = '') {
    const res = await fetch(`${API_BASE}/api/approval/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: requestId,
        decision,
        reason,
      }),
    });
    if (!res.ok) throw new Error('Failed to respond approval');
    return res.json();
  },
};

/**
 * Creates a managed WebSocket connection to the Agent Gateway.
 */
export function createAgentWebSocket(onMessage, onOpen, onClose) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/agent`;

  let socket = null;
  let shouldReconnect = true;

  function connect() {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      if (onOpen) onOpen();
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onMessage) onMessage(data);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    socket.onclose = () => {
      if (onClose) onClose();
      if (shouldReconnect) {
        setTimeout(connect, 2000);
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  connect();

  return {
    send(data) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(typeof data === 'string' ? data : JSON.stringify(data));
      }
    },
    close() {
      shouldReconnect = false;
      if (socket) socket.close();
    },
  };
}
