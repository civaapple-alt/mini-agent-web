import { resolveProjectId } from './request.js';

/** Creates a managed WebSocket connection to the Agent Gateway. */
export function createAgentWebSocket(
  onMessage,
  onOpen,
  onClose,
  getProjectId = () => null,
) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/agent`;

  let socket = null;
  let shouldReconnect = true;

  function connect() {
    const projectId = resolveProjectId(getProjectId?.());
    const separator = wsUrl.includes('?') ? '&' : '?';
    socket = new WebSocket(
      projectId
        ? `${wsUrl}${separator}project_id=${encodeURIComponent(projectId)}`
        : wsUrl,
    );

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
      if (shouldReconnect) setTimeout(connect, 2000);
    };

    socket.onerror = () => socket.close();
  }

  connect();

  return {
    send(data) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        if (typeof data === 'string') {
          socket.send(data);
        } else {
          socket.send(JSON.stringify({
            ...data,
            project_id: data.project_id || data.projectId || resolveProjectId(getProjectId?.()),
          }));
        }
        return true;
      }
      return false;
    },
    isOpen() {
      return Boolean(socket && socket.readyState === WebSocket.OPEN);
    },
    close() {
      shouldReconnect = false;
      if (socket) socket.close();
    },
  };
}
