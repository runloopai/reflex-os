/**
 * Server-side Reflex access.
 *
 * Uses `@runloop/reflex-client` (imported from source; see README) with one
 * twist: the SDK's module-level config carries only the base URL, and every
 * call passes the game owner's credentials as explicit headers. Headers on a
 * request win over the configured key, which is what makes one server able
 * to act for many owners.
 */
import {
  killAgent,
  stopAgent,
  configureReflex,
  createAgent,
  getAgent,
  getAgentModelSupport,
  listAccessibleModelProviderSecrets,
  listOrganizations,
  listAgents,
  pollDeviceAuthToken,
  sendAgentMessage,
  startDeviceAuth,
  ReflexApiError,
  type Agent,
  type AgentModelSupportResponse,
  type ModelProviderSecret,
} from '../../../../sdk/client/src/index.ts';

type SupportEntry = AgentModelSupportResponse['agents'][string];
type AvailableSupportEntry = Extract<SupportEntry, { status: 'available' }>;

export interface ReflexCredentials {
  apiKey: string;
  org: string | null;
}

export function initReflex(baseUrl: string): void {
  // The placeholder key is never sent: every call below sets Authorization
  // explicitly, and explicit headers take precedence in the SDK transport.
  configureReflex({ baseUrl, apiKey: 'arcade-per-request-auth' });
}

function authHeaders(creds: ReflexCredentials): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${creds.apiKey}` };
  if (creds.org) headers['x-organization-id'] = creds.org;
  return headers;
}

export interface ReflexOrgOption {
  id: string;
  slug: string;
  name: string;
}

/**
 * The orgs a personal API key can act in, via the SDK's `listOrganizations`
 * (user-scoped, so it doubles as key validation: a bad key throws 401).
 * Returns a UI-ready error message instead when the key is rejected.
 */
export async function fetchOrganizationsForKey(
  apiKey: string,
): Promise<ReflexOrgOption[] | { error: string }> {
  try {
    const { data } = await listOrganizations({
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return data.organizations.map((membership) => ({
      id: membership.organization.id,
      slug: membership.organization.slug,
      name: membership.organization.name,
    }));
  } catch (err) {
    if (err instanceof ReflexApiError) {
      if (err.status === 401) return { error: 'Reflex rejected the API key.' };
      return { error: `Reflex rejected the key: ${err.message}` };
    }
    return { error: 'Could not reach the Reflex server.' };
  }
}

/**
 * How the arcade introduces itself on Reflex's approval page. It is what the
 * user is asked to trust and what names the key Reflex mints, so it is the
 * product's name, not a hostname.
 */
export const ARCADE_CLIENT_NAME = 'Reflex Arcade';

/** A device-authorization flow the arcade started on a player's behalf. */
export interface ReflexConnectStart {
  /** Secret the arcade server polls with. Never leaves this process. */
  deviceCode: string;
  /** Short code the player sees on both ends, so they can match them up. */
  userCode: string;
  /** Reflex's approval page, with the code prefilled. */
  verificationUriComplete: string;
  /** Seconds Reflex asks us to wait between polls. */
  interval: number;
  /** Seconds until the code expires and the player must start over. */
  expiresIn: number;
}

/**
 * Start "Connect with Reflex": ask Reflex for a device code and the approval
 * URL to send the player to. Nothing is minted yet — the key only exists
 * once the player approves in Reflex, under their own session.
 */
export async function startReflexConnect(): Promise<ReflexConnectStart> {
  const { data } = await startDeviceAuth({ clientName: ARCADE_CLIENT_NAME });
  return {
    deviceCode: data.deviceCode,
    userCode: data.userCode,
    verificationUriComplete: data.verificationUriComplete,
    interval: data.interval,
    expiresIn: data.expiresIn,
  };
}

/**
 * One poll of a pending connection. `denied` and `expired` are answers, not
 * failures: the player said no, or took too long. Anything else (Reflex
 * unreachable, a shape we don't understand) throws.
 */
export type ReflexConnectPoll =
  | { status: 'pending' }
  | { status: 'approved'; apiKey: string; organizationId: string }
  | { status: 'denied' }
  | { status: 'expired' };

export async function pollReflexConnect(deviceCode: string): Promise<ReflexConnectPoll> {
  try {
    const { data } = await pollDeviceAuthToken({ deviceCode });
    if (data.status === 'approved') {
      return { status: 'approved', apiKey: data.apiKey, organizationId: data.organizationId };
    }
    return { status: 'pending' };
  } catch (err) {
    // Reflex answers a resolved-but-unusable code with 400 + an OAuth error
    // code: the user denied it, or it expired (or was already claimed, which
    // for the player means the same thing — start again).
    if (err instanceof ReflexApiError && err.status === 400) {
      return { status: err.code === 'access_denied' ? 'denied' : 'expired' };
    }
    throw err;
  }
}

/** Secret kinds a provider can be authenticated with (mirrors Reflex's). */
export type ArcadeKeyType = 'apiKey' | 'subscription';

/** Tier a key lives in, most specific first — the order Reflex resolves in. */
export type ArcadeKeyScope = 'user' | 'team' | 'org';

/**
 * One model-provider key the active Reflex key may launch with, reduced to
 * what the picker renders. Deliberately metadata-only: no secret material
 * (`secretId`, base URLs) crosses into the arcade or a browser.
 */
export interface ArcadeProviderKey {
  /** `mps_*` id, stable across refetches. */
  id: string;
  /** Display name — subscriptions stored under the `default` alias get their product label. */
  name: string;
  /** Canonical model provider this key authenticates (`anthropic`, `openai`, …). */
  provider: string;
  scope: ArcadeKeyScope;
  type: ArcadeKeyType;
}

/** Compact launch catalog for the game-creation form. */
export interface ArcadeCatalog {
  defaultAgentType: string | null;
  agents: {
    agentType: string;
    displayName: string;
    multiModel: boolean;
    defaultModel: string | null;
    defaultProvider: string | null;
    providers: {
      id: string;
      displayName: string;
      /** Whether the org/user has a usable provider key for this provider. */
      available: boolean;
      /**
       * Canonical model provider used to match keys against this provider —
       * a provider `id` is not always a `ModelProvider` (e.g. free tiers).
       */
      keyProvider: string;
      /**
       * Key types this provider accepts, normalised from the catalog's
       * optional `keyTypes`: absent upstream means "API keys only", and an
       * empty array means the provider needs no key at all (free tier).
       */
      keyTypes: ArcadeKeyType[];
      models: { id: string; displayName: string }[];
    }[];
  }[];
  /**
   * Every provider key the active Reflex key can launch with, across user,
   * team, and org tiers — the same list Reflex's own launch dialog reads.
   * `null` when that lookup failed (or the deployment doesn't serve it):
   * an empty array is a claim that the user has no keys, which is not the
   * same thing and must not be rendered as one.
   */
  keys: ArcadeProviderKey[] | null;
}

/**
 * Subscription secrets are stored under an internal alias rather than a
 * user-chosen name, so show the product name instead — matching Reflex's
 * own `modelProviderSecretDisplayName`.
 */
const SUBSCRIPTION_LABEL: Record<string, string> = {
  anthropic: 'Claude Max',
  openai: 'Codex',
};

function keyDisplayName(secret: ModelProviderSecret): string {
  if (secret.type === 'subscription' && (secret.name === 'default' || secret.name.length === 0)) {
    return SUBSCRIPTION_LABEL[secret.provider] ?? secret.name;
  }
  return secret.name;
}

/**
 * The provider keys the caller may launch with (`GET
 * /me/model-provider-secrets/accessible`), folded across user, team, and org
 * tiers by the server. A failed lookup (or a deployment that doesn't serve
 * the route) yields `null` rather than failing the whole catalog — the agent
 * and model pickers still work, they just can't name the keys. It must not
 * degrade to `[]`: that would render as "you have no keys" and hide a
 * recoverable failure behind a confident, wrong answer.
 */
async function fetchProviderKeys(creds: ReflexCredentials): Promise<ArcadeProviderKey[] | null> {
  try {
    const { data } = await listAccessibleModelProviderSecrets(undefined, {
      headers: authHeaders(creds),
    });
    return data.secrets.map((secret) => ({
      id: secret.id,
      name: keyDisplayName(secret),
      provider: secret.provider,
      scope: secret.scope,
      type: secret.type,
    }));
  } catch {
    return null;
  }
}

/**
 * The launch catalog the Reflex web app itself uses (`GET
 * /config/agent-model-support`), reduced to what the arcade's pickers need:
 * enabled agent types, their providers with key availability, and the
 * discovered models per provider — plus the provider keys behind that
 * availability, so the form can name them the way Reflex's launch dialog does.
 */
export async function fetchModelCatalog(creds: ReflexCredentials): Promise<ArcadeCatalog> {
  const [{ data }, keys] = await Promise.all([
    getAgentModelSupport({ headers: authHeaders(creds) }),
    fetchProviderKeys(creds),
  ]);

  const providerViews = (entry: AvailableSupportEntry) =>
    entry.providers.map((provider) => {
      const endpointIds = new Set(
        entry.providerEndpoints
          .filter((pe) => pe.providerId === provider.id)
          .map((pe) => pe.modelEndpointId),
      );
      const available = entry.endpoints.some(
        (endpoint) => endpointIds.has(endpoint.id) && endpoint.availability.available,
      );
      const models = (entry.discoveredModels ?? [])
        .filter((model) => model.providerId === provider.id)
        .map((model) => ({ id: model.id, displayName: model.displayName }));
      return {
        id: provider.id,
        displayName: provider.displayName,
        available,
        keyProvider: provider.modelProvider ?? provider.id,
        keyTypes: provider.keyTypes ?? ['apiKey'],
        models,
      };
    });

  const launchable =
    data.launchableAgents ??
    Object.keys(data.agents).map((agentType) => ({
      agentType,
      displayName: agentType,
      multiModel: true,
      enabled: true,
    }));

  return {
    defaultAgentType: data.defaultAgentType ?? null,
    agents: launchable
      .filter((agent) => agent.enabled)
      .map((agent) => {
        const entry = data.agents[agent.agentType];
        if (entry?.status === 'available') {
          return {
            agentType: agent.agentType,
            displayName: agent.displayName,
            multiModel: true,
            defaultModel: entry.defaultModel ?? null,
            defaultProvider: entry.defaultProvider ?? null,
            providers: providerViews(entry),
          };
        }
        return {
          agentType: agent.agentType,
          displayName: agent.displayName,
          multiModel: agent.multiModel,
          defaultModel: null,
          defaultProvider: null,
          providers: [],
        };
      }),
    keys,
  };
}

/**
 * Validate a personal API key (and org scope, when given) by listing agents.
 * Returns an error message suitable for the UI, or null when the key works.
 */
export async function validateCredentials(creds: ReflexCredentials): Promise<string | null> {
  try {
    await listAgents({ limit: 1 }, { headers: authHeaders(creds) });
    return null;
  } catch (err) {
    if (err instanceof ReflexApiError) {
      if (err.status === 401) return 'Reflex rejected the API key.';
      if (err.code === 'no_active_organization') {
        return 'The key works, but an organization id or slug is required.';
      }
      return `Reflex rejected the key: ${err.message}`;
    }
    return 'Could not reach the Reflex server.';
  }
}

export async function createGameAgent(
  creds: ReflexCredentials,
  input: {
    name: string;
    prompt: string;
    systemPrompt: string;
    agentType: string;
    model: string | null;
    /**
     * A model-provider key to pin the launch to (`mps_*`). Omitted, Reflex
     * resolves one itself: first usable key, most specific tier first.
     */
    providerSecretId?: string | null;
  },
): Promise<Agent> {
  const base = {
    name: input.name,
    agentType: input.agentType,
    prompt: input.prompt,
    systemPrompt: input.systemPrompt,
    ...(input.model ? { model: input.model } : {}),
    ...(input.providerSecretId ? { providerSecretId: input.providerSecretId } : {}),
  };
  // The game is served by a dev server on the agent's devbox and shown in an
  // iframe. When the box suspends, a viewer opening the game hits the tunnel
  // over HTTP — wake on that so the game resumes instead of dead-ending on
  // the suspended tunnel. Deployments that predate the `resumeOnHttp` launch
  // option reject it (the sandbox schema is strict), so fall back to a plain
  // launch — those deployments already wake on HTTP by default anyway.
  try {
    const { data } = await createAgent(
      { ...base, sandboxOptions: { resumeOnHttp: true } },
      { headers: authHeaders(creds) },
    );
    return data;
  } catch (err) {
    // Only the sandbox option is worth a second attempt. A 400 about the
    // pinned key (unknown field, key not visible, wrong type for the
    // provider) means the same thing twice, and retrying it buries the real
    // reason under a duplicate. Dropping the pin and retrying would be
    // worse still: the game would launch under a different account than the
    // player chose, which is the whole thing this option exists to control.
    if (!(err instanceof ReflexApiError) || err.status !== 400 || !isSandboxOptionError(err)) {
      throw err;
    }
    const { data } = await createAgent(base, { headers: authHeaders(creds) });
    return data;
  }
}

/**
 * Whether a rejected launch blames the sandbox options — the one field the
 * arcade knows how to retry without. Matched on the message because the API
 * reports a schema rejection as prose, not a field code.
 */
function isSandboxOptionError(err: ReflexApiError): boolean {
  return /sandbox|resumeonhttp/i.test(`${err.message} ${JSON.stringify(err.body ?? '')}`);
}

export async function fetchAgent(creds: ReflexCredentials, agentId: string): Promise<Agent> {
  const { data } = await getAgent(agentId, { headers: authHeaders(creds) });
  return data;
}

/**
 * Best-effort teardown when a game is deleted: kill removes the agent and
 * reclaims its devbox (daemons included); stop is the fallback for
 * deployments where the kill fails. A dead agent is fine either way.
 */
export async function destroyAgentQuietly(
  creds: ReflexCredentials,
  agentId: string,
): Promise<void> {
  try {
    await killAgent(agentId, { headers: authHeaders(creds) });
    return;
  } catch {
    // Fall through to a plain stop.
  }
  try {
    await stopAgent(agentId, { headers: authHeaders(creds) });
  } catch {
    // Already stopped, terminated, or unreachable — deletion proceeds.
  }
}

export async function sendMessageToAgent(
  creds: ReflexCredentials,
  agentId: string,
  message: string,
): Promise<void> {
  await sendAgentMessage(agentId, { message }, { headers: authHeaders(creds) });
}

/**
 * Standing rules for game agents, sent as the agent's system prompt at
 * launch. Two parts are load-bearing: the TypeScript + Vite stack, and
 * hosting through the Vite dev server registered as a daemon — the game
 * view embeds `agent.daemons[].url` in an iframe, so a static file server
 * or a directory listing there means a broken game page.
 */
export const GAME_AGENT_SYSTEM_PROMPT = [
  'You are a game-building agent on Reflex Arcade: you build one browser game',
  'and keep improving it from player suggestions, live in front of an audience.',
  '',
  'Stack — always:',
  '- TypeScript + Vite. Scaffold the game in a new directory with a Vite',
  '  vanilla-ts template (e.g. `npm create vite@latest <dir> -- --template',
  '  vanilla-ts`) unless the idea clearly needs a framework template.',
  '- Keep the code simple, typed, and in small modules.',
  '',
  'Hosting — always:',
  '- Serve the game with the Vite DEV server (dev mode, HMR on), never a',
  '  static file server, `python -m http.server`, or a build output.',
  '- Configure the server in vite.config.ts — BOTH settings are required:',
  '',
  '    server: { host: "0.0.0.0", allowedHosts: true },',
  '',
  '  The game is embedded through a *.tunnel.runloop.ai preview hostname;',
  '  without `allowedHosts: true`, newer Vite refuses it with "Blocked',
  '  request. This host is not allowed" and players see an error instead',
  '  of the game. `--host 0.0.0.0` alone is NOT enough.',
  '- Run vite from the game directory so the game itself is at the root',
  '  path (`/`), not behind a directory listing.',
  '- Register that dev server as a daemon (use your daemon launcher skill) so',
  '  it stays up and gets a preview URL. Players see the game in an iframe',
  '  pointed at that URL.',
  '- Verify hosting through the PUBLIC hostname, not just localhost: the',
  '  allowedHosts check only rejects foreign Host headers, so localhost',
  '  fetches pass even when the tunnel is blocked. After registering the',
  '  daemon, run:',
  '',
  '    curl -s -H "Host: preview.tunnel.runloop.ai" http://localhost:<port>/',
  '',
  '  and confirm the response is your game HTML. If it contains "Blocked',
  '  request", fix vite.config.ts, restart the daemon, and re-verify before',
  '  ending the turn.',
  '- Keep the daemon running across turns; Vite HMR picks up your edits. If',
  '  it dies, restart it before ending the turn.',
  '',
  'Multiplayer (only when the game calls for it):',
  '- The tunnel exposes exactly ONE port. Attach any realtime backend to the',
  '  same Vite dev server: a plugin whose configureServer hook hangs a',
  "  WebSocket server off Vite's own HTTP server (`server.httpServer`,",
  '  `noServer: true` + an `upgrade` listener) on a path HMR does not use,',
  '  e.g. `/game-ws`.',
  '- Never listen on a second port — the iframe cannot reach it. The page',
  '  connects back to its own origin: `wss://` + location.host + the path.',
  '- Keep the shared state in the plugin module (it lives as long as the dev',
  '  server) and make joining instant: no lobbies unless asked, new visitors',
  '  spawn straight into the running world.',
  '',
  'Arcade art — always:',
  "- Ship two art files, served by the dev server from the game's public",
  '  dir (`public/arcade/` in a Vite project):',
  '  - `/arcade/icon.svg` — a square logo mark. Bold flat shapes in the',
  "    game's palette, readable at 24px; it sits next to the title.",
  '  - `/arcade/preview.svg` — wide 16:9 cover art (1280x720 viewBox) for',
  "    the game's tile on the arcade shelf.",
  '- Hand-author them as SVG — no image tooling needed. PNG at the same',
  '  paths also works. Create both in the first build, and redraw them',
  "  whenever the game's look changes materially; the arcade picks up",
  '  changes automatically after each turn.',
  '- Also ship `/arcade/preview-anim.svg`: a LOOPING, animated take on the',
  '  cover (SMIL `<animate>`/`<animateTransform>` or CSS keyframes inside',
  "  the SVG — both play inside an <img>). Show the game's motion: this is",
  '  what players see when they hover the tile. Keep it under ~300KB and',
  '  make the loop seamless.',
  '- Verify before ending the first turn: fetch `/arcade/icon.svg`,',
  '  `/arcade/preview.svg`, and `/arcade/preview-anim.svg` from the dev',
  '  server and confirm each returns the SVG, not a 404 or an HTML error',
  '  page.',
  '',
  'Phones — always. Most players are on one, and the game fills their whole',
  'screen inside the arcade iframe. A game that needs a keyboard is a game',
  'they cannot play at all:',
  '- Every action must be reachable by touch. Taps, drags, and swipes on the',
  '  play surface, or on-screen controls you draw yourself (a d-pad, buttons,',
  '  a thumb stick). Keyboard and mouse stay for desktop — they are never the',
  '  only way in. If the idea is keyboard-shaped (arrows, WASD, spacebar),',
  '  design the touch scheme in the same turn, not later.',
  '- Size the play surface to its container, not to fixed pixels. Re-layout',
  '  on `resize` and `orientationchange`, and scale a <canvas> by',
  '  devicePixelRatio so it is sharp rather than blurry. Portrait and',
  '  landscape must both be playable; portrait is the common one.',
  '- Do not let the page fight the player: `touch-action: none` on the play',
  '  surface (so dragging does not scroll or double-tap-zoom the page),',
  '  `overscroll-behavior: contain`, and no hover-only affordances — there',
  '  is no hover on a phone.',
  '- Touch targets at least 44px, and text legible at arm’s length on a',
  '  small screen. Explain the controls on screen, naming the touch ones.',
  '- Before ending a turn, check the game at a phone-sized viewport (about',
  '  390x660) and confirm it is playable with touch alone — with a browser',
  '  tool if you have one, otherwise by reading your own layout and input',
  '  code against the rules above.',
  '',
  'Gameplay bar: the game must render at any viewport size (it is embedded in',
  'an iframe) and be playable immediately, with controls explained on screen.',
  '',
  'Player suggestions arrive as follow-up messages, one at a time. Implement',
  'each one and end every turn with a one-paragraph summary of what changed.',
].join('\n');

/**
 * The initial build brief: the standing rules live in the system prompt,
 * so this is just the game itself.
 */
export function buildGamePrompt(title: string, idea: string): string {
  return [
    `Build a small browser game called "${title}".`,
    '',
    `Game idea: ${idea}`,
    '',
    'Set up the project, get the dev-server daemon registered, ship the',
    'arcade art files (/arcade/icon.svg and /arcade/preview.svg), and reply',
    'with a short summary of the game and how to play it.',
    '',
    'Make it playable with touch on a phone from the first build — that is',
    'where most players are, and retrofitting an input scheme is worse than',
    'designing one. Say in your summary how it plays on a phone.',
    '',
    'Before registering the daemon, double-check vite.config.ts sets',
    'server: { host: "0.0.0.0", allowedHosts: true } — without both, the',
    'arcade iframe gets a blocked-request page instead of the game.',
  ].join('\n');
}

/**
 * Corrective turn the watcher sends when the daemon answers the tunnel
 * hostname with Vite's blocked-host page instead of the game.
 */
export function hostFixPrompt(daemonUrl: string): string {
  return [
    'Hosting problem — players currently see an error instead of your game.',
    `Fetching ${daemonUrl} returns Vite's "Blocked request. This host is`,
    'not allowed" page: the dev server is refusing the arcade preview',
    'hostname.',
    '',
    'Fix it now:',
    '- Set BOTH options in vite.config.ts:',
    '',
    '    server: { host: "0.0.0.0", allowedHosts: true },',
    '',
    '- Restart the dev-server daemon so the config applies (kill the old',
    '  process holding the port first if you hit EADDRINUSE).',
    `- Verify through the public URL: fetch ${daemonUrl} and confirm the`,
    '  response is the game HTML, not the blocked-request page.',
    '',
    'End the turn with one line confirming the public URL serves the game.',
  ].join('\n');
}

/**
 * Message for one approved player suggestion. The turn is only marked done
 * when it ends, so the prompt insists the agent verify its own work and
 * keep going until the suggestion demonstrably works.
 */
export function suggestionPrompt(
  authorName: string,
  body: string,
  needsArt = false,
  ownerNote: string | null = null,
): string {
  // Games built before the art/hosting rules heal themselves: while art is
  // missing, every dispatched turn carries the housekeeping appendix.
  const housekeeping = needsArt
    ? [
        '',
        'Housekeeping for this game (same turn, after the suggestion):',
        '- The arcade is missing cover art for this game. Create whichever of',
        '  `public/arcade/icon.svg`, `public/arcade/preview.svg`, and the',
        '  looping animated `public/arcade/preview-anim.svg` do not exist yet,',
        '  per your system prompt, and verify the dev server serves them.',
        '- Confirm vite.config.ts sets `server: { host: "0.0.0.0",',
        '  allowedHosts: true }` — the game is embedded through a tunnel',
        '  hostname that Vite otherwise blocks.',
      ]
    : [];
  return [
    `Player suggestion from ${authorName} (top of the room's queue):`,
    '',
    body,
    // The owner's note steers how the suggestion should be built.
    ...(ownerNote ? ['', `Note from the game owner: ${ownerNote}`] : []),
    '',
    'Implement this suggestion now, then verify it before ending your turn:',
    '',
    '- Run the project checks if it has any (typecheck/build).',
    '- Confirm the running game still serves: fetch the dev-server URL and',
    '  check the response is the game, not an error page.',
    '- Exercise the changed behavior the way a player would reach it, and',
    '  confirm it does what the suggestion asked.',
    '',
    'If verification fails, keep fixing and re-verifying — do not end the',
    'turn until the suggestion demonstrably works. Keep the dev-server',
    'daemon running the whole time. If you are genuinely blocked, end the',
    'turn with a line starting "BLOCKED:" and the reason. Otherwise end with',
    'a one-paragraph summary of what changed and how you verified it.',
    ...housekeeping,
  ].join('\n');
}
