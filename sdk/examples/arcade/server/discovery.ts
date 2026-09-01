/**
 * The files something asks for before, or instead of, a page: `robots.txt`,
 * `sitemap.xml`, the icons a browser and an unfurl put next to the title,
 * and the web manifest that makes the arcade installable on a phone.
 *
 * They exist for one reason. The shelf is rendered by the app, so a crawler
 * that does not run JavaScript sees a page with no links on it — every game
 * has a good card and none of them is reachable. The sitemap is the link
 * graph, and it lists public games only: a private game is not discoverable
 * from the outside and must not become discoverable here.
 *
 * The icon is drawn here rather than committed as a file so the SVG source
 * is the only copy — the PNG that iOS insists on is rasterized from it with
 * the same renderer the share cards use.
 */
import { Resvg } from '@resvg/resvg-js';
import type { FastifyInstance } from 'fastify';
import type { ArcadeDb } from './db.ts';
import { CACHE } from './http-cache.ts';
import { originFromRequest } from './share.ts';

/** How long a crawler may keep these; short, they list live games. */
const DISCOVERY_MAX_AGE = 'public, max-age=300';

/** Apple wants a square PNG at this size and will not take an SVG. */
const APPLE_TOUCH_SIZE = 180;

/**
 * The arcade's mark: the violet-to-fuchsia square the nav wears, with a
 * gamepad cut into it. Kept plain — no external references, no filters —
 * because it is also the source the rasterizer reads.
 */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#d946ef"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <g fill="#ffffff">
    <rect x="12" y="24" width="40" height="22" rx="11"/>
    <rect x="17" y="31" width="12" height="3.2" rx="1.6" fill="#8b5cf6"/>
    <rect x="21.4" y="26.6" width="3.2" height="12" rx="1.6" fill="#8b5cf6"/>
    <circle cx="42" cy="31.5" r="2.6" fill="#8b5cf6"/>
    <circle cx="46.5" cy="37" r="2.6" fill="#8b5cf6"/>
  </g>
</svg>`;

/** Rasterized once per process: the bytes never change. */
let appleTouchIcon: Buffer | null = null;

function appleTouchIconPng(): Buffer {
  appleTouchIcon ??= Buffer.from(
    new Resvg(ICON_SVG, {
      fitTo: { mode: 'width', value: APPLE_TOUCH_SIZE },
      // Opaque: iOS composites a home-screen icon on white otherwise, and
      // the mark's corners would show it.
      background: '#09090b',
    })
      .render()
      .asPng(),
  );
  return appleTouchIcon;
}

/**
 * Crawl the pages, skip the machinery. `/api` and `/reflex` are not pages —
 * they are JSON, an image, or somebody's authenticated proxy — and a
 * crawler spending its budget there finds nothing to show anyone.
 */
export function robotsTxt(origin: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /reflex/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

export interface SitemapEntry {
  path: string;
  lastmod?: string | undefined;
}

/**
 * Google takes 50,000 URLs per sitemap. Far past anything this demo will
 * hold, but a truncated sitemap that says nothing about being truncated is
 * how a site quietly stops being indexed, so the cap is explicit.
 */
const SITEMAP_MAX_URLS = 50_000;

export function sitemapXml(origin: string, entries: SitemapEntry[]): string {
  const urls = entries.slice(0, SITEMAP_MAX_URLS).map((entry) => {
    const loc = `${origin}${entry.path}`.replace(/&/g, '&amp;');
    const lastmod = entry.lastmod ? `\n    <lastmod>${entry.lastmod.slice(0, 10)}</lastmod>` : '';
    return `  <url>\n    <loc>${loc}</loc>${lastmod}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** The manifest a phone reads when someone adds the arcade to their home screen. */
export function webManifest(): Record<string, unknown> {
  return {
    name: 'Reflex Arcade',
    short_name: 'Arcade',
    description: 'Games built live by Reflex agents, steered by the chat.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#7c3aed',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}

export function registerDiscoveryRoutes(app: FastifyInstance, db: ArcadeDb): void {
  app.get('/robots.txt', async (req, reply) =>
    reply
      .type('text/plain; charset=utf-8')
      .header('cache-control', DISCOVERY_MAX_AGE)
      .send(robotsTxt(originFromRequest(req.headers))),
  );

  app.get('/sitemap.xml', async (req, reply) => {
    const listed = await db.listedGamesFor(null);
    const entries: SitemapEntry[] = [
      { path: '/' },
      { path: '/about' },
      // `createdAt` rather than a change time: a game's title, art and
      // status move constantly and the row does not record when. Claiming
      // "modified today" on every crawl of every game would be a lie the
      // crawler learns to ignore.
      ...listed.map(({ game }) => ({ path: `/g/${game.id}`, lastmod: game.createdAt })),
    ];
    return reply
      .type('application/xml; charset=utf-8')
      .header('cache-control', DISCOVERY_MAX_AGE)
      .send(sitemapXml(originFromRequest(req.headers), entries));
  });

  for (const path of ['/favicon.svg', '/icon.svg']) {
    app.get(path, async (_req, reply) =>
      reply.type('image/svg+xml').header('cache-control', CACHE.hour).send(ICON_SVG),
    );
  }

  app.get('/apple-touch-icon.png', async (_req, reply) =>
    reply.type('image/png').header('cache-control', CACHE.hour).send(appleTouchIconPng()),
  );

  app.get('/site.webmanifest', async (_req, reply) =>
    reply
      .type('application/manifest+json; charset=utf-8')
      .header('cache-control', CACHE.hour)
      .send(JSON.stringify(webManifest())),
  );
}
