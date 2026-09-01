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
  return {
    kind: 'pglite',
    dataDir: env['ARCADE_DATA_DIR'] ?? new URL('../.data', import.meta.url).pathname,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ArcadeConfig {
  return {
    port: Number(env['PORT'] ?? 8790),
    host: env['HOST'] ?? '127.0.0.1',
    reflexBaseUrl: defaultReflexBaseUrl(env).replace(/\/+$/, ''),
    reflexAgentType: env['REFLEX_AGENT_TYPE'] ?? 'claude-code',
    store: resolveStore(env),
    serveWeb: env['NODE_ENV'] === 'production',
  };
}
