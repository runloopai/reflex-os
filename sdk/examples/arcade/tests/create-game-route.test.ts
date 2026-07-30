/**
 * `POST /api/games` at the boundary: what the launch actually hands to
 * Reflex.
 *
 * The pinned provider key is the interesting part. It arrives from a form,
 * goes straight through to `createAgent`, and picking the wrong one spends
 * someone else's budget — so these assert that a key reaches the launch
 * unchanged, that junk is refused before it gets there, and that omitting
 * one still launches (Reflex resolves it, the way every launch did before
 * the picker existed).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ArcadeDb } from '../server/db.ts';
import { EventHub } from '../server/events.ts';
import type { GameEngine } from '../server/engine.ts';

/** Captured `createGameAgent` calls; the module is mocked below. */
const launches: Array<Record<string, unknown>> = [];

vi.mock('../server/reflex.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/reflex.ts')>();
  return {
    ...actual,
    createGameAgent: async (_creds: unknown, input: Record<string, unknown>) => {
      launches.push(input);
      return { id: 'agent_test', streamId: 'stream_test', status: 'starting', daemons: [] };
    },
  };
});

const { registerRoutes } = await import('../server/routes.ts');

let app: FastifyInstance;
let db: ArcadeDb;
let token: string;

const body = {
  title: 'Key Test',
  prompt: 'a tiny game',
  agentType: 'claude-code',
  isPublic: true,
  autoApprove: false,
};

beforeAll(async () => {
  db = await ArcadeDb.open('memory://');
  const owner = await db.createUser('Streamer');
  token = owner.token;
  const key = await db.createReflexKey({
    userId: owner.id,
    name: 'test',
    apiKey: 'rfx_test_not_real',
    org: 'org_test',
  });
  await db.setActiveKey(owner.id, key.id);

  app = Fastify();
  registerRoutes(app, {
    db,
    hub: new EventHub(),
    engine: {
      ensureWatcher: async () => {},
      dropWatcher: () => {},
      poke: () => {},
    } as unknown as GameEngine,
    reflexAgentType: 'claude-code',
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.close();
});

const create = (payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/api/games',
    headers: { authorization: `Bearer ${token}` },
    payload: { ...body, ...payload },
  });

describe('POST /api/games — pinned provider key', () => {
  it('hands the picked key to the launch, unchanged', async () => {
    const res = await create({ providerKeyId: 'mps_mock000000000000000003' });
    expect(res.statusCode).toBe(200);
    expect(launches.at(-1)?.providerSecretId).toBe('mps_mock000000000000000003');
  });

  it('launches without one when nobody picked — Reflex resolves it', async () => {
    const res = await create({ title: 'Automatic' });
    expect(res.statusCode).toBe(200);
    expect(launches.at(-1)?.providerSecretId).toBeNull();
  });

  it('refuses anything that is not a provider key id', async () => {
    for (const providerKeyId of ['not-a-key', 'sk_live_whatever', 'mps_bad!id', '../../etc']) {
      const res = await create({ providerKeyId });
      expect(res.statusCode, providerKeyId).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_provider_key' });
    }
  });

  it('accepts an id of another length — Reflex owns that format', async () => {
    // Pinning Reflex's exact id length here would reject valid ids the day
    // it changes; the arcade only checks the shape.
    const res = await create({ providerKeyId: 'mps_' + 'a'.repeat(30) });
    expect(res.statusCode).toBe(200);
  });
});
