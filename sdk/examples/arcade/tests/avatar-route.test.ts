/**
 * The avatar endpoint as a GAME sees it: no credentials, from a foreign
 * origin, over an <img> tag that has no way to handle an error.
 *
 * The pure-function tests next door assert what gets DRAWN. These assert
 * what the boundary hands out — the headers a cross-origin embed depends on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ArcadeDb, type UserRow } from '../server/db.ts';
import { EventHub } from '../server/events.ts';
import type { GameEngine } from '../server/engine.ts';
import { registerRoutes } from '../server/routes.ts';

let app: FastifyInstance;
let db: ArcadeDb;
let plain: UserRow;
let pictured: UserRow;

/** The route under test never reaches the engine; these are the seams. */
const engineStub = {
  ensureWatcher: async () => {},
  dropWatcher: () => {},
  poke: () => {},
} as unknown as GameEngine;

beforeAll(async () => {
  db = await ArcadeDb.open({ kind: 'pglite', dataDir: 'memory://' });
  plain = await db.createUser('Alex');
  pictured = await db.createUser('Robin');
  await db.updateProfile(pictured.id, {
    avatar: `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`,
  });

  app = Fastify();
  registerRoutes(app, {
    db,
    hub: new EventHub(),
    engine: engineStub,
    reflexAgentType: 'claude-code',
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('GET /api/users/:userId/avatar', () => {
  it('serves the uploaded picture as an image, no token needed', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/users/${pictured.id}/avatar` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.rawPayload.toString()).toBe('fake-png');
  });

  it('draws a chip for a player with no picture rather than 404ing', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/users/${plain.id}/avatar` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
  });

  // The game is on a devbox tunnel, a different origin — and may draw the
  // avatar into a canvas, which needs the header even for an <img>.
  it('is readable cross-origin', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/users/${plain.id}/avatar` });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  // Only the versioned URL is immutable: without the key, the picture the
  // player replaces would stay on screen for a year.
  it('caches forever only when the caller supplied a version', async () => {
    const versioned = await app.inject({ url: `/api/users/${plain.id}/avatar?v=abc` });
    expect(versioned.headers['cache-control']).toContain('immutable');
    const bare = await app.inject({ url: `/api/users/${plain.id}/avatar` });
    expect(bare.headers['cache-control']).not.toContain('immutable');
  });

  it('404s for a player who does not exist', async () => {
    const res = await app.inject({ url: '/api/users/user_nope/avatar' });
    expect(res.statusCode).toBe(404);
  });
});
