/**
 * What the front door refuses.
 *
 * These are the checks that make the arcade safe to point at the public
 * internet rather than at a demo audience: without them one script mints
 * accounts, fills the shelf with real agents on someone else's bill, and
 * floods every room. The counter itself is pure and tested directly; the
 * hook is tested through a Fastify app, because the parts that go wrong in
 * practice are which route a rule attaches to and what a refused caller
 * gets back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { ArcadeDb } from '../server/db.ts';
import { EventHub } from '../server/events.ts';
import { registerRoutes } from '../server/routes.ts';
import { registerReflexProxy } from '../server/proxy.ts';
import {
  MAX_API_BODY_BYTES,
  MAX_PROXY_BODY_BYTES,
  RateLimiter,
  registerLimits,
  ruleKeyFor,
  RATE_LIMITS,
} from '../server/limits.ts';

const RULES = { 'POST /api/join': { limit: 3, windowMs: 60_000 } };

describe('RateLimiter', () => {
  it('allows a caller up to the limit and then refuses', () => {
    const limiter = new RateLimiter(RULES);
    for (let i = 0; i < 3; i++) expect(limiter.hit('POST /api/join', '1.2.3.4')).toBeNull();
    const refused = limiter.hit('POST /api/join', '1.2.3.4');
    expect(refused?.retryAfterMs).toBeGreaterThan(0);
  });

  it('counts each caller separately', () => {
    const limiter = new RateLimiter(RULES);
    for (let i = 0; i < 4; i++) limiter.hit('POST /api/join', '1.2.3.4');
    expect(limiter.hit('POST /api/join', '5.6.7.8')).toBeNull();
  });

  it('forgives a caller once their window is over', () => {
    const limiter = new RateLimiter(RULES);
    for (let i = 0; i < 4; i++) limiter.hit('POST /api/join', '1.2.3.4', 1_000);
    expect(limiter.hit('POST /api/join', '1.2.3.4', 1_000)).not.toBeNull();
    expect(limiter.hit('POST /api/join', '1.2.3.4', 62_000)).toBeNull();
  });

  it('has nothing to say about a route with no rule', () => {
    const limiter = new RateLimiter(RULES);
    for (let i = 0; i < 100; i++) expect(limiter.hit('GET /api/games', '1.2.3.4')).toBeNull();
    expect(limiter.size).toBe(0);
  });

  // A flood of distinct addresses must not be a way to grow the process's
  // memory without bound; expired windows go first, and if that frees
  // nothing the map is dropped rather than kept.
  it('stays bounded under a flood of distinct callers', () => {
    const limiter = new RateLimiter(RULES);
    for (let i = 0; i < 50_000; i++) limiter.hit('POST /api/join', `10.0.${i >> 8}.${i & 255}`);
    expect(limiter.size).toBeLessThanOrEqual(20_000);
  });
});

describe('the rules themselves', () => {
  const registered = new Set<string>();
  let db: ArcadeDb;

  beforeAll(async () => {
    db = await ArcadeDb.open({ kind: 'pglite', dataDir: 'memory://' });
    const app = Fastify();
    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) registered.add(`${method} ${route.url}`);
    });
    registerRoutes(app, {
      db,
      hub: new EventHub(),
      engine: { ensureWatcher: async () => {}, dropWatcher: () => {}, poke: () => {} } as never,
      reflexAgentType: 'claude-code',
    });
    registerReflexProxy(app, db, 'http://reflex.invalid');
    await app.ready();
    await app.close();
  });

  afterAll(async () => {
    await db.close();
  });

  // A rule is matched on the route PATTERN Fastify registered, so a typo
  // here is a limit that silently never applies — and nothing else would
  // ever notice, because the failure mode is "no limit".
  it('name routes the arcade actually serves', () => {
    for (const key of Object.keys(RATE_LIMITS)) expect(registered).toContain(key);
  });

  // The reverse is not required — reads are deliberately unlimited — but
  // every write that costs a row or an upstream call should be here.
  it('cover every write route', () => {
    const writes = [...registered].filter(
      (route) => !route.startsWith('GET ') && !route.startsWith('HEAD '),
    );
    const unlimited = writes.filter((route) => !(route in RATE_LIMITS));
    // Owner-only actions on a game the caller already owns: rejecting,
    // approving, noting, deleting. Reachable only with a token that already
    // passed a limited route, and each one is bounded by the queue it acts
    // on rather than by anything a script can invent.
    expect(unlimited.sort()).toEqual(
      [
        'DELETE /api/games/:gameId',
        'DELETE /api/me/reflex-connect/:connectionId',
        'DELETE /api/me/reflex-keys/:keyId',
        'PATCH /api/games/:gameId',
        'PATCH /api/me/reflex-keys/:keyId',
        'POST /api/games/:gameId/suggestions/:suggestionId/approve',
        'POST /api/games/:gameId/suggestions/:suggestionId/reject',
        'PUT /api/me/active-key',
        'PUT /api/games/:gameId/suggestions/:suggestionId/note',
      ].sort(),
    );
  });
});

/**
 * Body size, against an app configured the way `server/index.ts` configures
 * it — the small limit as the default, the proxy route raising it for
 * itself. Asserting this on a bare `Fastify()` would prove nothing: its own
 * default is 1MB, so a "too large" test passes with the whole feature
 * removed.
 */
describe('body limits', () => {
  const arcadeLikeApp = async () => {
    const app = Fastify({ bodyLimit: MAX_API_BODY_BYTES });
    // Brings the passthrough JSON parser and the raised route limit with it.
    registerReflexProxy(app, {} as never, 'http://reflex.invalid');
    app.post('/api/join', async () => ({ ok: true }));
    await app.ready();
    return app;
  };

  const send = (app: Awaited<ReturnType<typeof arcadeLikeApp>>, url: string, bytes: number) =>
    app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'x'.repeat(bytes) }),
    });

  it('refuses an API body over the cap and accepts one under it', async () => {
    const app = await arcadeLikeApp();
    expect((await send(app, '/api/join', MAX_API_BODY_BYTES + 1)).statusCode).toBe(413);
    expect((await send(app, '/api/join', 1_000)).statusCode).toBe(200);
    await app.close();
  });

  // Enforced by Fastify off the stream rather than by reading
  // `Content-Length`, which is the only version that survives an encoding
  // the caller chooses: a chunked request declares no length at all.
  it('refuses an oversized chunked body, which declares no length', async () => {
    const app = await arcadeLikeApp();
    const reply = await app.inject({
      method: 'POST',
      url: '/api/join',
      headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
      payload: JSON.stringify({ name: 'x'.repeat(MAX_API_BODY_BYTES + 1) }),
    });
    expect(reply.statusCode).toBe(413);
    await app.close();
  });

  // Agent messages carry base64 image and file blocks, so the one route that
  // forwards them keeps the big limit — and only that route.
  it('lets the Reflex proxy take a body far over the API cap', async () => {
    const app = await arcadeLikeApp();
    const reply = await send(app, '/reflex/game_1/api/agents/a/message', MAX_API_BODY_BYTES * 4);
    expect(reply.statusCode).not.toBe(413);
    expect(MAX_PROXY_BODY_BYTES).toBeGreaterThan(MAX_API_BODY_BYTES);
    await app.close();
  });
});

describe('ruleKeyFor', () => {
  it('keys on the route pattern, not the path that was asked for', () => {
    expect(
      ruleKeyFor({ method: 'POST', routeOptions: { url: '/api/games/:gameId/chat' } } as never),
    ).toBe('POST /api/games/:gameId/chat');
  });
});

describe('the hook', () => {
  const appWith = async (limiter: RateLimiter) => {
    const app = Fastify();
    registerLimits(app, limiter);
    app.post('/api/join', async () => ({ ok: true }));
    app.get('/api/games', async () => ({ games: [] }));
    await app.ready();
    return app;
  };

  it('answers a refused caller with 429 and how long to wait', async () => {
    const app = await appWith(new RateLimiter(RULES));
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'POST', url: '/api/join' })).statusCode).toBe(200);
    }
    const refused = await app.inject({ method: 'POST', url: '/api/join' });
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.json()).toMatchObject({ error: 'rate_limited' });
    // Reads are not limited: they are the shop window.
    expect((await app.inject({ url: '/api/games' })).statusCode).toBe(200);
    await app.close();
  });

  // The proxy authorizes inside its handler, after the body it is allowed to
  // read a very large one. So the limit has to be in front of it.
  it('covers the Reflex proxy, which is the route with the big body', async () => {
    expect(RATE_LIMITS).toHaveProperty('POST /reflex/:gameId/api/*');
    const app = Fastify();
    registerLimits(app, new RateLimiter({ 'POST /reflex/:gameId/api/*': RULES['POST /api/join'] }));
    registerReflexProxy(app, {} as never, 'http://reflex.invalid');
    await app.ready();
    const post = () =>
      app.inject({
        method: 'POST',
        url: '/reflex/game_1/api/agents/a/message',
        headers: { 'content-type': 'application/json' },
        payload: '{}',
      });
    for (let i = 0; i < 3; i++) expect((await post()).statusCode).not.toBe(429);
    expect((await post()).statusCode).toBe(429);
    await app.close();
  });
});
