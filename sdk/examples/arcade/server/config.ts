/**
 * Server configuration, read once from the environment.
 *
 * The demo talks to one Reflex deployment (`REFLEX_BASE_URL`); each game
 * owner brings their own personal API key, stored per user in PGLite and
 * only ever used server-side.
 */
export interface ArcadeConfig {
  /** Port the demo API + web host listens on. */
  port: number;
  host: string;
  /** Reflex server origin (no /api suffix). Point at the mock for offline runs. */
  reflexBaseUrl: string;
  /** Agent type used for game agents. */
  reflexAgentType: string;
  /** PGLite data directory. */
  dataDir: string;
  /** Serve the built web app (web/dist) when it exists. */
  serveWeb: boolean;
}

/**
 * Default Reflex origin: explicit REFLEX_BASE_URL wins; otherwise reuse
 * REFLEX_API_URL when the process runs on a Reflex-managed box (it includes
 * the /api suffix the SDK adds itself); otherwise a local dev server.
 */
function defaultReflexBaseUrl(): string {
  const explicit = process.env.REFLEX_BASE_URL;
  if (explicit) return explicit;
  const managed = process.env.REFLEX_API_URL;
  if (managed) return managed.replace(/\/api\/?$/, '');
  return 'http://localhost:4000';
}

export function loadConfig(): ArcadeConfig {
  return {
    port: Number(process.env.PORT ?? 8790),
    host: process.env.HOST ?? '127.0.0.1',
    reflexBaseUrl: defaultReflexBaseUrl().replace(/\/+$/, ''),
    reflexAgentType: process.env.REFLEX_AGENT_TYPE ?? 'claude-code',
    dataDir: process.env.ARCADE_DATA_DIR ?? new URL('../.data', import.meta.url).pathname,
    serveWeb: process.env.NODE_ENV === 'production',
  };
}
