/**
 * Server configuration, read once from the environment.
 *
 * The demo talks to one Reflex deployment (`REFLEX_BASE_URL`); each game
 * owner brings their own personal API key, stored per user in the arcade's
 * database and only ever used server-side.
 */
import type { ArcadeStore } from './sql.ts';

export interface ArcadeConfig {
  /** Port the demo API + web host listens on. */
  port: number;
  host: string;
  /** Reflex server origin (no /api suffix). Point at the mock for offline runs. */
  reflexBaseUrl: string;
  /** Agent type used for game agents. */
  reflexAgentType: string;
  /** Where rows live: a Postgres server, or an embedded PGLite data dir. */
  store: ArcadeStore;
  /** Serve the built web app (web/dist) when it exists. */
  serveWeb: boolean;
  /** How many proxies sit in front (Fastify's `trustProxy`); see below. */
  trustProxy: number | boolean;
}

/**
 * Default Reflex origin: explicit REFLEX_BASE_URL wins; otherwise reuse
 * REFLEX_API_URL when the process runs on a Reflex-managed box (it includes
 * the /api suffix the SDK adds itself); otherwise a local dev server.
 */
function defaultReflexBaseUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env['REFLEX_BASE_URL'];
  if (explicit) return explicit;
  const managed = env['REFLEX_API_URL'];
  if (managed) return managed.replace(/\/api\/?$/, '');
  return 'http://localhost:4000';
}

/**
 * A connection string wins over the data dir: a hosted arcade runs on a
 * container whose disk goes away with the deploy, so as soon as one is
 * configured it is the only place the data can safely live. Without one the
 * demo stays self-contained — `npm run dev` needs no database to install.
 *
 * `ARCADE_DATABASE_URL` exists for the case where the process already has
 * some other `DATABASE_URL` in its environment.
 */
export function resolveStore(env: NodeJS.ProcessEnv): ArcadeStore {
  const url = env['ARCADE_DATABASE_URL'] ?? env['DATABASE_URL'];
  if (url) return { kind: 'postgres', url };
  const dataDir = env['ARCADE_DATA_DIR'];
  // A hosted container has no durable disk: nothing written to its
  // filesystem survives a deploy. Falling back to one there does not fail —
  // it works perfectly, right up to the next release, and then every player,
  // game and saved Reflex key is gone. Refuse at boot instead, where the
  // message is readable, rather than at the deploy where it is silent.
  //
  // What is refused is the ACCIDENT — production with neither setting. A
  // production-mode run that names its data dir has chosen the disk on
  // purpose, which is how the local `NODE_ENV=production` preview and the
  // smoke-test stack both run (see README).
  if (env['NODE_ENV'] === 'production' && !dataDir) {
    throw new Error(
      'DATABASE_URL is required in production: the container filesystem does not survive a ' +
        'deploy. Set ARCADE_DATA_DIR instead only for a local production-mode run.',
    );
  }
  return { kind: 'pglite', dataDir: dataDir ?? new URL('../.data', import.meta.url).pathname };
}

/**
 * How many proxy hops to believe.
 *
 * Hosted, every request arrives from a load balancer, so `req.ip` is that
 * balancer for all of them — and the per-IP rate limits in `limits.ts` would
 * put the entire internet in one bucket. Fastify reads the caller's real
 * address out of `X-Forwarded-For` when told how many hops to trust.
 *
 * A COUNT rather than `true`: that header is a list anyone may prepend to,
 * and trusting it wholesale lets a caller invent an address per request and
 * walk straight through any limit keyed on one. Counting from the right
 * takes the address the nearest trusted proxy actually observed. The default
 * is one hop — a single load balancer, which is how the arcade is deployed
 * (README, Hosting). Put a CDN in front of that and it becomes two:
 * `ARCADE_TRUST_PROXY=2`.
 *
 * Locally there is no proxy at all, so nothing is trusted and `req.ip` is
 * the socket's own address.
 */
export function resolveTrustProxy(env: NodeJS.ProcessEnv): number | boolean {
  const configured = env['ARCADE_TRUST_PROXY'];
  if (configured === undefined) return env['NODE_ENV'] === 'production' ? 1 : false;
  const hops = Number(configured);
  // A typo must not quietly become "trust nothing": that puts every caller
  // behind the balancer into one rate-limit bucket, so the first busy minute
  // locks the whole site out of joining. Loud at boot beats subtle later.
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error(`ARCADE_TRUST_PROXY must be a hop count (0, 1, 2, ...); got "${configured}".`);
  }
  return hops;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ArcadeConfig {
  return {
    port: Number(env['PORT'] ?? 8790),
    host: env['HOST'] ?? '127.0.0.1',
    reflexBaseUrl: defaultReflexBaseUrl(env).replace(/\/+$/, ''),
    reflexAgentType: env['REFLEX_AGENT_TYPE'] ?? 'claude-code',
    store: resolveStore(env),
    serveWeb: env['NODE_ENV'] === 'production',
    trustProxy: resolveTrustProxy(env),
  };
}
