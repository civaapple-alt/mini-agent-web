/** Compatibility facade for the domain-oriented API modules. */
import { threadApi } from './api/threads.js';
import { worldApi } from './api/world.js';
import { workflowApi } from './api/workflows.js';
import { projectApi } from './api/projects.js';
import { settingsApi } from './api/settings.js';
import { approvalApi } from './api/approvals.js';

export { setActiveProjectId } from './api/request.js';
export { createAgentWebSocket } from './api/websocket.js';

export const api = {
  ...threadApi,
  ...worldApi,
  ...workflowApi,
  ...projectApi,
  ...settingsApi,
  ...approvalApi,
};
