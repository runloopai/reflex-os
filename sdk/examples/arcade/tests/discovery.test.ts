/**
 * What a crawler gets before it gets a page.
 *
 * The shelf is rendered by the app, so a crawler that does not run
 * JavaScript sees a landing page with no links on it: without a sitemap,
 * every game has a share card nobody will ever be shown. That makes these
 * the discovery surface — and it makes the privacy rule matter here too,
 * because a sitemap that lists a private game has published its URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ArcadeDb, type GameRow } from '../server/db.ts';
import {
  ICON_SVG,
  registerDiscoveryRoutes,
  robotsTxt,
  sitemapXml,
  webManifest,
} from '../server/discovery.ts';

let app: FastifyInstance;
let db: ArcadeDb;
let openGame: GameRow;
let secretGame: GameRow;

const ORIGIN = 'https://arcade.example.com';
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
  openGame = await make(true, 'public');
  secretGame = await make(false, 'private');

  app = Fastify();
  registerDiscoveryRoutes(app, db);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.close();
});

const get = (url: string) => app.inject({ method: 'GET', url, headers: HEADERS });

describe('robots.txt', () => {
  it('is plain text, points at the sitemap, and keeps crawlers out of the machinery', async () => {
    const reply = await get('/robots.txt');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toContain('text/plain');
    expect(reply.body).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    // Not pages: JSON, an image, and somebody's authenticated proxy.
    expect(reply.body).toContain('Disallow: /api/');
    expect(reply.body).toContain('Disallow: /reflex/');
  });

  it('names the host it was asked on', () => {
    expect(robotsTxt('https://other.example')).toContain(
      'Sitemap: https://other.example/sitemap.xml',
    );
  });
});

describe('sitemap.xml', () => {
  it('lists the public game and never the private one', async () => {
    const reply = await get('/sitemap.xml');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toContain('application/xml');
    expect(reply.body).toContain(`<loc>${ORIGIN}/g/${openGame.id}</loc>`);
    // The whole privacy model in one assertion: an unlisted game's URL is
    // not something the arcade hands out.
    expect(reply.body).not.toContain(secretGame.id);
  });

  it('includes the pages that are not games', async () => {
    const body = (await get('/sitemap.xml')).body;
    expect(body).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(body).toContain(`<loc>${ORIGIN}/about</loc>`);
  });

  it('writes lastmod as a date and escapes the location', () => {
    const xml = sitemapXml('https://x.test', [
      { path: '/g/a?b=1&c=2', lastmod: '2026-09-01T22:15:21.000Z' },
      { path: '/' },
    ]);
    expect(xml).toContain('<lastmod>2026-09-01</lastmod>');
    expect(xml).toContain('<loc>https://x.test/g/a?b=1&amp;c=2</loc>');
    // No lastmod element at all rather than an empty one.
    expect(xml).not.toContain('<lastmod></lastmod>');
  });
});

describe('icons and manifest', () => {
  it('serves the mark as SVG under both names', async () => {
    for (const path of ['/favicon.svg', '/icon.svg']) {
      const reply = await get(path);
      expect(reply.statusCode).toBe(200);
      expect(reply.headers['content-type']).toContain('image/svg+xml');
      expect(reply.body).toBe(ICON_SVG);
    }
  });

  it('rasterizes the same mark for iOS, which will not take an SVG', async () => {
    const reply = await get('/apple-touch-icon.png');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toContain('image/png');
    // PNG magic number, so a broken renderer cannot pass as "some bytes".
    expect(reply.rawPayload.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('describes an installable app whose icons exist', async () => {
    const reply = await get('/site.webmanifest');
    expect(reply.headers['content-type']).toContain('application/manifest+json');
    const manifest = JSON.parse(reply.body) as ReturnType<typeof webManifest>;
    expect(manifest).toMatchObject({
      name: 'Reflex Arcade',
      start_url: '/',
      display: 'standalone',
    });
    // Every icon it names has to be a route this server answers.
    for (const icon of manifest['icons'] as { src: string }[]) {
      expect((await get(icon.src)).statusCode).toBe(200);
    }
  });
});
