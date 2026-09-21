import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import {
  createFakePluginAuthz,
  createTestLogger,
  type TestLogger,
  preparePluginRouteApp,
} from '@reflex/plugin-api/test';
import { registerWorkstationRoutes } from '../server/workstation.routes.js';
import type { WorkstationRegistryService } from '../server/workstation-registry.service.js';

const ORG_ID = 'org_aaaaaaaaaaaaaaaaaaaaaa';
const USER_ID = 'usr_aaaaaaaaaaaaaaaaaaaaaa';

function mockRegistry(
  overrides: Partial<WorkstationRegistryService> = {},
): WorkstationRegistryService {
  return {
    list: vi.fn().mockResolvedValue([]),
    listCalls: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as WorkstationRegistryService;
}

function buildApp(
  registry: WorkstationRegistryService,
  { auth = true, permissions = new Set(['agents:read', 'agents:write']) } = {},
) {
  const app = Fastify();
  const authz = createFakePluginAuthz({ permissions, userId: USER_ID });
  // Routes declare their gate as a `config.rbac` posture rather than a
  // hand-rolled preHandler; mirror the host's posture->enforcer wiring so
  // this bare-Fastify suite exercises the same gate as production. Every
  // route here declares a read/write slug, so the permission check itself
  // already enforces "authenticated" (401) and "active org" (400) before
  // the slug check — no separate `orgGate` needed.
  app.addHook('preHandler', async (request) => {
    if (auth) {
      (request as unknown as { currentOrganizationId: string }).currentOrganizationId = ORG_ID;
      (request as unknown as { currentUser: { id: string } }).currentUser = { id: USER_ID };
    }
  });
  registerWorkstationRoutes(preparePluginRouteApp(app, authz), registry, createTestLogger());
  return app;
}

describe('workstation route RBAC postures', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it('GET /workstations is gated on agents:read', async () => {
    const registry = mockRegistry();
    app = buildApp(registry, { permissions: new Set() });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/workstations' });
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('agents:read');
  });

  it('GET /workstations returns the caller org workstations with agents:read', async () => {
    const registry = mockRegistry();
    app = buildApp(registry, { permissions: new Set(['agents:read']) });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/workstations' });
    expect(res.statusCode).toBe(200);
    expect(registry.list).toHaveBeenCalledWith(ORG_ID, USER_ID);
  });

  it('GET /workstations/:id/calls is gated on agents:read', async () => {
    const registry = mockRegistry();
    app = buildApp(registry, { permissions: new Set() });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/workstations/wks_1/calls' });
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('agents:read');
  });

  it('DELETE /workstations/:id is gated on agents:write', async () => {
    const registry = mockRegistry();
    app = buildApp(registry, { permissions: new Set(['agents:read']) });
    await app.ready();
    const res = await app.inject({ method: 'DELETE', url: '/workstations/wks_1' });
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('agents:write');
  });

  it('DELETE /workstations/:id succeeds with agents:read + agents:write', async () => {
    const registry = mockRegistry();
    app = buildApp(registry, { permissions: new Set(['agents:read', 'agents:write']) });
    await app.ready();
    const res = await app.inject({ method: 'DELETE', url: '/workstations/wks_1' });
    expect(res.statusCode).toBe(204);
    expect(registry.delete).toHaveBeenCalledWith('wks_1', ORG_ID, USER_ID);
  });

  // Write-implies-read: the posture pairs `agents:write` with `agents:read`,
  // so the write slug alone is refused. A lone `write:` would resolve to
  // `requireWriteOnly` and let a caller delete workstations it may not read.
  it('DELETE /workstations/:id 403s a caller holding agents:write but not agents:read', async () => {
    const registry = mockRegistry();
    app = buildApp(registry, { permissions: new Set(['agents:write']) });
    await app.ready();
    const res = await app.inject({ method: 'DELETE', url: '/workstations/wks_1' });
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('agents:read');
    expect(registry.delete).not.toHaveBeenCalled();
  });

  it('GET /workstations/connect (the websocket upgrade route) is gated on agents:write', async () => {
    // The 3-arg route form is required for `config` to reach the host's
    // posture->enforcer wiring at all; this asserts the upgrade is refused
    // with a clean 403 (rather than a half-opened socket) before the
    // handler ever runs, for a caller who lacks agents:write.
    const registry = mockRegistry();
    app = buildApp(registry, { permissions: new Set(['agents:read']) });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/workstations/connect' });
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('agents:write');
  });

  it('GET /workstations 401s an unauthenticated caller', async () => {
    const registry = mockRegistry();
    app = buildApp(registry, { auth: false });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/workstations' });
    expect(res.statusCode).toBe(401);
  });
});

/**
 * WebSocket logging tests for the `/workstations/connect` control channel.
 *
 * Both log sites below fire in async callbacks — a promise `.catch` and a
 * `socket.on('error')` handler — that run outside the request's
 * AsyncLocalStorage store, so the ambient log-context mixin does not
 * auto-stamp `organizationId`/`userId` there; the route must stamp them
 * explicitly. They also pass the real `Error` object (not a stringified
 * message) so pino's serializer preserves the stack trace — the key triage
 * signal — and the logMethod hook can classify a transient transport error
 * for ERROR→WARN downgrade.
 */
async function buildWsApp(
  registry: WorkstationRegistryService,
): Promise<{ app: FastifyInstance; logger: TestLogger }> {
  const app = Fastify();
  const logger = createTestLogger();
  const authz = createFakePluginAuthz({
    permissions: new Set(['agents:read', 'agents:write']),
    userId: USER_ID,
  });
  await app.register(websocket);
  app.addHook('preHandler', async (request) => {
    (request as unknown as { currentOrganizationId: string }).currentOrganizationId = ORG_ID;
    (request as unknown as { currentUser: { id: string } }).currentUser = { id: USER_ID };
  });
  registerWorkstationRoutes(preparePluginRouteApp(app, authz), registry, logger);
  await app.ready();
  return { app, logger };
}

const REGISTER_FRAME = JSON.stringify({
  v: 1,
  type: 'register',
  name: 'test-workstation',
  hostname: 'test-host',
  platform: 'linux',
});

function portOf(app: FastifyInstance): number {
  const addr = app.server.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

describe('workstation WS connect — structured logging', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it('logs the real Error object with organizationId/userId when registration fails', async () => {
    const registry = mockRegistry({
      register: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const built = await buildWsApp(registry);
    app = built.app;
    const { logger } = built;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const url = `ws://127.0.0.1:${portOf(app)}/workstations/connect`;

    const ws = new WebSocket(url);
    // Swallow transport-level errors so a close frame doesn't surface as an
    // unhandled rejection on the client side.
    ws.on('error', () => {});
    await new Promise<void>((resolve) => ws.once('open', resolve));
    ws.send(REGISTER_FRAME);
    // The route closes with 1011 on registration failure.
    const closeCode = await new Promise<number>((resolve) =>
      ws.once('close', (code) => resolve(code)),
    );
    expect(closeCode).toBe(1011);

    const errors = logger.getCapturedByLevel('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toBe('workstation registration failed');
    const obj = errors[0].obj as { err: unknown; organizationId: string; userId: string };
    // The real Error object — not a stringified `err.message` — so pino's
    // serializer preserves the stack trace and error type.
    expect(obj.err).toBeInstanceOf(Error);
    expect((obj.err as Error).message).toBe('db down');
    // Stamped explicitly: the `.catch` fires outside the request ALS store.
    expect(obj.organizationId).toBe(ORG_ID);
    expect(obj.userId).toBe(USER_ID);

    ws.close();
  });

  it('logs the real Error object with organizationId/userId/workstationId on a socket error', async () => {
    // Capture the server-side socket so the test can emit a synthetic
    // 'error' event on the same object the route registered `on('error')`
    // against.
    let serverSocket: unknown;
    const registry = mockRegistry({
      register: vi.fn().mockImplementation(async (input) => {
        serverSocket = input.socket;
        return { id: 'wks_1' };
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      handleMessage: vi.fn(),
    });
    const built = await buildWsApp(registry);
    app = built.app;
    const { logger } = built;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const url = `ws://127.0.0.1:${portOf(app)}/workstations/connect`;

    const ws = new WebSocket(url);
    ws.on('error', () => {});
    await new Promise<void>((resolve) => ws.once('open', resolve));
    ws.send(REGISTER_FRAME);
    // Wait for the 'registered' frame — confirms `workstationId` is set on
    // the route's closure so the WARN will carry it.
    await new Promise<void>((resolve) => ws.once('message', () => resolve()));

    // Emit a synthetic 'error' on the server-side socket. The route's
    // `socket.on('error')` handler fires outside the request ALS store, so
    // the ambient mixin cannot stamp the tenant — the explicit stamp is
    // the only path.
    const boom = new Error('socket transport error');
    (serverSocket as { emit: (event: string, ...args: unknown[]) => void }).emit('error', boom);

    const warns = logger.getCapturedByLevel('warn');
    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toBe('workstation socket error');
    const obj = warns[0].obj as {
      err: unknown;
      workstationId: string | null;
      organizationId: string;
      userId: string;
    };
    expect(obj.err).toBe(boom);
    expect(obj.workstationId).toBe('wks_1');
    expect(obj.organizationId).toBe(ORG_ID);
    expect(obj.userId).toBe(USER_ID);

    ws.close();
  });
});
