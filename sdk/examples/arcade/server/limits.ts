/**
 * What the front door refuses: too many requests from one caller, and
 * bodies too big for the route that would receive them.
 *
 * A demo on a laptop needs none of this. A public arcade does: every write
 * here is unauthenticated or one free `POST /api/join` away from it, and the
 * expensive ones are expensive on someone else's bill — creating a game
 * launches a real Reflex agent under the owner's key. Without a limit, one
 * script fills the shelf, the chat, and the suggestion queue.
 *
 * Two deliberate choices:
 *
 * - **Keyed by IP, not by token.** A token is free — `POST /api/join` mints
 *   one with no email, no password and no captcha — so limiting by token
 *   limits nobody. The address is the only identity a caller has to spend
 *   something to change. The cost is that a shared NAT shares a budget,
 *   which is why the limits below are generous rather than tight: they are
 *   sized to stop a script, not to ration a person.
 * - **In-process.** The arcade is one container (see README, Hosting), so a
 *   Map is the whole store. Two replicas would each allow the full budget;
 *   that is the point at which this needs to move to the database or a CDN
 *   rule, and it is called out here rather than discovered later.
 *
 * `req.ip` is only the caller's address when Fastify is told how many
 * proxies sit in front (`trustProxy`, see `config.ts`) — otherwise every
 * request appears to come from the load balancer and shares one bucket.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface RateRule {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The limits, keyed by `METHOD <route pattern>` — Fastify's own registered
 * URL (`/api/games/:gameId/chat`), not the concrete path, so a rule cannot
 * be dodged by varying an id and cannot silently stop matching when a route
 * moves.
 *
 * Reads are absent on purpose: they are cheap, several of them are the
 * public shop window, and a CDN is the right place to absorb them. What is
 * here is everything that writes a row, spends an upstream call, or mints a
 * credential.
 */
export const RATE_LIMITS: Record<string, RateRule> = {
  // Account creation. The one route that hands out a credential to a caller
  // who has none, so it is the cheapest thing on the site to abuse.
  'POST /api/join': { limit: 10, windowMs: HOUR },
  // Presenting an existing token. Tokens are 40 random characters and are
  // not realistically guessable; this is here so trying is not free either.
  'POST /api/login': { limit: 20, windowMs: HOUR },

  // Launches a real agent on a real devbox. The most expensive request the
  // arcade can be asked to make, and the bill lands on the owner's Reflex
  // organization.
  'POST /api/games': { limit: 10, windowMs: HOUR },

  // Reaches Reflex on the caller's behalf with credentials they supplied.
  'POST /api/me/reflex-keys': { limit: 20, windowMs: HOUR },
  'POST /api/me/reflex-connect': { limit: 20, windowMs: HOUR },
  // Polled by the browser every few seconds for up to ten minutes while a
  // player approves the flow in Reflex, so this one is a ceiling on runaway
  // clients rather than a limit anybody should ever meet.
  'POST /api/me/reflex-connect/:connectionId/poll': { limit: 300, windowMs: HOUR },

  // Profile writes carry a ~64KB avatar each.
  'PATCH /api/me': { limit: 30, windowMs: MINUTE },

  // Room traffic. Chat is meant to feel like a chat, so this is set where a
  // fast typist never notices it and a bot does.
  'POST /api/games/:gameId/chat': { limit: 30, windowMs: MINUTE },
  'POST /api/games/:gameId/suggestions': { limit: 10, windowMs: MINUTE },
  'PATCH /api/games/:gameId/suggestions/:suggestionId': { limit: 30, windowMs: MINUTE },
  // Hearts steer the dispatcher, so ballot-stuffing changes what the agent
  // builds next. Toggling is idempotent per user, which is what keeps this
  // limit about scripts rather than about enthusiasm.
  'POST /api/games/:gameId/suggestions/:suggestionId/heart': { limit: 60, windowMs: MINUTE },

  // The Reflex proxy. Owner-gated for writes, but the gate is in the
  // HANDLER — by the time it says no, the body has been read, and this is
  // the one route allowed to read a 32MB one. So the limit has to come
  // first. Sized for the chat pane, which sends a turn per message.
  'POST /reflex/:gameId/api/*': { limit: 60, windowMs: MINUTE },
};

/**
 * Body limits, as Fastify's own `bodyLimit` rather than a check of our own.
 *
 * The obvious version of this — read `Content-Length` in a hook and refuse —
 * does not work: a chunked request declares no length and walks straight
 * past it, which is the case that matters, because an attacker picks the
 * encoding. Fastify counts bytes off the stream as they arrive and aborts
 * mid-body, so the limit has to be its own.
 *
 * The default is therefore the SMALL one, and the proxy route raises it for
 * itself. That way round because it is the safe default: a route added later
 * gets the cap without anyone remembering, and only the one route whose
 * bodies are legitimately enormous — agent messages carrying base64 image
 * attachments — has to say so. (A per-route `bodyLimit` beats a
 * content-type parser's; see `_parserOptions` in Fastify's `context.js`.
 * The parser in `proxy.ts` used to carry this number and never applied it.)
 */
export const MAX_API_BODY_BYTES = 256 * 1024;
export const MAX_PROXY_BODY_BYTES = 32 * 1024 * 1024;

/** Fixed-window counters, keyed by `<rate-limit key>|<caller>`. */
interface Window {
  count: number;
  resetAt: number;
}

/**
 * How many callers to track before sweeping. Well above any real audience
 * for this demo, and low enough that a flood of forged addresses cannot
 * grow the map without bound.
 */
const MAX_TRACKED = 20_000;

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly rules: Record<string, RateRule> = RATE_LIMITS) {}

  /**
   * Record a request and say how long the caller must wait, or null when
   * they are within their budget. Routes with no rule are always allowed.
   */
  hit(ruleKey: string, caller: string, now = Date.now()): { retryAfterMs: number } | null {
    const rule = this.rules[ruleKey];
    if (!rule) return null;
    const key = `${ruleKey}|${caller}`;
    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      if (this.windows.size >= MAX_TRACKED) this.sweep(now);
      this.windows.set(key, { count: 1, resetAt: now + rule.windowMs });
      return null;
    }
    existing.count += 1;
    if (existing.count <= rule.limit) return null;
    return { retryAfterMs: existing.resetAt - now };
  }

  /**
   * Drop expired windows. If that frees nothing — a genuine flood of
   * distinct callers, all inside their windows — the map is cleared rather
   * than grown: forgetting counts costs an attacker one more round of
   * requests, and remembering them without bound costs the process its
   * memory. Failing open on a bounded resource beats falling over.
   */
  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
    if (this.windows.size >= MAX_TRACKED) this.windows.clear();
  }

  /** Test seam: how many windows are being tracked. */
  get size(): number {
    return this.windows.size;
  }
}

/** The rule key for a request: its method and the route pattern it matched. */
export function ruleKeyFor(req: Pick<FastifyRequest, 'method' | 'routeOptions'>): string {
  return `${req.method} ${req.routeOptions?.url ?? ''}`;
}

/**
 * Install the rate limits as an `onRequest` hook — the earliest point at
 * which the matched route is known and the body has not been read. (Body
 * size is Fastify's own `bodyLimit`; see above.)
 */
export function registerLimits(app: FastifyInstance, limiter = new RateLimiter()): void {
  app.addHook('onRequest', async (req, reply) => {
    const exceeded = limiter.hit(ruleKeyFor(req), req.ip);
    if (!exceeded) return;
    const seconds = Math.max(1, Math.ceil(exceeded.retryAfterMs / 1000));
    req.log.warn({ route: ruleKeyFor(req), ip: req.ip }, 'rate limit exceeded');
    return reply
      .status(429)
      .header('retry-after', String(seconds))
      .send({ error: 'rate_limited', message: 'Too many requests. Try again in a moment.' });
  });
}
