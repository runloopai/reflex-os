/**
 * Share cards: what a game looks like when its link is pasted somewhere
 * else — Slack, X, LinkedIn, Discord, iMessage, Notion.
 *
 * None of those clients run JavaScript. They fetch the URL, read the
 * `<head>`, and give up; a single-page app answers all of them with the
 * same empty shell, which is why an arcade link used to unfurl as a bare
 * hostname. So the server renders the tags into the HTML it serves for
 * `/g/:gameId` (in dev, the Vite plugin in `web/og-dev-plugin.ts` does it
 * with these same functions — one place decides what a card says).
 *
 * Everything here is pure and string-in/string-out, which is what makes it
 * shareable between those two callers and testable without a server.
 *
 * PRIVACY: a private game has no card. `shareCardFor` refuses one, and
 * every caller falls back to the arcade's own card — a link to a private
 * game unfurls as "Reflex Arcade", never as its title or its prompt.
 */
import type { GameRow } from './db.ts';

/** The fields every unfurl target needs, resolved to absolute URLs. */
export interface ShareCard {
  url: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  /** Present only for a game card; the arcade's own card has no author. */
  author: string | null;
  /** A live game embeds as a playable iframe through oEmbed. */
  embedUrl: string | null;
}

const SITE_NAME = 'Reflex Arcade';
const THEME_COLOR = '#7c3aed';

/** OG images are 1200x675 — 16:9, the aspect the agents draw covers in. */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 675;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Trim to a word boundary so a card never ends mid-word. */
export function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  // Only a first word longer than the whole budget gets cut mid-word;
  // anything else backs up to the last space, so a card never trails off
  // in the middle of one.
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The line under the title. What a stranger wants to know is what the game
 * is and that an agent is writing it right now — the prompt says the first
 * and the counts say the second, so the prompt leads and the stats follow.
 */
export function shareDescription(
  game: Pick<GameRow, 'prompt' | 'status' | 'plays'>,
  shippedCount: number,
): string {
  const stats: string[] = [];
  if (game.status === 'live') stats.push('Playable now');
  if (shippedCount > 0) {
    stats.push(`${shippedCount} suggestion${shippedCount === 1 ? '' : 's'} shipped`);
  }
  if (game.plays > 0) stats.push(`${game.plays} play${game.plays === 1 ? '' : 's'}`);
  const tail = stats.length
    ? `${stats.join(' · ')}. Watch the agent build it, then say what it should add.`
    : 'Watch the agent build it, then say what it should add.';
  return `${truncate(game.prompt, 140)} — ${tail}`;
}

/** The arcade's own card, used for `/`, for anything unknown, and for a private game. */
export function arcadeCard(origin: string): ShareCard {
  return {
    url: `${origin}/`,
    title: 'Reflex Arcade — games built live by agents',
    description:
      'Every game here is being written by a Reflex agent while you watch. Play the latest build, ' +
      'chat with the room, and heart the next thing it should build.',
    image: `${origin}/api/share-image`,
    imageAlt: 'Reflex Arcade',
    author: null,
    embedUrl: null,
  };
}

/**
 * A game's card, or null when it has none to give — private games and
 * games that do not exist are indistinguishable from the outside, which is
 * the point.
 */
export function shareCardFor(
  game: GameRow | null,
  ownerName: string,
  shippedCount: number,
  origin: string,
): ShareCard | null {
  if (!game || !game.isPublic) return null;
  return {
    url: `${origin}/g/${game.id}`,
    title: `${game.title} — built by Reflex Arcade`,
    description: shareDescription(game, shippedCount),
    // artVersion busts every cache between here and the reader the moment
    // the agent redraws its cover.
    image: `${origin}/api/games/${game.id}/og-image?v=${game.artVersion}`,
    imageAlt: `${game.title}, a game built live by a Reflex agent`,
    author: ownerName,
    embedUrl: game.status === 'live' && game.daemonUrl ? game.daemonUrl : null,
  };
}

/**
 * Schema.org JSON-LD. The meta tags above are what a chat client reads to
 * draw a card; this is what a search engine reads to know that `/g/:id` is
 * a game with an author rather than one more page on a site.
 *
 * A game is a `VideoGame`; the arcade itself is a `WebSite`. Both are only
 * ever built from a card, so a private game — which has no card — cannot
 * describe itself here either.
 */
export function structuredData(card: ShareCard): string {
  const data = card.author
    ? {
        '@context': 'https://schema.org',
        '@type': 'VideoGame',
        name: card.title,
        description: card.description,
        url: card.url,
        image: card.image,
        author: { '@type': 'Person', name: card.author },
        publisher: { '@type': 'Organization', name: SITE_NAME },
        applicationCategory: 'GameApplication',
        gamePlatform: 'Web browser',
      }
    : {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        description: card.description,
        url: card.url,
      };
  // `<` cannot appear inside a script element without ending it early; the
  // values here are titles and prompts people wrote, so escape rather than
  // trust. JSON.stringify has already handled quotes and newlines.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/**
 * The `<head>` tags. Open Graph carries Slack, LinkedIn, Discord and
 * iMessage; X reads the `twitter:` ones; the oEmbed link is discovery for
 * everything that prefers a JSON endpoint (Slack again, Notion, embed.ly),
 * and the JSON-LD block is for search engines.
 */
export function renderShareTags(card: ShareCard, oembedUrl: string): string {
  const tags: [string, string][] = [
    ['description', card.description],
    ['theme-color', THEME_COLOR],
  ];
  const properties: [string, string][] = [
    ['og:site_name', SITE_NAME],
    ['og:type', 'website'],
    ['og:url', card.url],
    ['og:title', card.title],
    ['og:description', card.description],
    ['og:image', card.image],
    ['og:image:width', String(OG_IMAGE_WIDTH)],
    ['og:image:height', String(OG_IMAGE_HEIGHT)],
    ['og:image:alt', card.imageAlt],
  ];
  const twitter: [string, string][] = [
    ['twitter:card', 'summary_large_image'],
    ['twitter:title', card.title],
    ['twitter:description', card.description],
    ['twitter:image', card.image],
    ['twitter:image:alt', card.imageAlt],
  ];
  // X renders label/data as a two-line byline under the card. (No
  // `article:author`: OGP wants a profile URL there, not a display name.)
  if (card.author) twitter.push(['twitter:label1', 'Built by'], ['twitter:data1', card.author]);
  const meta = (attr: string, pairs: [string, string][]) =>
    pairs.map(
      ([key, value]) => `<meta ${attr}="${escapeHtml(key)}" content="${escapeHtml(value)}" />`,
    );
  return [
    ...meta('name', tags),
    ...meta('property', properties),
    ...meta('name', twitter),
    `<link rel="canonical" href="${escapeHtml(card.url)}" />`,
    `<link rel="alternate" type="application/json+oembed" href="${escapeHtml(
      oembedUrl,
    )}" title="${escapeHtml(card.title)}" />`,
    `<script type="application/ld+json">${structuredData(card)}</script>`,
  ].join('\n    ');
}

/**
 * The tags this module owns, wherever they already appear in the shell.
 * `web/index.html` ships the arcade's own card so an un-injected load is
 * still shareable, and those defaults have to come OUT before a game's card
 * goes in: faced with two `og:title`s, crawlers take the first, so appending
 * would leave every game unfurling as the generic arcade card.
 *
 * Regex over HTML is a bad habit in general; it is safe on exactly this
 * input, which is our own shell — hand-written, then emitted by Vite.
 */
const OWNED_TAGS =
  /[ \t]*<meta[^>]*(?:property="og:[^"]*"|name="twitter:[^"]*"|name="description"|name="theme-color")[^>]*>\n?/gi;
const OWNED_LINKS = /[ \t]*<link[^>]*(?:rel="canonical"|json\+oembed)[^>]*>\n?/gi;
const OWNED_SCRIPT = /[ \t]*<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/gi;

export function stripShareTags(html: string): string {
  return html.replace(OWNED_TAGS, '').replace(OWNED_LINKS, '').replace(OWNED_SCRIPT, '');
}

/**
 * Splice a card into an HTML document, replacing whatever card was there.
 * The title is REPLACED rather than appended for the same reason: a second
 * `<title>` is ignored, so appending would leave the shell's title winning.
 */
export function injectShareTags(html: string, card: ShareCard, oembedUrl: string): string {
  const withTitle = stripShareTags(html).replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escapeHtml(card.title)}</title>`,
  );
  const tags = renderShareTags(card, oembedUrl);
  return withTitle.replace(/<\/head>/i, `  ${tags}\n  </head>`);
}

/** oEmbed 1.0 payload. Live games embed as the playable game itself. */
export const EMBED_MIN_WIDTH = 200;
export const EMBED_MAX_WIDTH = 960;

export function oEmbedFor(
  card: ShareCard,
  origin: string,
  maxWidth = EMBED_MAX_WIDTH,
): Record<string, unknown> {
  // Clamped, not just capped: a caller asking for 0 or a negative width
  // would otherwise get an iframe sized `width="-500"`.
  const width = Math.min(Math.max(Math.round(maxWidth), EMBED_MIN_WIDTH), EMBED_MAX_WIDTH);
  const height = Math.round((width * 9) / 16);
  const base = {
    version: '1.0',
    title: card.title,
    author_name: card.author ?? SITE_NAME,
    provider_name: SITE_NAME,
    provider_url: `${origin}/`,
    thumbnail_url: card.image,
    thumbnail_width: OG_IMAGE_WIDTH,
    thumbnail_height: OG_IMAGE_HEIGHT,
  };
  if (!card.embedUrl) return { ...base, type: 'link' };
  return {
    ...base,
    type: 'rich',
    width,
    height,
    html:
      `<iframe src="${escapeHtml(card.embedUrl)}" width="${width}" height="${height}" ` +
      `title="${escapeHtml(card.title)}" frameborder="0" ` +
      `allow="autoplay; fullscreen; gamepad" allowfullscreen></iframe>`,
  };
}

/**
 * The absolute origin this request arrived on. Cards must carry absolute
 * URLs — a crawler has no page to resolve a relative one against — and the
 * arcade is normally behind a tunnel, so the forwarded headers are the only
 * honest source. `ARCADE_PUBLIC_ORIGIN` overrides for odd deployments.
 */
export function originFromRequest(headers: Record<string, string | string[] | undefined>): string {
  const configured = process.env.ARCADE_PUBLIC_ORIGIN;
  if (configured) return configured.replace(/\/+$/, '');
  const first = (value: string | string[] | undefined): string | null => {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw ? (raw.split(',')[0] ?? '').trim() || null : null;
  };
  const candidate = first(headers['x-forwarded-host']) ?? first(headers.host) ?? 'localhost';
  // The Host header is the client's to set, and it lands in a card a
  // crawler will go and fetch — so only a plain `hostname[:port]` is
  // accepted. Userinfo, paths and stray punctuation would let a caller aim
  // the image, the oEmbed link and rel=canonical wherever they liked.
  // Pinning the origin outright is what `ARCADE_PUBLIC_ORIGIN` is for: set
  // it in production, where the public origin is known and fixed.
  const host = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(candidate) ? candidate : 'localhost';
  const proto =
    first(headers['x-forwarded-proto']) ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** Paths that are never an app route: the API, the proxy, and dev/build assets. */
const NOT_APP_ROUTE = ['/api', '/reflex', '/assets', '/@', '/src/', '/node_modules'];

/**
 * Whether a request should be answered with the app shell (and therefore a
 * share card).
 *
 * Decided by the PATH, not by `Accept`. Content negotiation looks like the
 * obvious test and gets it wrong in both directions: `facebookexternalhit`
 * asks for any content type at all and would silently receive an un-carded
 * shell — the exact failure the cards exist to fix — while `/favicon.ico`
 * fetched by something that does say `text/html` would receive HTML.
 * `HEAD` counts: several crawlers check a link that way before fetching it.
 */
export function isAppRoute(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const path = url.split(/[?#]/)[0] ?? '/';
  if (NOT_APP_ROUTE.some((prefix) => path.startsWith(prefix))) return false;
  // A file extension in the last segment means a real file (favicon.ico,
  // manifest.webmanifest); app routes never have one.
  return !(path.split('/').pop() ?? '').includes('.');
}

/** The game id an app path is for, or null — `/g/:gameId` and its subroutes. */
export function gameIdFromPath(url: string): string | null {
  const path = url.split(/[?#]/)[0] ?? '/';
  return path.match(/^\/g\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

/**
 * The game id in a URL that belongs to THIS arcade, or null. An oEmbed
 * provider answers for its own URLs only; matching the path anywhere in
 * any URL would make the arcade a card-rendering service for other
 * people's hosts.
 */
export function gameIdFromUrl(url: string | undefined, origin: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(origin).origin) return null;
    return parsed.pathname.match(/^\/g\/([A-Za-z0-9_-]+)$/)?.[1] ?? null;
  } catch {
    return null;
  }
}
