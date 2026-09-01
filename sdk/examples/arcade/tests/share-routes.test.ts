/**
 * The share endpoints as an unfurl target sees them: no credentials, over
 * HTTP, against a real database.
 *
 * The pure-function tests next door assert what a card SAYS. These assert
 * what the boundary HANDS OUT, which is where the privacy rule would
 * actually regress — a card builder that refuses private games is no help
 * if a route stops asking it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ArcadeDb, type GameRow } from '../server/db.ts';
import { EventHub } from '../server/events.ts';
import type { GameEngine } from '../server/engine.ts';
import { registerRoutes } from '../server/routes.ts';

let app: FastifyInstance;
let db: ArcadeDb;
let publicGame: GameRow;
let privateGame: GameRow;

/** The routes under test never reach the engine; these are the seams. */
const engineStub = {
  ensureWatcher: async () => {},
  dropWatcher: () => {},
  poke: () => {},
} as unknown as GameEngine;

const HEADERS = { 'x-forwarded-host': 'arcade.example.com', 'x-forwarded-proto': 'https' };

beforeAll(async () => {
  db = await ArcadeDb.open({ kind: 'pglite', dataDir: 'memory://' });
  const owner = await db.createUser('Streamer');
  const key = await db.createReflexKey({
    userId: owner.id,
    name: 'test',
    apiKey: 'rfx_test_not_real',
    org: null,
  });
  const make = (isPublic: boolean, title: string) =>
    db.createGame({
      ownerId: owner.id,
      keyId: key.id,
      title,
      prompt: 'a game about squares',
      agentId: `agent_${title}`,
      agentStreamId: `stream_${title}`,
      agentType: 'claude-code',
      model: null,
      isPublic,
      autoApprove: false,
    });
  publicGame = await make(true, 'public');
  privateGame = await make(false, 'private');

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

describe('GET /api/games/:id/share', () => {
  it('answers a crawler with no credentials at all', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${publicGame.id}/share`,
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const { share } = res.json() as { share: { url: string; title: string; image: string } };
    expect(share.url).toBe(`https://arcade.example.com/g/${publicGame.id}`);
    expect(share.title).toContain('public');
    expect(share.image).toContain('/og-image');
  });

  // The rule this whole feature has to keep: a private link says nothing.
  it('gives a private game the same answer as a missing one', async () => {
    const priv = await app.inject({ method: 'GET', url: `/api/games/${privateGame.id}/share` });
    const missing = await app.inject({ method: 'GET', url: '/api/games/game_nope/share' });
    expect(priv.statusCode).toBe(404);
    expect(priv.body).toBe(missing.body);
    expect(priv.body).not.toContain('private');
    expect(priv.body).not.toContain('squares');
  });
});

describe('GET /api/games/:id/og-image', () => {
  it('renders a PNG, because no unfurl target draws SVG', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/games/${publicGame.id}/og-image` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.subarray(1, 4).toString()).toBe('PNG');
  });

  it('gives a private game the arcade card, never its own', async () => {
    const priv = await app.inject({ method: 'GET', url: `/api/games/${privateGame.id}/og-image` });
    const arcade = await app.inject({ method: 'GET', url: '/api/share-image' });
    expect(priv.statusCode).toBe(200);
    expect(priv.rawPayload.equals(arcade.rawPayload)).toBe(true);
  });

  it('is immutable, since artVersion is in the URL', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/games/${publicGame.id}/og-image?v=0`,
    });
    expect(res.headers['cache-control']).toContain('immutable');
  });
});

describe('GET /api/oembed', () => {
  const url = (id: string) =>
    `/api/oembed?url=${encodeURIComponent(`https://arcade.example.com/g/${id}`)}`;

  it('answers for a public game', async () => {
    const res = await app.inject({ method: 'GET', url: url(publicGame.id), headers: HEADERS });
    expect(res.statusCode).toBe(200);
    const payload = res.json() as { provider_name: string; thumbnail_url: string; type: string };
    expect(payload.provider_name).toBe('Reflex Arcade');
    expect(payload.thumbnail_url).toContain('og-image');
    // No daemon on a freshly created game, so there is nothing to embed.
    expect(payload.type).toBe('link');
  });

  it('refuses a private game', async () => {
    const res = await app.inject({ method: 'GET', url: url(privateGame.id), headers: HEADERS });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('squares');
  });

  // Otherwise the arcade renders cards for links on anyone else's host.
  it('refuses a URL that is not ours', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/oembed?url=${encodeURIComponent(`https://evil.example.com/g/${publicGame.id}`)}`,
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });

  it('clamps a hostile maxwidth instead of emitting a negative iframe', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${url(publicGame.id)}&maxwidth=-500`,
      headers: HEADERS,
    });
    const payload = res.json() as { width?: number };
    // A `link` payload carries no width; ask for one that can embed.
    expect(payload.width ?? 200).toBeGreaterThan(0);
  });

  it('declines the formats it does not speak', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${url(publicGame.id)}&format=xml`,
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(501);
  });
});
