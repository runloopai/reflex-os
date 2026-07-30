/**
 * Arcade API client and session storage.
 *
 * The login token lives in localStorage: created once from a name, never
 * expiring, no logout. Losing the key means losing the account, so the nav
 * exposes a copy button. Shapes mirror the server's JSON (see
 * `server/events.ts` and `server/routes.ts`, the source of truth).
 */

const TOKEN_KEY = 'reflex-arcade:token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * Forget a token the server no longer knows (e.g. its data was reset).
 * Keeping it would leave the app signed out while every request and socket
 * still presented the dead credential — the hub answers those with 401 and
 * the client reconnects forever, so the public shelf would never go live.
 */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface ReflexKeyInfo {
  id: string;
  name: string;
  org: string | null;
  preview: string;
}

export interface Me {
  id: string;
  name: string;
  /** Small data-URL image, or empty for the initials fallback. */
  avatar: string;
  /** Short profile description, shown in chat hover cards. */
  bio: string;
  /** The saved key game creation runs under. */
  activeKeyId: string | null;
  keys: ReflexKeyInfo[];
}

export interface PublicProfile {
  id: string;
  name: string;
  avatar: string;
  bio: string;
}

export interface OrgOption {
  id: string;
  slug: string;
  name: string;
}

/** A "Connect with Reflex" flow waiting on the player's approval in Reflex. */
export interface ConnectStarted {
  connectionId: string;
  /** Short code shown here and on Reflex's page, so the player can match them. */
  userCode: string;
  /** Reflex's approval page, code prefilled — what we open in a new tab. */
  approveUrl: string;
  /** Seconds Reflex asks us to wait between polls. */
  interval: number;
  /** Seconds until the code expires. */
  expiresIn: number;
}

/** One poll of a connect flow. `approved` carries the freshly saved key. */
export type ConnectPoll =
  | { status: 'pending' }
  | { status: 'approved'; keyId: string; user: Me }
  | { status: 'denied' | 'expired'; message: string };

export interface CatalogModel {
  id: string;
  displayName: string;
}

/** Secret kinds a provider can be authenticated with (mirrors Reflex's). */
export type ProviderKeyType = 'apiKey' | 'subscription';

/** Tier a key lives in, most specific first — the order Reflex resolves in. */
export type ProviderKeyScope = 'user' | 'team' | 'org';

/** One model-provider key the active Reflex key may launch with. */
export interface ProviderKey {
  id: string;
  name: string;
  /** Canonical model provider, matched against {@link CatalogProvider.keyProvider}. */
  provider: string;
  scope: ProviderKeyScope;
  type: ProviderKeyType;
}

export interface CatalogProvider {
  id: string;
  displayName: string;
  available: boolean;
  /** Canonical model provider used to match {@link ProviderKey}s to this provider. */
  keyProvider: string;
  /** Key types this provider accepts; empty means it needs no key at all. */
  keyTypes: ProviderKeyType[];
  models: CatalogModel[];
}

export interface CatalogAgent {
  agentType: string;
  displayName: string;
  multiModel: boolean;
  defaultModel: string | null;
  defaultProvider: string | null;
  providers: CatalogProvider[];
}

export interface Catalog {
  defaultAgentType: string | null;
  agents: CatalogAgent[];
  /**
   * Every provider key the active Reflex key can launch with, all tiers.
   * `null` when the lookup failed — distinct from `[]` ("you have none").
   */
  keys: ProviderKey[] | null;
}

export type GameStatus = 'creating' | 'live' | 'error' | 'stopped';

export interface Game {
  id: string;
  ownerId: string;
  ownerName: string;
  /** Live sockets currently on this game's view. */
  viewers: number;
  /** Total times the game view has been opened. */
  plays: number;
  title: string;
  prompt: string;
  agentId: string;
  agentType: string | null;
  model: string | null;
  status: GameStatus;
  agentStatus: string | null;
  isPublic: boolean;
  autoApprove: boolean;
  daemonUrl: string | null;
  /** Agent-authored art, served at /api/games/:id/art/:kind?v=artVersion. */
  hasPreview: boolean;
  hasIcon: boolean;
  /** A looping animated cover exists (shown on tile hover). */
  hasPreviewAnim: boolean;
  /** Done-suggestion count; null on live frames (keep the last known). */
  shippedCount: number | null;
  artVersion: number;
  /** What the agent is working on right now, when known. */
  currentTask: string | null;
  currentTaskKind: 'suggestion' | 'prompt' | null;
  createdAt: string;
}

/** URL for a game's agent-drawn art, or null when it hasn't shipped any. */
export function gameArtUrl(game: Game, kind: 'preview' | 'icon' | 'preview-anim'): string | null {
  const has =
    kind === 'preview'
      ? game.hasPreview
      : kind === 'preview-anim'
        ? game.hasPreviewAnim
        : game.hasIcon;
  return has ? `/api/games/${game.id}/art/${kind}?v=${game.artVersion}` : null;
}

export type SuggestionStatus = 'pending' | 'approved' | 'working' | 'done' | 'rejected';

export type SuggestionCategory = 'bug' | 'improvement' | 'feature';

export interface Suggestion {
  id: string;
  gameId: string;
  authorId: string;
  authorName: string;
  body: string;
  status: SuggestionStatus;
  category: SuggestionCategory;
  /** Total hearts; the agent works the most-hearted approved one first. */
  hearts: number;
  /** Present on GET responses: whether the requesting user hearted it. */
  heartedByMe?: boolean;
  /** The owner's public note: a rejection reason or a comment, any status. */
  ownerNote: string | null;
  createdAt: string;
  /** Set when approved; ties in the hearts ordering break oldest-first. */
  approvedAt: string | null;
  /** Set when the agent picked it up / finished it. */
  startedAt: string | null;
  completedAt: string | null;
  /** When the author last rewrote it; null if never edited. */
  editedAt: string | null;
}

export interface ChatMessage {
  id: string;
  /** The game room this message belongs to. */
  gameId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  authorBio: string;
  body: string;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      typeof body.message === 'string' ? body.message : `Request failed (${res.status})`,
      res.status,
      typeof body.error === 'string' ? body.error : 'unknown',
    );
  }
  return body as T;
}

export const arcade = {
  /** `via` is the shared link this visitor arrived through, if any. */
  join: (name: string, via?: string | null) =>
    api<{ token: string; user: Me }>('/api/join', {
      method: 'POST',
      body: JSON.stringify({ name, ...(via ? { via } : {}) }),
    }),
  login: (token: string) =>
    api<{ token: string; user: Me }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  me: () => api<{ user: Me }>('/api/me'),
  updateProfile: (patch: { name?: string; bio?: string; avatar?: string }) =>
    api<{ user: Me }>('/api/me', { method: 'PATCH', body: JSON.stringify(patch) }),
  getProfile: (userId: string) => api<{ user: PublicProfile }>(`/api/users/${userId}`),
  startReflexConnect: () => api<ConnectStarted>('/api/me/reflex-connect', { method: 'POST' }),
  pollReflexConnect: (connectionId: string) =>
    api<ConnectPoll>(`/api/me/reflex-connect/${connectionId}/poll`, { method: 'POST' }),
  cancelReflexConnect: (connectionId: string) =>
    api<{ ok: boolean }>(`/api/me/reflex-connect/${connectionId}`, { method: 'DELETE' }),
  addReflexKey: (input: { name: string; apiKey: string }) =>
    api<{ keyId: string; organizations: OrgOption[]; user: Me }>('/api/me/reflex-keys', {
      method: 'POST',
      body: JSON.stringify({ name: input.name || undefined, apiKey: input.apiKey }),
    }),
  keyOrganizations: (keyId: string) =>
    api<{ organizations: OrgOption[] }>(`/api/me/reflex-keys/${keyId}/organizations`),
  setKeyOrg: (keyId: string, organizationId: string) =>
    api<{ user: Me }>(`/api/me/reflex-keys/${keyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ organizationId }),
    }),
  setActiveKey: (keyId: string) =>
    api<{ user: Me }>('/api/me/active-key', {
      method: 'PUT',
      body: JSON.stringify({ keyId }),
    }),
  deleteReflexKey: (keyId: string) =>
    api<{ user: Me }>(`/api/me/reflex-keys/${keyId}`, { method: 'DELETE' }),
  catalog: () => api<{ catalog: Catalog }>('/api/reflex/catalog'),

  listGames: () => api<{ games: Game[] }>('/api/games'),
  getGame: (id: string) => api<{ game: Game; role: 'owner' | 'viewer' }>(`/api/games/${id}`),
  createGame: (input: {
    title: string;
    prompt: string;
    agentType: string;
    model: string | null;
    /** Pinned model-provider key (`mps_*`), or null to let Reflex resolve one. */
    providerKeyId?: string | null;
    isPublic: boolean;
    autoApprove: boolean;
  }) => api<{ game: Game }>('/api/games', { method: 'POST', body: JSON.stringify(input) }),
  deleteGame: (id: string) => api<{ ok: boolean }>(`/api/games/${id}`, { method: 'DELETE' }),
  patchGame: (id: string, patch: { isPublic?: boolean; autoApprove?: boolean }) =>
    api<{ game: Game }>(`/api/games/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  listSuggestions: (gameId: string) =>
    api<{ suggestions: Suggestion[] }>(`/api/games/${gameId}/suggestions`),
  addSuggestion: (gameId: string, body: string, category: SuggestionCategory) =>
    api<{ suggestion: Suggestion }>(`/api/games/${gameId}/suggestions`, {
      method: 'POST',
      body: JSON.stringify({ body, category }),
    }),
  editSuggestion: (gameId: string, id: string, body: string, category: SuggestionCategory) =>
    api<{ suggestion: Suggestion }>(`/api/games/${gameId}/suggestions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body, category }),
    }),
  toggleHeart: (gameId: string, suggestionId: string) =>
    api<{ suggestion: Suggestion; hearted: boolean }>(
      `/api/games/${gameId}/suggestions/${suggestionId}/heart`,
      { method: 'POST' },
    ),
  approveSuggestion: (gameId: string, id: string) =>
    api<{ suggestion: Suggestion }>(`/api/games/${gameId}/suggestions/${id}/approve`, {
      method: 'POST',
    }),
  rejectSuggestion: (gameId: string, id: string, reason?: string) =>
    api<{ suggestion: Suggestion }>(`/api/games/${gameId}/suggestions/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),
  setSuggestionNote: (gameId: string, id: string, note: string) =>
    api<{ suggestion: Suggestion }>(`/api/games/${gameId}/suggestions/${id}/note`, {
      method: 'PUT',
      body: JSON.stringify({ note }),
    }),

  listGameChat: (gameId: string) => api<{ messages: ChatMessage[] }>(`/api/games/${gameId}/chat`),
  sendGameChat: (gameId: string, body: string) =>
    api<{ message: ChatMessage }>(`/api/games/${gameId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
};
