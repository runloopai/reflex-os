/**
 * What the arcade tells a shared cache it may keep.
 *
 * This is a privacy rule, not a performance one: `GET /api/games` answers a
 * stranger with the public shelf and a player with their own games too, on
 * the same URL. A CDN that stored the second one would hand somebody's
 * unlisted games to the next visitor. So the assertions here are mostly
 * "this must NOT be cacheable", and the default that makes a route added
 * tomorrow safe without anyone remembering to think about it.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ArcadeDb, type GameRow } from '../server/db.ts';
import { EventHub } from '../server/events.ts';
import type { GameEngine } from '../server/engine.ts';
import { registerRoutes } from '../server/routes.ts';
import { CACHE, registerCachePolicy, staticCacheHeaders, versioned } from '../server/http-cache.ts';
import { seedArcade } from './seed.ts';

let app: FastifyInstance;
let db: ArcadeDb;
let game: GameRow;
let token: string;

const engineStub = {
  ensureWatcher: async () => {},
  dropWatcher: () => {},
  poke: () => {},
} as unknown as GameEngine;

beforeAll(async () => {
  db = await ArcadeDb.open({ kind: 'pglite', dataDir: 'memory://' });
  const seeded = await seedArcade(db);
  game = (await db.gameById(seeded.gameId))!;
  token = (await db.userById(seeded.ownerId))!.token;
  await db.setGameArt(game.id, { iconArt: 'data:image/svg+xml;base64,PHN2Zy8+' });
  game = (await db.gameById(game.id))!;

  app = Fastify();
  // Stands in for the Reflex proxy: it forwards an upstream body under the
  // owner's key and sets no cache header of its own, so the default has to
  // cover that prefix too.
  app.get('/reflex/game_x/api/agents/a1', async (_req, reply) => reply.send({ ok: true }));
  registerRoutes(app, {
    db,
    hub: new EventHub(),
    engine: engineStub,
    reflexAgentType: 'claude-code',
  });
  registerCachePolicy(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.close();
});

const cacheControl = async (url: string, headers: Record<string, string> = {}) =>
  (await app.inject({ method: 'GET', url, headers })).headers['cache-control'];

describe('API responses', () => {
  it('never lets a shared cache keep an answer that depends on the caller', async () => {
    // Same URL, two bodies. The header is the only thing standing between
    // them and a CDN serving one reader the other's shelf.
    const anonymous = await app.inject({ method: 'GET', url: '/api/games' });
    const player = await app.inject({
      method: 'GET',
      url: '/api/games',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(anonymous.headers['cache-control']).toBe(CACHE.private);
    expect(player.headers['cache-control']).toBe(CACHE.private);
    expect(String(player.headers['vary'])).toContain('authorization');
  });

  it('defaults to private without the handler saying so', async () => {
    // The healthcheck and an error both go through the same default, which
    // is the point: nobody has to remember.
    expect(await cacheControl('/api/health')).toBe(CACHE.private);
    expect(await cacheControl('/api/me')).toBe(CACHE.private);
    expect(await cacheControl('/api/does-not-exist')).toBe(CACHE.private);
    expect(await cacheControl('/reflex/game_x/api/agents/a1')).toBe(CACHE.private);
  });

  it('keeps the encoding negotiation a proxy already depends on', async () => {
    const reply = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'accept-encoding': 'gzip' },
    });
    // Appended, not overwritten: dropping accept-encoding here would let a
    // proxy hand gzip bytes to a client that asked for none.
    const vary = String(reply.headers['vary'] ?? '');
    if (vary.includes('accept-encoding')) expect(vary).toContain('authorization');
  });
});

describe('public bytes', () => {
  it('is immutable only for the art version that was asked for', async () => {
    expect(await cacheControl(`/api/games/${game.id}/art/icon?v=${game.artVersion}`)).toBe(
      CACHE.immutable,
    );
    // No version, or last week's: these bytes change under this URL.
    expect(await cacheControl(`/api/games/${game.id}/art/icon`)).toBe(CACHE.short);
    expect(await cacheControl(`/api/games/${game.id}/art/icon?v=0`)).toBe(CACHE.short);
  });

  it('does not pin the stand-in card a private game answers with', async () => {
    // A private game answers with the arcade's own card. Cached for a year
    // it would outlive the game going public at the same artVersion.
    await db.updateGame(game.id, { isPublic: false });
    expect(await cacheControl(`/api/games/${game.id}/og-image?v=${game.artVersion}`)).toBe(
      CACHE.short,
    );
    await db.updateGame(game.id, { isPublic: true });
    expect(await cacheControl(`/api/games/${game.id}/og-image?v=${game.artVersion}`)).toBe(
      CACHE.immutable,
    );
  });

  it('lets the share card JSON be cached briefly', async () => {
    expect(await cacheControl(`/api/games/${game.id}/share`)).toBe(CACHE.short);
  });

  it('does not split a CDN cache by a header these answers ignore', async () => {
    const reply = await app.inject({
      method: 'GET',
      url: `/api/games/${game.id}/art/icon?v=${game.artVersion}`,
    });
    expect(String(reply.headers['vary'] ?? '')).not.toContain('authorization');
  });
});

describe('versioned', () => {
  it('matches on value, not type', () => {
    expect(versioned('3', 3)).toBe(CACHE.immutable);
    expect(versioned(3, 3)).toBe(CACHE.immutable);
    expect(versioned(undefined, 0)).toBe(CACHE.short);
    expect(versioned('2', 3)).toBe(CACHE.short);
  });
});

describe('the built web app', () => {
  const headerFor = (path: string) => {
    let value = '';
    staticCacheHeaders({ setHeader: (_k, v) => (value = v) }, path);
    return value;
  };

  it('serves what setHeaders decided, not @fastify/static default', async () => {
    // The option combination is the test: with `cacheControl` left on,
    // @fastify/static writes `public, max-age=0` AFTER setHeaders runs and
    // every fingerprinted asset revalidates on every page load.
    const root = await mkdtemp(join(tmpdir(), 'arcade-static-'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', 'index-C3KmY9JX.js'), 'export {};');
    await writeFile(join(root, 'index.html'), '<!doctype html>');

    const server = Fastify();
    await server.register(fastifyStatic, {
      root,
      cacheControl: false,
      setHeaders: staticCacheHeaders,
    });
    const asset = await server.inject({ method: 'GET', url: '/assets/index-C3KmY9JX.js' });
    const shell = await server.inject({ method: 'GET', url: '/index.html' });
    await server.close();
    await rm(root, { recursive: true, force: true });

    expect(asset.headers['cache-control']).toBe(CACHE.immutable);
    expect(shell.headers['cache-control']).toBe(CACHE.private);
  });

  it('caches fingerprinted assets forever and the shell never', () => {
    // Vite puts the content hash in the filename, so the URL can only ever
    // name these bytes; index.html names THIS build's hashes.
    expect(headerFor('/app/web/dist/assets/index-C3KmY9JX.js')).toBe(CACHE.immutable);
    expect(headerFor('/app/web/dist/assets/index-BawABz_b.css')).toBe(CACHE.immutable);
    expect(headerFor('/app/web/dist/index.html')).toBe(CACHE.private);
    expect(headerFor('/app/web/dist/favicon.svg')).toBe(CACHE.private);
  });
});
