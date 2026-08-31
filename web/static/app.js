/**
 * Mini Agent Studio Client Application Logic
 */

let ws = null;
let currentThreadId = "default";
let isGenerating = false;
let activeTurnId = null;
let currentAssistantMsgElement = null;
let currentThinkingElement = null;
let currentOutputElement = null;
let currentThinkingBuffer = "";
let currentOutputBuffer = "";
let activeTools = {};

// Initialize Marked Options
if (window.marked) {
  marked.setOptions({
    breaks: true,
    highlight: function (code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  });
}

// -----------------------------------------------------------------------------
// Initialization & WebSocket
// -----------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  initIcons();
  setupEventListeners();
  connectWebSocket();
  loadThreads();
  loadWorldState();
  loadWorkflowState();
});

function initIcons() {
  if (window.lucide) {
    lucide.createIcons();
  }
}

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/agent`;
  const dot = document.getElementById("wsStatusDot");

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20";
      dot.title = "WebSocket Connected";
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerEvent(data);
      } catch (err) {
        console.error("Failed to parse WS message:", err);
      }
    };

    ws.onclose = () => {
      dot.className = "w-2.5 h-2.5 rounded-full bg-rose-500 ring-4 ring-rose-500/20";
      dot.title = "WebSocket Disconnected. Reconnecting...";
      setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  } catch (err) {
    console.error("WebSocket connection error:", err);
  }
}

// -----------------------------------------------------------------------------
// Server Event Dispatcher
// -----------------------------------------------------------------------------

function handleServerEvent(data) {
  // 1. Approval Request Broadcast
  if (data.type === "approval_request") {
    showApprovalBanner(data.requestId, data.data);
    return;
  }

  // 2. Turn Submission
  if (data.type === "_turn_submission") {
    const sub = data.data;
    if (sub && sub.turn_id) {
      activeTurnId = sub.turn_id;
    }
    return;
  }

  // 3. Engine Typed Events
  if (data.type === "event") {
    const envelope = data;
    const evt = envelope.event || {};
    const eventType = evt.type;

    if (eventType === "turn_started") {
      setGeneratingState(true);
      createAssistantMessageContainer();
    } else if (eventType === "assistant_reasoning_delta") {
      appendReasoningDelta(evt.delta || "");
    } else if (eventType === "assistant_text_delta") {
      appendTextDelta(evt.delta || "");
    } else if (eventType === "tool_started") {
      renderToolStarted(evt);
    } else if (eventType === "tool_finished") {
      renderToolFinished(evt);
    } else if (eventType === "turn_finished" || eventType === "run_failed") {
      finalizeAssistantMessage();
      setGeneratingState(false);
      loadThreads();
    }
  }
}

// -----------------------------------------------------------------------------
// Message Rendering (User / Assistant / Thinking / Tools)
// -----------------------------------------------------------------------------

function appendUserMessage(text) {
  const container = document.getElementById("messagesContainer");
  hideWelcomeBanner();

  const msgDiv = document.createElement("div");
  msgDiv.className = "flex justify-end";
  msgDiv.innerHTML = `
    <div class="max-w-2xl rounded-2xl rounded-tr-sm bg-sky-600/90 text-white px-4 py-2.5 text-sm shadow-md leading-relaxed">
      ${escapeHtml(text)}
    </div>
  `;
  container.appendChild(msgDiv);
  scrollToBottom();
}

function createAssistantMessageContainer() {
  const container = document.getElementById("messagesContainer");
  hideWelcomeBanner();

  currentThinkingBuffer = "";
  currentOutputBuffer = "";
  activeTools = {};

  const msgDiv = document.createElement("div");
  msgDiv.className = "flex gap-3 text-sm";
  msgDiv.innerHTML = `
    <div class="w-8 h-8 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shrink-0 shadow text-white font-bold text-xs mt-1">
      MA
    </div>
    <div class="flex-1 space-y-3 overflow-hidden">
      <!-- Thinking Accordion -->
      <details class="thinking-box rounded-xl bg-gray-900 border border-gray-800 text-xs text-gray-400 overflow-hidden hidden" open>
        <summary class="px-3 py-2 bg-gray-900/90 font-mono flex items-center justify-between cursor-pointer hover:bg-gray-800/80 transition">
          <span class="flex items-center gap-1.5 text-sky-400">
            <i data-lucide="brain" class="w-3.5 h-3.5 animate-pulse"></i>
            <span>Reasoning Process (思考中...)</span>
          </span>
          <i data-lucide="chevron-down" class="w-3.5 h-3.5 transition-transform duration-200"></i>
        </summary>
        <div class="thinking-body p-3 font-mono text-[11px] text-gray-400 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed border-t border-gray-800/50"></div>
      </details>

      <!-- Tool Execution Cards Container -->
      <div class="tool-cards-container space-y-2"></div>

      <!-- Assistant Markdown Body -->
      <div class="assistant-output markdown-body text-gray-100 streaming-cursor"></div>
    </div>
  `;

  container.appendChild(msgDiv);
  currentAssistantMsgElement = msgDiv;
  currentThinkingElement = msgDiv.querySelector(".thinking-body");
  currentOutputElement = msgDiv.querySelector(".assistant-output");

  initIcons();
  scrollToBottom();
}

function appendReasoningDelta(delta) {
  if (!currentThinkingElement) return;
  const box = currentAssistantMsgElement.querySelector(".thinking-box");
  box.classList.remove("hidden");

  currentThinkingBuffer += delta;
  currentThinkingElement.textContent = currentThinkingBuffer;
  currentThinkingElement.scrollTop = currentThinkingElement.scrollHeight;
  scrollToBottom();
}

function appendTextDelta(delta) {
  if (!currentOutputElement) return;
  currentOutputBuffer += delta;
  currentOutputElement.innerHTML = marked.parse(currentOutputBuffer);
  scrollToBottom();
}

function renderToolStarted(evt) {
  if (!currentAssistantMsgElement) return;
  const container = currentAssistantMsgElement.querySelector(".tool-cards-container");
  const callId = evt.call_id || evt.id || `tool_${Date.now()}`;

  const card = document.createElement("div");
  card.className = "rounded-lg bg-gray-900/90 border border-gray-800 p-2.5 text-xs font-mono";
  card.id = `tool_card_${callId}`;

  const toolName = evt.name || evt.tool || "tool";
  const args = typeof evt.arguments === "object" ? JSON.stringify(evt.arguments, null, 2) : evt.arguments || "";

  card.innerHTML = `
    <div class="flex items-center justify-between text-gray-300">
      <div class="flex items-center gap-1.5 font-semibold text-sky-400">
        <i data-lucide="wrench" class="w-3.5 h-3.5 animate-spin"></i>
        <span>${escapeHtml(toolName)}</span>
      </div>
      <span class="px-1.5 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800 text-[10px]">Running...</span>
    </div>
    ${args ? `<div class="mt-1.5 text-gray-400 text-[11px] bg-gray-950 p-2 rounded border border-gray-850 overflow-x-auto max-h-32 whitespace-pre-wrap">${escapeHtml(args)}</div>` : ""}
    <div class="tool-output mt-2 hidden text-[11px] text-gray-400 bg-gray-950 p-2 rounded border border-gray-850 overflow-x-auto max-h-48 whitespace-pre-wrap"></div>
  `;

  container.appendChild(card);
  activeTools[callId] = card;
  initIcons();
  scrollToBottom();
}

function renderToolFinished(evt) {
  const callId = evt.call_id || evt.id;
  const card = activeTools[callId] || (currentAssistantMsgElement ? currentAssistantMsgElement.querySelector(`[id^="tool_card_"]`) : null);
  if (!card) return;

  const badge = card.querySelector("span:last-child");
  if (badge) {
    const isError = evt.error || evt.status === "failed";
    badge.className = isError
      ? "px-1.5 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800 text-[10px]"
      : "px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px]";
    badge.textContent = isError ? "Failed" : "Completed";
  }

  const outputBox = card.querySelector(".tool-output");
  const output = evt.output || evt.result || "";
  if (outputBox && output) {
    outputBox.classList.remove("hidden");
    outputBox.textContent = typeof output === "object" ? JSON.stringify(output, null, 2) : output;
  }

  initIcons();
  scrollToBottom();
}

function finalizeAssistantMessage() {
  if (currentOutputElement) {
    currentOutputElement.classList.remove("streaming-cursor");
  }
  if (currentAssistantMsgElement) {
    const box = currentAssistantMsgElement.querySelector(".thinking-box");
    if (box && currentThinkingBuffer) {
      const label = box.querySelector("summary span span");
      if (label) label.textContent = "Reasoning Process (思考完毕)";
    }
  }
}

// -----------------------------------------------------------------------------
// Security Approval Handling
// -----------------------------------------------------------------------------

let pendingApprovalId = null;

function showApprovalBanner(requestId, data) {
  pendingApprovalId = requestId;
  const banner = document.getElementById("approvalBanner");
  document.getElementById("approvalRequestId").textContent = `[ID: ${requestId}]`;

  const details = typeof data === "object" ? JSON.stringify(data, null, 2) : String(data);
  document.getElementById("approvalDetails").textContent = details;

  banner.classList.remove("hidden");
  initIcons();
}

function hideApprovalBanner() {
  pendingApprovalId = null;
  document.getElementById("approvalBanner").classList.add("hidden");
}

function respondApproval(decision) {
  if (!pendingApprovalId) return;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: "approval_response",
      requestId: pendingApprovalId,
      decision: decision,
    }));
  } else {
    fetch("/api/approval/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: pendingApprovalId,
        decision: decision,
      }),
    });
  }

  hideApprovalBanner();
}

// -----------------------------------------------------------------------------
// User Send, Steer & Interrupt
// -----------------------------------------------------------------------------

function handleSendMessage() {
  const input = document.getElementById("promptInput");
  const text = input.value.trim();
  if (!text) return;

  if (isGenerating && activeTurnId) {
    // Inject Steer Prompt
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        action: "steer",
        turnId: activeTurnId,
        text: text,
        threadId: currentThreadId,
      }));
    }
    input.value = "";
    return;
  }

  appendUserMessage(text);
  input.value = "";

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: "turn",
      prompt: text,
      threadId: currentThreadId,
    }));
  } else {
    // Fallback to REST
    fetch("/api/agent/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: text,
        thread_id: currentThreadId,
      }),
    });
  }
}

function handleInterrupt() {
  if (!activeTurnId) return;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: "interrupt",
      turnId: activeTurnId,
      threadId: currentThreadId,
    }));
  } else {
    fetch("/api/agent/interrupt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turn_id: activeTurnId,
        thread_id: currentThreadId,
      }),
    });
  }
}

function setGeneratingState(generating) {
  isGenerating = generating;
  const btnSend = document.getElementById("btnSend");
  const btnInterrupt = document.getElementById("btnInterrupt");
  const steerBar = document.getElementById("steerBar");
  const promptInput = document.getElementById("promptInput");

  if (generating) {
    btnSend.classList.add("hidden");
    btnInterrupt.classList.remove("hidden");
    steerBar.classList.remove("hidden");
    promptInput.placeholder = "Agent 正在执行中... 输入内容并发送可实时纠偏 (Steer)";
  } else {
    btnSend.classList.remove("hidden");
    btnInterrupt.classList.add("hidden");
    steerBar.classList.add("hidden");
    promptInput.placeholder = "输入任务或问题... (Enter 发送, Shift+Enter 换行)";
    activeTurnId = null;
  }
}

// -----------------------------------------------------------------------------
// Threads & Sidebar Management
// -----------------------------------------------------------------------------

async function loadThreads() {
  try {
    const res = await fetch("/api/threads");
    const data = await res.json();
    const listContainer = document.getElementById("threadsList");
    listContainer.innerHTML = "";

    const threads = data.threads || ["default"];
    threads.forEach((tid) => {
      const active = tid === currentThreadId;
      const item = document.createElement("div");
      item.className = `group flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition ${
        active ? "bg-sky-950/80 text-sky-300 border border-sky-800/80 font-medium" : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
      }`;
      item.innerHTML = `
        <div class="flex items-center gap-2 truncate" onclick="switchThread('${tid}')">
          <i data-lucide="${active ? 'message-square' : 'hash'}" class="w-3.5 h-3.5 shrink-0 ${active ? 'text-sky-400' : 'text-gray-500'}"></i>
          <span class="truncate">${escapeHtml(tid)}</span>
        </div>
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          <button onclick="forkThreadPrompt('${tid}')" title="派生分支 (Fork)" class="p-1 hover:text-sky-400">
            <i data-lucide="git-fork" class="w-3 h-3"></i>
          </button>
          ${tid !== "default" ? `<button onclick="closeThread('${tid}')" title="关闭会话" class="p-1 hover:text-rose-400"><i data-lucide="trash" class="w-3 h-3"></i></button>` : ""}
        </div>
      `;
      listContainer.appendChild(item);
    });

    document.getElementById("currentThreadLabel").textContent = currentThreadId;
    initIcons();
  } catch (err) {
    console.error("Failed to load threads:", err);
  }
}

async function switchThread(threadId) {
  currentThreadId = threadId;
  document.getElementById("currentThreadLabel").textContent = currentThreadId;
  await loadThreads();

  // Load history messages
  try {
    const res = await fetch(`/api/threads/${threadId}`);
    const cp = await res.json();
    renderThreadHistory(cp);
  } catch (err) {
    console.error("Failed to load thread history:", err);
  }
}

function renderThreadHistory(checkpoint) {
  const container = document.getElementById("messagesContainer");
  container.innerHTML = "";

  const messages = checkpoint.messages || [];
  if (messages.length === 0) {
    showWelcomeBanner();
    return;
  }

  hideWelcomeBanner();
  messages.forEach((msg) => {
    if (msg.role === "user") {
      appendUserMessage(msg.text || "");
    } else if (msg.role === "assistant") {
      const msgDiv = document.createElement("div");
      msgDiv.className = "flex gap-3 text-sm";
      msgDiv.innerHTML = `
        <div class="w-8 h-8 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shrink-0 text-white font-bold text-xs mt-1">MA</div>
        <div class="flex-1 space-y-2 overflow-hidden">
          <div class="assistant-output markdown-body text-gray-100">${marked.parse(msg.text || "")}</div>
        </div>
      `;
      container.appendChild(msgDiv);
    }
  });

  scrollToBottom();
}

async function createNewThread() {
  const tid = `thread_${Date.now().toString(36)}`;
  await fetch("/api/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_id: tid }),
  });
  switchThread(tid);
}

async function forkThreadPrompt(sourceId) {
  const newId = prompt(`从 ${sourceId} 派生新分支会话名:`, `${sourceId}_fork`);
  if (!newId) return;

  await fetch("/api/threads/fork", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_thread_id: sourceId,
      new_thread_id: newId,
    }),
  });
  switchThread(newId);
}

async function closeThread(threadId) {
  if (!confirm(`确定关闭会话 ${threadId} 吗?`)) return;
  await fetch(`/api/threads/${threadId}/close`, { method: "POST" });
  if (currentThreadId === threadId) {
    currentThreadId = "default";
  }
  loadThreads();
}

// -----------------------------------------------------------------------------
// WorldState & Workflows
// -----------------------------------------------------------------------------

async function loadWorldState() {
  try {
    const [worldRes, mcpRes] = await Promise.all([
      fetch("/api/world/state").then((r) => r.json()),
      fetch("/api/mcp/status").then((r) => r.json()),
    ]);

    // Environment info
    const envBox = document.getElementById("envContent");
    const status = worldRes.status || {};
    envBox.innerHTML = `
      <div><span class="text-gray-500">OS/Arch:</span> ${status.os || "windows"} (${status.arch || "x86_64"})</div>
      <div><span class="text-gray-500">Shell:</span> ${status.shell || "pwsh"}</div>
      <div><span class="text-gray-500">Mode:</span> ${status.mode || "default"}</div>
      <div><span class="text-gray-500">Approval:</span> ${status.approval || "per_action"}</div>
    `;

    // Tools
    const toolsBox = document.getElementById("toolsContent");
    const tools = status.available_commands || [];
    toolsBox.innerHTML = tools
      .map((t) => `<span class="px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-[10px] text-gray-300 font-mono">${escapeHtml(t)}</span>`)
      .join("");

    // MCP
    const mcpBox = document.getElementById("mcpContent");
    const enabled = mcpRes.enabled_servers || [];
    mcpBox.innerHTML = enabled.length > 0
      ? enabled.map((s) => `<div>✅ ${escapeHtml(s)}</div>`).join("")
      : `<div>无活跃 MCP 服务 (工具数: ${mcpRes.tool_count || 0})</div>`;
  } catch (err) {
    console.error("Failed to load world state:", err);
  }
}

async function loadWorkflowState() {
  try {
    const res = await fetch("/api/workflows/state");
    const data = await res.json();
    const badge = document.getElementById("planModeBadge");
    if (data.plan_active) {
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  } catch (err) {
    console.error("Failed to load workflow state:", err);
  }
}

async function togglePlanMode() {
  const badge = document.getElementById("planModeBadge");
  const isCurrentlyActive = !badge.classList.contains("hidden");
  const nextActive = !isCurrentlyActive;

  try {
    const res = await fetch("/api/workflows/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: nextActive }),
    });
    const data = await res.json();
    if (data.plan_active) {
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  } catch (err) {
    console.error("Failed to toggle plan mode:", err);
  }
}

// -----------------------------------------------------------------------------
// UI Utilities & Event Listeners
// -----------------------------------------------------------------------------

function setupEventListeners() {
  // Send Button
  document.getElementById("btnSend").addEventListener("click", handleSendMessage);
  document.getElementById("btnInterrupt").addEventListener("click", handleInterrupt);
  document.getElementById("btnInterruptCurrent").addEventListener("click", handleInterrupt);

  // Input Enter / Shift+Enter
  const input = document.getElementById("promptInput");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  // Approvals
  document.getElementById("btnApproveApproval").addEventListener("click", () => respondApproval("approved"));
  document.getElementById("btnDenyApproval").addEventListener("click", () => respondApproval("denied"));

  // Drawer
  const drawer = document.getElementById("worldDrawer");
  document.getElementById("btnOpenWorld").addEventListener("click", () => {
    drawer.classList.remove("translate-x-full");
    loadWorldState();
  });
  document.getElementById("btnCloseWorld").addEventListener("click", () => {
    drawer.classList.add("translate-x-full");
  });

  // Plan Mode Toggle
  document.getElementById("btnTogglePlan").addEventListener("click", togglePlanMode);

  // Threads
  document.getElementById("btnNewThread").addEventListener("click", createNewThread);
  document.getElementById("btnRefreshThreads").addEventListener("click", loadThreads);
  document.getElementById("btnRetryMcp").addEventListener("click", async () => {
    await fetch("/api/mcp/retry", { method: "POST" });
    loadWorldState();
  });

  // Quick prompt buttons
  document.querySelectorAll(".quick-prompt").forEach((btn) => {
    btn.addEventListener("click", () => {
      input.value = btn.textContent.trim().replace(/^[^\w\u4e00-\u9fa5]+/, "");
      handleSendMessage();
    });
  });
}

function scrollToBottom() {
  const container = document.getElementById("messagesContainer");
  container.scrollTop = container.scrollHeight;
}

function hideWelcomeBanner() {
  const banner = document.getElementById("welcomeBanner");
  if (banner) banner.classList.add("hidden");
}

function showWelcomeBanner() {
  const banner = document.getElementById("welcomeBanner");
  if (banner) banner.classList.remove("hidden");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
