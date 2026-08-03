import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  createFakePluginAuthz,
  createTestLogger,
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
