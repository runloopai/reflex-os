/**
 * @runloop/reflex-client — typed Reflex API client for external applications.
 *
 * Configure once with a personal API key, then call the generated API
 * functions and subscribe to live agent streams:
 *
 * ```ts
 * import { configureReflex, listAgents, ReflexSocket } from '@runloop/reflex-client';
 *
 * configureReflex({
 *   baseUrl: 'https://reflex.example.com',
 *   apiKey: 'rfx_...',
 *   organizationId: 'my-org',
 * });
 *
 * const { data } = await listAgents();
 * ```
 */

export {
  configureReflex,
  getReflexConfig,
  resetReflexConfig,
  apiFetch,
  reflexRequest,
  ReflexApiError,
} from './http.js';
export type {
  ReflexClientConfig,
  ReflexRequestOptions,
  ApiResponseEnvelope,
  ValidationIssue,
} from './http.js';

export { ReflexSocket } from './socket.js';
export type {
  ReflexStreamEvent,
  ReflexSocketMessage,
  ReflexSocketState,
  ReflexSocketOptions,
  ReflexEventHandler,
  ReflexStateHandler,
  ReflexMessageHandler,
  WebSocketLike,
  WebSocketConstructor,
} from './socket.js';

export {
  initialAgentLiveness,
  reduceAgentLiveness,
  deriveAgentStatus,
  turnEndedBetween,
  isTurnEndEventType,
} from './agent-liveness.js';
export type { AgentLivenessState, AgentLivenessEvent, LiveAgentStatus } from './agent-liveness.js';

// Generated API operations (orval, one module per OpenAPI tag) and every
// generated model type. Regenerate with `pnpm client:generate` at the repo
// root; do not edit by hand.
export * from './generated/activity.js';
export * from './generated/agent-associations.js';
export * from './generated/agent-drafts.js';
export * from './generated/agent-groups.js';
export * from './generated/agent-labels.js';
export * from './generated/agent-personas.js';
export * from './generated/agents.js';
export * from './generated/auth.js';
export * from './generated/blueprints.js';
export * from './generated/config.js';
export * from './generated/device.js';
export * from './generated/flags.js';
export * from './generated/invites.js';
export * from './generated/mcp.js';
export * from './generated/me.js';
export * from './generated/organizations.js';
export * from './generated/org-setup.js';
export * from './generated/permissions.js';
export * from './generated/plugins.js';
export * from './generated/profile.js';
export * from './generated/resource-grants.js';
export * from './generated/secrets.js';
export * from './generated/service-accounts.js';
export * from './generated/share-requests.js';
export * from './generated/snapshots.js';
export * from './generated/status.js';
export * from './generated/teams.js';
export * from './generated/uploads.js';
export * from './generated/user.js';
export * from './generated/users.js';
export * from './generated/model/index.js';
