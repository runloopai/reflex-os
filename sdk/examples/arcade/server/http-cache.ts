/**
 * What every response says about being cached.
 *
 * The arcade is meant to sit behind a CDN, and a CDN is a shared cache: a
 * response it stores for one reader it may hand to the next. Most of this
 * app's JSON depends on who is asking — `GET /api/games` answers the public
 * shelf to a stranger and the caller's own games to a player, on the same
 * URL — so the default here is "never store this", and caching is something
 * a route opts into by naming a policy.
 *
 * The default is applied to every `/api` and `/reflex` response by a hook
 * rather than by each handler, so a route added later is private without
 * anyone remembering to make it so.
 */
import type { FastifyInstance } from 'fastify';

export const CACHE = {
  /**
   * Depends on the bearer token, or must not be served twice (a
   * healthcheck, a mutation). `private` keeps CDNs out even if they ignore
   * `no-store`; `Vary` is for the ones that key on headers anyway.
   */
  private: 'private, no-store',
  /**
   * Public bytes at a URL that changes when the bytes do — art and share
   * images carry `?v=<artVersion>`. Only correct when the version in the
   * request matches what is being served; see `versioned`.
   */
  immutable: 'public, max-age=31536000, immutable',
  /** Public and mutable: cheap to re-ask, so keep the window short. */
  short: 'public, max-age=60',
  /** Public and effectively fixed — the arcade's own card, not a game's. */
  hour: 'public, max-age=3600',
} as const;

/**
 * `immutable` only when the caller asked for the version being served.
 * Requests with no `?v=`, or a stale one, get bytes that will change under
 * that URL — pinning those into a shared cache for a year is how a game ends
 * up wearing another game's cover art for the rest of its life.
 */
export function versioned(requested: unknown, current: number): string {
  return String(requested) === String(current) ? CACHE.immutable : CACHE.short;
}

/** Paths whose responses are private unless their handler says otherwise. */
const PRIVATE_BY_DEFAULT = ['/api', '/reflex'];

export function registerCachePolicy(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply) => {
    const url = req.raw.url ?? '/';
    if (!PRIVATE_BY_DEFAULT.some((prefix) => url.startsWith(prefix))) return;
    // Anything a handler declared public (art, share cards, oEmbed) keeps it.
    if (!reply.getHeader('cache-control')) reply.header('cache-control', CACHE.private);
    // Only on the private ones. These bodies are the ones that change with
    // the token; saying so on the public bytes just splits a CDN's cache
    // into a with-header and a without-header copy of identical answers.
    if (String(reply.getHeader('cache-control')).includes('private')) {
      appendVary(reply, 'authorization');
    }
  });
}

/**
 * Add a field to `Vary` without dropping what is already there —
 * `accept-encoding` is set by the compression layer, and overwriting it
 * makes a proxy serve gzip bytes to a client that cannot read them.
 */
function appendVary(
  reply: { getHeader(k: string): unknown; header(k: string, v: string): void },
  field: string,
): void {
  const current = reply.getHeader('vary');
  const fields = String(current ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (fields.some((value) => value.toLowerCase() === field)) return;
  reply.header('vary', [...fields, field].join(', '));
}

/**
 * Cache headers for the built web app. Vite fingerprints everything under
 * `assets/`, so those URLs can never go stale; `index.html` is the opposite —
 * it names this build's fingerprints and carries per-request share tags, so
 * storing it anywhere serves an old app or another page's card.
 */
export function staticCacheHeaders(
  res: { setHeader(k: string, v: string): void },
  path: string,
): void {
  res.setHeader(
    'cache-control',
    /\/assets\/.+-[A-Za-z0-9_-]{8,}\.\w+$/.test(path) ? CACHE.immutable : CACHE.private,
  );
}
