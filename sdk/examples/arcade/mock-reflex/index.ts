/**
 * Mock Reflex server for offline runs of the arcade demo.
 *
 * Implements just the surface the arcade touches — `POST/GET /api/agents`,
 * `GET /api/agents/:id/stream`, `POST /api/agents/:id/message`, and the
 * `/api/ws` subscribe protocol — with a simulated agent: it "builds" the
 * game for a few seconds, registers a daemon whose URL serves a tiny
 * playable page from this process, then answers each message with a short
 * turn. Any bearer token is accepted.
 *
 *   npm run dev:mock            # listens on http://localhost:8791
 *   REFLEX_BASE_URL=http://localhost:8791 npm run dev:server
 */
import Fastify from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.MOCK_REFLEX_PORT ?? 8791);

/**
 * Base for the daemon "preview" URLs handed to the arcade. Default is this
 * server's own origin; set MOCK_PLAY_BASE='' to emit relative `/play/...`
 * URLs, which the arcade web app proxies — that keeps the iframe working
 * when the app is viewed through a tunnel where `localhost` is not this box.
 */
const PLAY_BASE = process.env.MOCK_PLAY_BASE ?? `http://localhost:${PORT}`;

/**
 * Base for the approval page the arcade sends players to (the mock's stand-in
 * for Reflex's `/connect`). Same trick as PLAY_BASE: set MOCK_APP_BASE='' to
 * emit a relative `/mock-connect` URL, which the web app's dev proxy forwards
 * here — so the flow also works through a tunnel.
 */
const APP_BASE = process.env.MOCK_APP_BASE ?? `http://localhost:${PORT}`;

/**
 * A quiet stretch in the middle of a suggestion turn, in ms. Real agents go
 * silent for minutes during a long build or model call, and the dispatcher
 * must not read that as a hung turn — set this to reproduce it offline.
 */
const QUIET_MS = Number(process.env.MOCK_QUIET_TURN_MS ?? 0);

/**
 * How long the agent sits on a message before it emits anything at all.
 * Real agents take a while to wake a devbox and start thinking, and during
 * that window the stream's newest event is still the PREVIOUS turn's end —
 * the state that made a restarted watcher re-send live work.
 */
const START_DELAY_MS = Number(process.env.MOCK_TURN_START_DELAY_MS ?? 0);

interface MockEvent {
  id: string;
  sequence: number;
  streamId: string;
  type: string;
  payload: unknown;
  timestamp: number;
  origin?: string;
}

interface MockDaemon {
  name: string;
  port?: number;
  url: string;
  startedAt: number;
}

interface MockAgent {
  id: string;
  streamId: string;
  agentType: string;
  status: string;
  devboxId: string;
  name: string;
  prompt: string;
  systemPrompt: string | null;
  model: string | null;
  /** The model-provider key the launch pinned, if any. */
  providerSecretId: string | null;
  createdAt: number;
  archived: boolean;
  pinned: boolean;
  organizationId: string;
  daemons: MockDaemon[];
  events: MockEvent[];
  sequence: number;
  turns: number;
  /** First lines of implemented player suggestions, for the play page. */
  changelog: string[];
  /** Bumped on interrupt; in-flight simulated turns bail when it changes. */
  turnGeneration: number;
}

const agents = new Map<string, MockAgent>();
const subscribers = new Map<string, Set<WebSocket>>();

const rand = (n: number) => randomBytes(n).toString('hex');

function emit(agent: MockAgent, type: string, payload: unknown, origin?: string): MockEvent {
  const event: MockEvent = {
    id: `evt_${rand(8)}`,
    sequence: ++agent.sequence,
    streamId: agent.streamId,
    type,
    payload,
    timestamp: Date.now(),
    ...(origin ? { origin } : {}),
  };
  agent.events.push(event);
  const frame = JSON.stringify({ type: 'event', event });
  for (const socket of subscribers.get(agent.streamId) ?? []) {
    if (socket.readyState === socket.OPEN) socket.send(frame);
  }
  return event;
}

function setStatus(agent: MockAgent, status: string): void {
  agent.status = status;
  emit(agent, 'agent.status_change', { status });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Stream dialects ─────────────────────────────────────────────────────────
//
// Reflex streams speak the agent's own protocol. `claude-code` (and the
// other brokers) use the flat events below; `codex` speaks the native Codex
// app-server dialect — raw JSON-RPC frames whose event type IS the method
// and whose content sits under `params`. The arcade renders both through the
// chat kit, so the mock emits whichever one the agent type would.

function isCodex(agent: MockAgent): boolean {
  return agent.agentType === 'codex';
}

/** One native Codex JSON-RPC notification. */
function codexFrame(
  agent: MockAgent,
  method: string,
  params: Record<string, unknown>,
  origin?: string,
): MockEvent {
  return emit(agent, method, { jsonrpc: '2.0', method, params }, origin);
}

/** A prompt someone sent to the agent. */
function emitUserPrompt(agent: MockAgent, text: string): MockEvent {
  return isCodex(agent)
    ? codexFrame(agent, 'turn/start', { input: [{ type: 'text', text }] }, 'USER_EVENT')
    : emit(agent, 'message', { message: text }, 'USER_EVENT');
}

function emitTurnStarted(agent: MockAgent): void {
  if (isCodex(agent)) codexFrame(agent, 'turn/started', { turn: { id: `turn_${rand(4)}` } });
  else emit(agent, 'turn.started', { turn: agent.turns + 1 });
}

function emitTurnCompleted(agent: MockAgent): void {
  if (isCodex(agent)) {
    agent.turns++;
    codexFrame(agent, 'turn/completed', { turn: { status: 'completed', durationMs: 2_000 } });
    return;
  }
  emit(agent, 'turn.completed', { turn: ++agent.turns });
}

/** A message from the agent: streamed in two chunks, then finalized. */
function emitAgentText(agent: MockAgent, text: string): void {
  if (!isCodex(agent)) {
    emit(agent, 'assistant', { message: text });
    return;
  }
  const itemId = `item_${rand(4)}`;
  const split = Math.ceil(text.length / 2);
  codexFrame(agent, 'item/agentMessage/delta', { itemId, delta: text.slice(0, split) });
  codexFrame(agent, 'item/agentMessage/delta', { itemId, delta: text.slice(split) });
  codexFrame(agent, 'item/completed', { item: { id: itemId, type: 'agentMessage', text } });
}

/** A tool_call followed by its completion update, like a real agent turn. */
async function toolCall(
  agent: MockAgent,
  name: string,
  input: Record<string, string>,
  ms: number,
): Promise<void> {
  const id = `call_${rand(6)}`;
  if (isCodex(agent)) {
    // Codex reports work as thread items: a shell command, or a file edit.
    const item = input.command
      ? { id, type: 'commandExecution', command: input.command, cwd: '/home/user/game' }
      : { id, type: 'fileChange', changes: [{ path: input.path ?? '', diff: '@@' }] };
    codexFrame(agent, 'item/started', { item });
    await wait(ms);
    codexFrame(agent, 'item/completed', { item: { ...item, status: 'completed', exitCode: 0 } });
    return;
  }
  emit(agent, 'tool_call', { id, name, input });
  await wait(ms);
  emit(agent, 'tool_call_update', { id, status: 'completed' });
}

/** The agent thinking out loud (Codex streams reasoning; the others don't). */
function emitReasoning(agent: MockAgent, text: string): void {
  if (!isCodex(agent)) return;
  const itemId = `item_${rand(4)}`;
  codexFrame(agent, 'item/reasoning/summaryTextDelta', { itemId, delta: text });
  codexFrame(agent, 'item/completed', {
    item: { id: itemId, type: 'reasoning', summary: [text], content: [] },
  });
}

/** Initial build: plan, tool calls, daemon registration, then idle. */
async function simulateBuild(agent: MockAgent): Promise<void> {
  const generation = agent.turnGeneration;
  const cancelled = () => agent.turnGeneration !== generation;
  await wait(300);
  if (cancelled()) return;
  setStatus(agent, 'running');
  emit(agent, 'devbox.running', { status: 'running' });
  emitTurnStarted(agent);
  emit(agent, 'agent.plan', {
    message: 'Scaffold a small web game, start its dev server as a daemon, summarize how to play.',
  });
  emitReasoning(agent, 'Pick a tiny game loop that reads well in an iframe.');
  emitAgentText(agent, 'Reading the game idea and scaffolding the project...');
  await toolCall(agent, 'Write', { path: 'game/index.html' }, 500);
  await toolCall(agent, 'Write', { path: 'game/src/main.ts' }, 500);
  await toolCall(agent, 'Bash', { command: 'npm install && npm run dev &' }, 900);
  if (cancelled()) return;
  emitAgentText(agent, 'Dev server is up — registering it as a daemon.');
  agent.daemons = [
    {
      name: 'game-dev',
      port: PORT,
      url: `${PLAY_BASE}/play/${agent.id}`,
      startedAt: Date.now(),
    },
  ];
  emit(agent, 'agent.daemon_started', { name: 'game-dev', url: agent.daemons[0]!.url });
  await wait(600);
  emitAgentText(
    agent,
    'The game is up! Catch the dot before it escapes — every click scores a point. ' +
      'Send suggestions and I will keep building.',
  );
  emitTurnCompleted(agent);
  setStatus(agent, 'needs_input');
}

/** One suggestion turn: acknowledge, edit files, then go idle again. */
async function simulateTurn(agent: MockAgent, message: string): Promise<void> {
  const generation = agent.turnGeneration;
  const cancelled = () => agent.turnGeneration !== generation;
  await wait(200 + START_DELAY_MS);
  if (cancelled()) return;
  setStatus(agent, 'running');
  emitTurnStarted(agent);
  const headline = message.split('\n').find((l) => l.trim()) ?? message;
  emitReasoning(agent, `Work out the smallest edit that delivers: ${headline.slice(0, 80)}`);
  emitAgentText(agent, `On it: ${headline.slice(0, 120)}`);
  await toolCall(agent, 'Edit', { path: 'game/src/main.ts' }, 900);
  if (cancelled()) return;
  // The long, silent middle of a real turn.
  if (QUIET_MS > 0) await wait(QUIET_MS);
  if (cancelled()) return;
  await toolCall(agent, 'Bash', { command: 'npm run typecheck' }, 700);
  if (cancelled()) return;
  // Remember the suggestion body for the play page changelog. Suggestion
  // prompts look like: "Player suggestion from X:\n\n<body>\n\n..."
  const lines = message.split('\n').map((l) => l.trim());
  if (lines[0]?.startsWith('Player suggestion from')) {
    const body = lines.slice(1).find((l) => l.length > 0);
    if (body) agent.changelog.push(body.slice(0, 80));
  }
  await wait(700);
  if (cancelled()) return;
  emitAgentText(
    agent,
    `Done — shipped in v${agent.turns + 1}. The dev server picked it up automatically.`,
  );
  emitTurnCompleted(agent);
  setStatus(agent, 'needs_input');
}

const app = Fastify({ logger: false });

app.post('/api/agents', async (req) => {
  const body = req.body as {
    name?: string;
    agentType?: string;
    prompt?: string;
    systemPrompt?: string;
    model?: string;
    providerSecretId?: string;
  };
  const agent: MockAgent = {
    id: `agent_${rand(8)}`,
    streamId: `strm_${rand(8)}`,
    agentType: body.agentType ?? 'claude-code',
    status: 'starting',
    devboxId: `dbx_${rand(6)}`,
    name: body.name ?? 'mock agent',
    prompt: body.prompt ?? '',
    systemPrompt: body.systemPrompt ?? null,
    model: body.model ?? null,
    // Echoed back so an offline run can check the arcade actually pinned
    // the key the player picked.
    providerSecretId: body.providerSecretId ?? null,
    createdAt: Date.now(),
    archived: false,
    pinned: false,
    organizationId: 'org_mock',
    daemons: [],
    events: [],
    sequence: 0,
    turns: 0,
    changelog: [],
    turnGeneration: 0,
  };
  agents.set(agent.id, agent);
  emit(agent, 'agent.started', {});
  if (agent.prompt) emitUserPrompt(agent, agent.prompt);
  void simulateBuild(agent);
  return agent;
});

app.get('/api/agents', async () => ({ agents: [...agents.values()], nextCursor: null }));

app.get('/api/agents/:id', async (req, reply) => {
  const agent = agents.get((req.params as { id: string }).id);
  if (!agent) return reply.status(404).send({ error: 'not_found', message: 'No such agent.' });
  return agent;
});

app.get('/api/agents/:id/stream', async (req, reply) => {
  const agent = agents.get((req.params as { id: string }).id);
  if (!agent) return reply.status(404).send({ error: 'not_found', message: 'No such agent.' });
  return agent.events;
});

app.post('/api/agents/:id/message', async (req, reply) => {
  const agent = agents.get((req.params as { id: string }).id);
  if (!agent) return reply.status(404).send({ error: 'not_found', message: 'No such agent.' });
  const body = req.body as {
    message?: string;
    content?: ({ type: 'text'; text: string } | { type: string; name?: string })[];
  };
  // Accept both plain text and content blocks, like the real API.
  const blocks = body.content ?? [];
  const text =
    body.message ??
    blocks
      .map((b) =>
        'text' in b && b.type === 'text'
          ? b.text
          : `[${b.type}: ${'name' in b ? (b.name ?? '') : ''}]`,
      )
      .join('\n');
  const event = emitUserPrompt(agent, text);
  void simulateTurn(agent, text);
  return reply.status(201).send(event);
});

// Test hook: freeze the agent mid-"turn" — status stays running, the sim
// turn dies, and the devbox reports suspended (the stale-running scenario).
app.post('/api/agents/:id/simulate-stall', async (req, reply) => {
  const agent = agents.get((req.params as { id: string }).id);
  if (!agent) return reply.status(404).send({ error: 'not_found', message: 'No such agent.' });
  agent.turnGeneration++; // kill any simulated turn mid-flight
  setStatus(agent, 'running');
  emit(agent, 'devbox.suspended', { reason: 'idle' });
  return { agent };
});

// Full teardown, like the real DELETE /agents/:id: the agent disappears
// and subsequent GETs 404.
app.delete('/api/agents/:id', async (req, reply) => {
  const agent = agents.get((req.params as { id: string }).id);
  if (!agent) return reply.status(404).send({ error: 'not_found', message: 'No such agent.' });
  agent.turnGeneration++;
  agents.delete(agent.id);
  return { ok: true };
});

app.post('/api/agents/:id/stop', async (req, reply) => {
  const agent = agents.get((req.params as { id: string }).id);
  if (!agent) return reply.status(404).send({ error: 'not_found', message: 'No such agent.' });
  agent.turnGeneration++;
  emit(agent, 'agent.stopped', {});
  setStatus(agent, 'stopped');
  return { agent };
});

app.post('/api/agents/:id/interrupt', async (req, reply) => {
  const agent = agents.get((req.params as { id: string }).id);
  if (!agent) return reply.status(404).send({ error: 'not_found', message: 'No such agent.' });
  // Cancel whatever simulated turn is in flight, like the real API.
  agent.turnGeneration++;
  if (agent.status === 'running' || agent.status === 'starting') {
    emit(agent, 'turn.cancelled', { reason: 'interrupted' });
    setStatus(agent, 'needs_input');
  }
  return reply.status(200).send();
});

app.get('/api/me/api-keys', async () => ({ keys: [] }));

// -- device authorization ("connect with reflex") -------------------------
//
// The arcade's connect button drives the real flow, so the mock serves both
// halves: the two public endpoints the arcade polls, and a stand-in for the
// approval page the player is sent to (Reflex's own `/connect`, which needs
// a web session this mock has no notion of).
//
// The page's approve/deny actions hang off `/mock-connect/*` rather than
// Reflex's `/api/device/*`. That prefix is the one the web app's dev proxy
// forwards here, so the page works both when it is served from this origin
// and when it is served relative (MOCK_APP_BASE='') through a tunnel —
// where `/api/...` belongs to the arcade's own API.

interface MockDevice {
  deviceCode: string;
  userCode: string;
  clientName: string | null;
  status: 'pending' | 'approved' | 'denied';
  apiKey?: string;
  organizationId?: string;
}

const devices = new Map<string, MockDevice>();
const deviceByUserCode = new Map<string, string>();

app.post('/api/auth/device/start', async (req, reply) => {
  const body = (req.body ?? {}) as { clientName?: string; hostname?: string };
  const entry: MockDevice = {
    deviceCode: rand(32),
    userCode: `${rand(2).slice(0, 4).toUpperCase()}-${rand(2).slice(0, 4).toUpperCase()}`,
    clientName: body.clientName ?? null,
    status: 'pending',
  };
  devices.set(entry.deviceCode, entry);
  deviceByUserCode.set(entry.userCode, entry.deviceCode);
  const verificationUri = `${APP_BASE}/mock-connect`;
  return reply.status(201).send({
    deviceCode: entry.deviceCode,
    userCode: entry.userCode,
    verificationUri,
    verificationUriComplete: `${verificationUri}?code=${entry.userCode}`,
    interval: 1,
    expiresIn: 600,
  });
});

app.post('/api/auth/device/token', async (req, reply) => {
  const { deviceCode } = (req.body ?? {}) as { deviceCode?: string };
  const entry = deviceCode ? devices.get(deviceCode) : undefined;
  if (!entry) {
    return reply.status(400).send({ error: 'expired_token', error_description: 'Unknown code' });
  }
  if (entry.status === 'denied') {
    return reply.status(400).send({ error: 'access_denied', error_description: 'Denied' });
  }
  if (entry.status === 'pending')
    return reply.status(202).send({ status: 'authorization_pending' });
  devices.delete(entry.deviceCode);
  deviceByUserCode.delete(entry.userCode);
  return reply.send({
    status: 'approved',
    apiKey: entry.apiKey,
    organizationId: entry.organizationId,
  });
});

app.post('/mock-connect/approve', async (req, reply) => {
  const { code, organizationId } = (req.body ?? {}) as { code?: string; organizationId?: string };
  const entry = code ? devices.get(deviceByUserCode.get(code) ?? '') : undefined;
  if (!entry || entry.status !== 'pending') {
    return reply.status(404).send({ error: 'unknown_code', error_description: 'Unknown code' });
  }
  entry.status = 'approved';
  entry.apiKey = `rfx_mock_${rand(12)}`;
  entry.organizationId = organizationId ?? 'org_mock';
  return reply.send({ status: 'approved' });
});

app.post('/mock-connect/deny', async (req, reply) => {
  const { code } = (req.body ?? {}) as { code?: string };
  const entry = code ? devices.get(deviceByUserCode.get(code) ?? '') : undefined;
  if (!entry || entry.status !== 'pending') {
    return reply.status(404).send({ error: 'unknown_code', error_description: 'Unknown code' });
  }
  entry.status = 'denied';
  return reply.send({ status: 'denied' });
});

/**
 * Escape text before it goes into this page's markup. Everything the page
 * shows was supplied by some caller (the app's name, the code in the URL),
 * and a page that builds HTML out of caller input is an XSS hole even when
 * it is only a local stand-in.
 */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);

/** Stand-in for Reflex's approval page: show the code, approve or deny. */
app.get('/mock-connect', async (req, reply) => {
  const requestedCode = (req.query as { code?: string }).code ?? '';
  const entry = devices.get(deviceByUserCode.get(requestedCode) ?? '');
  // Echo the code this server minted, never the one in the URL: an unknown
  // code has no page to show anyway, so there is nothing to reflect.
  const code = escapeHtml(entry?.userCode ?? '');
  const client = escapeHtml(entry?.clientName ?? 'An app');
  reply.header('content-type', 'text/html; charset=utf-8');
  return reply.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Connect an app (mock Reflex)</title>
<style>
 body{background:#09090b;color:#e4e4e7;font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}
 .card{border:1px solid #27272a;border-radius:14px;padding:28px;max-width:420px;background:#111113}
 h1{font-size:19px;margin:0 0 6px}
 p{color:#a1a1aa;margin:0 0 14px}
 code{font-size:22px;letter-spacing:.3em;color:#c4b5fd}
 button{border:0;border-radius:9px;padding:9px 14px;font-weight:600;cursor:pointer;margin-right:8px}
 .go{background:#7c3aed;color:#fff} .no{background:#27272a;color:#d4d4d8}
 select{background:#09090b;color:#e4e4e7;border:1px solid #3f3f46;border-radius:8px;padding:8px;margin-bottom:16px;width:100%}
</style></head>
<body><div class="card">
  <h1>${entry ? 'Connect an app' : 'Unknown code'}</h1>
  ${
    entry
      ? `<p>${client} is asking to use your Reflex account. Approving creates an API key for it.</p>
         <p><code id="code">${code}</code></p>
         <select id="org">
           <option value="org_mock">Mock Org (mock-org)</option>
           <option value="org_mock2">Second Org (second-org)</option>
         </select>
         <button class="go" onclick="send('approve')">Approve</button>
         <button class="no" onclick="send('deny')">Deny</button>
         <p id="out" style="margin-top:14px"></p>
         <script>
           async function send(action) {
             const body = {
               code: document.getElementById('code').textContent,
               organizationId: document.getElementById('org').value,
             };
             await fetch('/mock-connect/' + action, {
               method: 'POST',
               headers: { 'content-type': 'application/json' },
               body: JSON.stringify(body),
             });
             document.getElementById('out').textContent =
               action === 'approve' ? 'Approved. Return to the arcade.' : 'Denied.';
           }
         </script>`
      : '<p>This code is invalid or expired. Start the connection again.</p>'
  }
</div></body></html>`);
});

/** One `ModelProviderSecret`-shaped row, with the boring fields defaulted. */
function mockSecret(overrides: {
  id: string;
  scope: 'user' | 'team' | 'org';
  provider: string;
  type?: 'apiKey' | 'subscription';
  name?: string;
  ownerId?: string | null;
}) {
  return {
    organizationId: 'org_mock',
    ownerId: 'user_mock',
    type: 'apiKey',
    name: 'Personal key',
    secretId: 'sec_mock0000000000000001',
    tokenExpiresAt: null,
    baseUrl: null,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    ...overrides,
  };
}

/** Orgs the caller's key belongs to — membership-shaped like the real API. */
app.get('/api/organizations', async () => ({
  organizations: [
    {
      memberId: 'member_mock1',
      organization: { id: 'org_mock', slug: 'mock-org', name: 'Mock Org' },
      roles: [],
      permissions: [],
      teams: [],
    },
    {
      memberId: 'member_mock2',
      organization: { id: 'org_mock2', slug: 'second-org', name: 'Second Org' },
      roles: [],
      permissions: [],
      teams: [],
    },
  ],
}));

/**
 * Provider keys the caller can launch with, folded across tiers like the real
 * `GET /me/model-provider-secrets/accessible`. The subscription row is
 * deliberately Anthropic-only so the arcade's key list has both a supported
 * and an unsupported ("Subscription not supported" on OpenAI) case offline.
 */
app.get('/api/me/model-provider-secrets/accessible', async () => ({
  secrets: [
    mockSecret({ id: 'mps_mock000000000000000001', scope: 'user', provider: 'anthropic' }),
    mockSecret({
      id: 'mps_mock000000000000000002',
      scope: 'user',
      provider: 'anthropic',
      type: 'subscription',
      name: 'default',
    }),
    mockSecret({
      id: 'mps_mock000000000000000003',
      scope: 'org',
      provider: 'anthropic',
      name: 'Org Anthropic',
      ownerId: null,
    }),
  ],
}));

/**
 * Launch catalog, shaped like the real `GET /config/agent-model-support`:
 * claude-code is multi-model with an anthropic provider (key available) and
 * an openai provider (no key); codex is a single-model agent type.
 */
app.get('/api/config/agent-model-support', async () => ({
  defaultAgentType: 'claude-code',
  launchableAgents: [
    { agentType: 'claude-code', displayName: 'Claude Code', multiModel: true, enabled: true },
    { agentType: 'codex', displayName: 'Codex', multiModel: false, enabled: true },
    { agentType: 'opencode-cli', displayName: 'OpenCode', multiModel: true, enabled: false },
  ],
  agents: {
    'claude-code': {
      status: 'available',
      agentType: 'claude-code',
      displayName: 'Claude Code',
      providers: [
        { id: 'anthropic', displayName: 'Anthropic', keyTypes: ['apiKey', 'subscription'] },
        { id: 'openai', displayName: 'OpenAI', keyTypes: ['apiKey'] },
      ],
      endpoints: [
        {
          id: 'anthropic-api',
          displayName: 'Anthropic API',
          envVars: [],
          availability: { available: true, reasons: [], missingEnvVars: [] },
        },
        {
          id: 'openai-api',
          displayName: 'OpenAI API',
          envVars: [],
          availability: {
            available: false,
            reasons: ['credential_status_unknown'],
            missingEnvVars: [],
          },
        },
      ],
      providerEndpoints: [
        { providerId: 'anthropic', modelEndpointId: 'anthropic-api' },
        { providerId: 'openai', modelEndpointId: 'openai-api' },
      ],
      defaultEndpoint: 'anthropic-api',
      defaultProvider: 'anthropic',
      defaultModel: 'claude-sonnet-5',
      discovery: { method: 'static' },
      discoveryStatus: 'ready',
      discoveredModels: [
        { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', providerId: 'anthropic' },
        { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', providerId: 'anthropic' },
        { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', providerId: 'anthropic' },
        { id: 'gpt-5.2-codex', displayName: 'GPT-5.2 Codex', providerId: 'openai' },
      ],
    },
  },
}));

/**
 * The "daemon": a tiny catch-the-dot game, one per agent. The changelog
 * panel lists implemented player suggestions, so each turn visibly changes
 * the page — a stand-in for a real agent editing a real game.
 */
// Arcade art contract: the "game" ships an icon + wide preview, exactly as
// the real system prompt asks agents to.
function artHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

app.get('/play/:id/arcade/:file', async (req, reply) => {
  const { id, file } = req.params as { id: string; file: string };
  const agent = agents.get(id);
  if (!agent) return reply.code(404).send({ message: 'unknown agent' });
  const hue = artHue(id);
  if (file === 'icon.svg') {
    return reply
      .type('image/svg+xml')
      .send(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">` +
          `<rect width="256" height="256" rx="56" fill="hsl(${hue} 70% 30%)"/>` +
          `<circle cx="128" cy="118" r="58" fill="hsl(${(hue + 60) % 360} 90% 60%)"/>` +
          `<rect x="76" y="176" width="104" height="22" rx="11" fill="white" opacity="0.85"/>` +
          `</svg>`,
      );
  }
  if (file === 'preview-anim.svg') {
    return reply
      .type('image/svg+xml')
      .send(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">` +
          `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
          `<stop offset="0" stop-color="hsl(${hue} 75% 24%)"/>` +
          `<stop offset="1" stop-color="hsl(${(hue + 80) % 360} 80% 38%)"/>` +
          `</linearGradient></defs>` +
          `<rect width="1280" height="720" fill="url(#g)"/>` +
          `<circle cy="360" r="70" fill="hsl(${(hue + 60) % 360} 90% 60%)">` +
          `<animate attributeName="cx" values="140;1140;140" dur="3s" repeatCount="indefinite"/>` +
          `</circle>` +
          `<circle cx="640" cy="360" r="40" fill="white" opacity="0.85">` +
          `<animate attributeName="r" values="40;90;40" dur="1.5s" repeatCount="indefinite"/>` +
          `</circle>` +
          `<text x="80" y="640" font-family="monospace" font-size="110" font-weight="bold" fill="white" opacity="0.9">MOCK LIVE</text>` +
          `</svg>`,
      );
  }
  if (file === 'preview.svg') {
    return reply
      .type('image/svg+xml')
      .send(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">` +
          `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
          `<stop offset="0" stop-color="hsl(${hue} 75% 24%)"/>` +
          `<stop offset="1" stop-color="hsl(${(hue + 80) % 360} 80% 38%)"/>` +
          `</linearGradient></defs>` +
          `<rect width="1280" height="720" fill="url(#g)"/>` +
          `<circle cx="1020" cy="180" r="140" fill="hsl(${(hue + 60) % 360} 90% 60%)" opacity="0.9"/>` +
          `<text x="80" y="560" font-family="monospace" font-size="150" font-weight="bold" fill="white" opacity="0.92">MOCK</text>` +
          `</svg>`,
      );
  }
  return reply.code(404).send({ message: 'no such art' });
});

app.get('/play/:id', async (req, reply) => {
  const agent = agents.get((req.params as { id: string }).id);
  const title = agent?.name?.replace(/^arcade: /, '') ?? 'mock game';
  const version = (agent?.turns ?? 0) + 1;
  // Also escapes quotes: some of this lands in attributes, not just text.
  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const changelog = (agent?.changelog ?? [])
    .slice(-6)
    .map((entry) => `<li>${escapeHtml(entry)}</li>`)
    .join('');
  // The arcade hands every game the player in the frame URL so it never has
  // to ask for a name (see `web/src/lib/game-frame.ts`). The mock game reads
  // them like a real one would, including the guest fallback for anyone who
  // opened this URL directly.
  const query = req.query as Record<string, string | undefined>;
  const player = (query['arcade_player'] ?? 'Guest').slice(0, 40);
  const avatar = query['arcade_avatar'];
  const role = query['arcade_role'] === 'owner' ? ' (owner)' : '';
  return reply.type('text/html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { margin:0; font-family:system-ui; background:#0f0f13; color:#eee; overflow:hidden }
  #hud { position:fixed; top:12px; left:16px; font-size:14px; opacity:.85 }
  #log { position:fixed; bottom:12px; left:16px; font-size:11px; opacity:.6; max-width:40ch }
  #who { position:fixed; top:12px; right:16px; display:flex; align-items:center; gap:8px;
         font-size:13px; opacity:.85 }
  #who img { border-radius:50% }
  #log ul { margin:4px 0 0; padding-left:16px }
  #dot { position:absolute; width:36px; height:36px; border-radius:50%;
         background:radial-gradient(circle at 30% 30%, #c4b5fd, #7c3aed);
         cursor:pointer; transition:left .5s ease, top .5s ease; }
</style></head>
<body>
  <div id="hud">${escapeHtml(title)} · v${version} · score <span id="score">0</span></div>
  <div id="who">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" width="22" height="22">` : ''}<span>playing as ${escapeHtml(player)}${role}</span></div>
  <div id="dot"></div>
  ${changelog ? `<div id="log">shipped suggestions<ul>${changelog}</ul></div>` : ''}
  <script>
    const dot = document.getElementById('dot');
    const scoreEl = document.getElementById('score');
    let score = 0;
    function move() {
      dot.style.left = Math.random() * (innerWidth - 60) + 'px';
      dot.style.top = 20 + Math.random() * (innerHeight - 80) + 'px';
    }
    dot.addEventListener('click', () => { scoreEl.textContent = ++score; move(); });
    setInterval(move, 1400);
    move();
  </script>
</body></html>`);
});

await app.ready();

const wss = new WebSocketServer({ noServer: true });
app.server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://mock.local');
  if (url.pathname !== '/api/ws' || !url.searchParams.get('token')) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const mine = new Set<string>();
    ws.on('message', (raw) => {
      let frame: { type?: string; streamId?: string };
      try {
        frame = JSON.parse(String(raw)) as typeof frame;
      } catch {
        return;
      }
      if (frame.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      if (frame.type === 'subscribe' && frame.streamId) {
        let set = subscribers.get(frame.streamId);
        if (!set) subscribers.set(frame.streamId, (set = new Set()));
        set.add(ws);
        mine.add(frame.streamId);
        ws.send(JSON.stringify({ type: 'subscribed', streamId: frame.streamId }));
        // Replay history, mirroring the real server.
        for (const agent of agents.values()) {
          if (agent.streamId !== frame.streamId) continue;
          for (const event of agent.events) ws.send(JSON.stringify({ type: 'event', event }));
        }
      }
      if (frame.type === 'unsubscribe' && frame.streamId) {
        subscribers.get(frame.streamId)?.delete(ws);
        mine.delete(frame.streamId);
      }
    });
    ws.on('close', () => {
      for (const streamId of mine) subscribers.get(streamId)?.delete(ws);
    });
  });
});

await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`mock reflex listening on http://localhost:${PORT}`);
