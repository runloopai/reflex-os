/**
 * Share images.
 *
 * The agents draw their covers as SVG, and not one unfurl target renders
 * SVG in a card — X, Slack, LinkedIn and Discord all want a raster. So the
 * cover is rasterized here, once per `artVersion`, and served as PNG.
 *
 * A game with no cover yet still has to unfurl with something better than a
 * blank rectangle, so it gets a generated card: the arcade's own gradient
 * with the game's title set into it.
 */
import { Resvg } from '@resvg/resvg-js';
import { escapeHtml, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from './share.ts';

/** Raster types an unfurl target accepts as-is; anything else is rendered. */
const PASSTHROUGH = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export interface ShareImage {
  body: Buffer;
  contentType: string;
}

/**
 * Rasterized cards, keyed by `${gameId}:${artVersion}`. Unfurl targets are
 * chatty — every reader of a busy Slack channel can trigger a fetch — and
 * rendering the same SVG for each of them is pure waste.
 *
 * Least-recently-used, and bounded by BYTES as well as entries: a
 * count-only bound says nothing when a single entry can be a megabyte, and
 * plain insertion order would let a caller cycling through more games than
 * the cache holds miss every single time — turning a cost paid once per
 * cover into one paid per request.
 */
const CACHE_ENTRIES = 64;
const CACHE_BYTES = 32 * 1024 * 1024;
const cache = new Map<string, ShareImage>();
let cachedBytes = 0;

function recall(key: string): ShareImage | null {
  const hit = cache.get(key);
  if (!hit) return null;
  // Re-insert so the Map's iteration order is genuinely least-recently-used.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function remember(key: string, image: ShareImage): ShareImage {
  cache.set(key, image);
  cachedBytes += image.body.byteLength;
  while (cache.size > CACHE_ENTRIES || cachedBytes > CACHE_BYTES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cachedBytes -= cache.get(oldest.value)?.body.byteLength ?? 0;
    cache.delete(oldest.value);
  }
  return image;
}

/** Split a `data:` URL into its media type and bytes. */
export function decodeDataUrl(dataUrl: string): { mediaType: string; bytes: Buffer } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
  if (!match) return null;
  return { mediaType: match[1]!, bytes: Buffer.from(match[2]!, 'base64') };
}

/**
 * The most an agent's cover may weigh before we decline to render it. The
 * watcher already caps what it stores; this is the renderer refusing to
 * trust that, because render cost tracks input size.
 */
export const MAX_SVG_BYTES = 512 * 1024;

const FILTER_ELEMENT = /<filter\b[\s\S]*?<\/\s*filter\s*>/gi;
const FILTER_ATTRIBUTE = /\sfilter\s*=\s*(?:"[^"]*"|'[^']*')/gi;
const EXTERNAL_REFERENCE = /\s(?:xlink:)?href\s*=\s*(?:"(?!data:)[^"]*"|'(?!data:)[^']*')/gi;

/** Anything left that would still make rendering unsafe. */
const RESIDUE = [/<\s*filter\b/i, /<\s*fe[A-Za-z]/i, /(?:xlink:)?href\s*=\s*(?!["']?data:)/i];

/**
 * Make an agent-authored SVG safe to rasterize IN THIS PROCESS, or refuse
 * it. Returns null when the cover cannot be made safe — the caller draws
 * the generated card instead, so refusing costs a game nothing.
 *
 * The covers are written by an agent on a devbox — untrusted input by
 * construction — and rasterizing is a blocking native call on the event
 * loop. Two things in SVG turn that into a weapon, and neither is anything
 * a game cover needs:
 *
 * - **Filters.** `feGaussianBlur` with a large `stdDeviation`, or
 *   `feTurbulence` with a high `numOctaves`, costs seconds of CPU from a
 *   few hundred bytes of markup. One unauthenticated request for such a
 *   cover stalls the API, the hub socket and the Reflex relay alike.
 * - **External references.** resvg resolves a non-`data:` `href` as a path
 *   on THIS machine's disk, so `<image href="/some/file.png">` renders a
 *   local file into a public share card.
 *
 * Stripping is a regex pass, and a regex pass over markup is never
 * airtight — so it is not what the safety rests on. Stripping runs to a
 * fixed point, and then the result is CHECKED: if any trace of either
 * hazard survives, the cover is refused outright. Fail closed, and the
 * regexes only have to be good enough to clear the common case.
 *
 * Note what is deliberately absent: no `<script>` scrubbing. This string
 * is only ever handed to the rasterizer, which ignores script and returns
 * a PNG — pretending otherwise would suggest this output is safe to serve
 * as markup, which it is not and never needs to be. (The browser-facing
 * `/api/games/:id/art/:kind` route serves the ORIGINAL art under its own
 * content type, exactly as it did before share cards existed.)
 */
export function sanitizeSvg(svg: string): string | null {
  let out = svg;
  let previous: string;
  do {
    previous = out;
    out = out
      .replace(FILTER_ELEMENT, '')
      .replace(FILTER_ATTRIBUTE, '')
      .replace(EXTERNAL_REFERENCE, '');
  } while (out !== previous);
  return RESIDUE.some((pattern) => pattern.test(out)) ? null : out;
}

function rasterize(svg: string): ShareImage {
  const safe = sanitizeSvg(svg);
  if (safe === null) throw new Error('cover cannot be rendered safely');
  const resvg = new Resvg(safe, {
    // Width-fitted rather than boxed: the covers are 16:9 already, and
    // scaling to a fixed box would letterbox art that is the right shape.
    fitTo: { mode: 'width', value: OG_IMAGE_WIDTH },
    font: { loadSystemFonts: true },
    background: '#09090b',
  });
  return { body: Buffer.from(resvg.render().asPng()), contentType: 'image/png' };
}

/**
 * Greedy wrap by character budget. resvg has no text layout engine to ask
 * for real measurements, so this approximates with an average glyph width —
 * close enough for a title set at one of two sizes, and the line count is
 * capped so a long title can never run off the card.
 */
export function wrapTitle(title: string, perLine: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = '';
  // A single word longer than the line is hard-sliced: it can never fit,
  // and left whole it runs straight off the side of the card.
  const words = title
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .flatMap((word) => word.match(new RegExp(`.{1,${perLine}}`, 'g')) ?? []);
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= perLine || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && current && lines[maxLines - 1] !== current) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, perLine - 1)}…`;
  }
  return lines;
}

/**
 * The fallback card: the arcade's look (near-black, violet and fuchsia
 * blooms, a hairline grid) with the title set over it. Deliberately
 * hand-written SVG — it is rasterized by the same path as the agents' art.
 */
export function fallbackCardSvg(title: string, author: string | null): string {
  const lines = wrapTitle(title, 22, 3);
  const fontSize = lines.length > 2 ? 74 : 92;
  const blockHeight = lines.length * fontSize * 1.12;
  const top = OG_IMAGE_HEIGHT / 2 - blockHeight / 2 + fontSize * 0.85;
  const body = lines
    .map(
      (line, index) =>
        `<text x="80" y="${Math.round(top + index * fontSize * 1.12)}" fill="#fafafa" ` +
        `font-family="DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif" ` +
        `font-size="${fontSize}" font-weight="bold">${escapeHtml(line)}</text>`,
    )
    .join('');
  const byline = author
    ? `<text x="80" y="${OG_IMAGE_HEIGHT - 66}" fill="#a1a1aa" ` +
      `font-family="DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif" ` +
      `font-size="30">by ${escapeHtml(author)} · an agent is writing it now</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" viewBox="0 0 ${OG_IMAGE_WIDTH} ${OG_IMAGE_HEIGHT}">
  <defs>
    <radialGradient id="violet" cx="0.85" cy="0" r="0.9">
      <stop offset="0" stop-color="#7c3aed" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cyan" cx="0.05" cy="1" r="0.9">
      <stop offset="0" stop-color="#0ea5e9" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#0ea5e9" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a78bfa"/>
      <stop offset="1" stop-color="#e879f9"/>
    </linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M48 0H0V48" fill="none" stroke="#ffffff" stroke-opacity="0.03" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" fill="#09090b"/>
  <rect width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" fill="url(#grid)"/>
  <rect width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" fill="url(#violet)"/>
  <rect width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" fill="url(#cyan)"/>
  <rect x="80" y="64" width="44" height="44" rx="12" fill="url(#mark)"/>
  <text x="140" y="96" fill="#fafafa" font-family="DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif" font-size="30" font-weight="bold">Reflex Arcade</text>
  <text x="80" y="${OG_IMAGE_HEIGHT - 118}" fill="#34d399" font-family="DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif" font-size="24" letter-spacing="3">BUILT LIVE BY AN AGENT</text>
  ${body}
  ${byline}
</svg>`;
}

/**
 * The share image for a game: its own cover when it has drawn one,
 * otherwise a generated card. Cached per `artVersion`, so a redraw
 * publishes a new image and every stale one falls out.
 */
export function shareImageFor(input: {
  gameId: string;
  artVersion: number;
  title: string;
  author: string | null;
  previewArt: string | null;
}): ShareImage {
  const key = `${input.gameId}:${input.artVersion}:${input.previewArt ? 'art' : 'card'}`;
  const hit = recall(key);
  if (hit) return hit;

  const decoded = input.previewArt ? decodeDataUrl(input.previewArt) : null;
  if (decoded && PASSTHROUGH.has(decoded.mediaType)) {
    return remember(key, { body: decoded.bytes, contentType: decoded.mediaType });
  }
  try {
    // Render cost tracks input size, and this input is agent-authored, so
    // an oversized cover gets the generated card rather than the benefit of
    // the doubt.
    const usable =
      decoded?.mediaType.startsWith('image/svg') && decoded.bytes.byteLength <= MAX_SVG_BYTES;
    const svg = usable
      ? decoded!.bytes.toString('utf8')
      : fallbackCardSvg(input.title, input.author);
    return remember(key, rasterize(svg));
  } catch {
    // Agent-authored art that resvg refuses (a bad filter, a broken path)
    // must not cost the game its card — the generated one always renders.
    return remember(key, rasterize(fallbackCardSvg(input.title, input.author)));
  }
}

/** The arcade's own card, for `/` and for links that resolve to nothing. */
export function arcadeShareImage(): ShareImage {
  const key = 'arcade:card';
  const hit = recall(key);
  if (hit) return hit;
  return remember(
    key,
    rasterize(fallbackCardSvg('Games built live by agents, steered by everyone watching', null)),
  );
}
