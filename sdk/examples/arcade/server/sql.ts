/**
 * The arcade's SQL connection, in the two shapes it runs in.
 *
 * - **PGLite**, an embedded Postgres in a data dir: local dev, tests, and
 *   offline demos, where standing up a server would be the whole setup.
 * - **Postgres**, a real server behind `DATABASE_URL`: hosted deployments,
 *   where the container's disk is not durable and more than one process may
 *   eventually read the data.
 *
 * Both speak the same dialect, so `db.ts` writes one set of queries against
 * `SqlDriver` rather than one per backend. Snapshotting is the only place
 * they differ in kind: PGLite has to defend itself against a corrupt data
 * dir, while a managed Postgres has real backups — so `snapshot()` returns
 * the path it wrote, or `null` for a driver that has nothing to do.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export type Row = Record<string, unknown>;

/** Where the arcade's rows live, as chosen by `loadConfig`. */
export type ArcadeStore = { kind: 'postgres'; url: string } | { kind: 'pglite'; dataDir: string };

export interface SqlDriver {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Run one or more statements with no parameters (schema setup). */
  exec(sql: string): Promise<void>;
  /**
   * Write a point-in-time snapshot and prune to the newest `keep`, returning
   * the file written — or `null` for a store that snapshots itself.
   */
  snapshot(keep?: number): Promise<string | null>;
  close(): Promise<void>;
}

export async function openDriver(store: ArcadeStore): Promise<SqlDriver> {
  return store.kind === 'postgres' ? openPostgres(store.url) : openPglite(store.dataDir);
}

// -- postgres ---------------------------------------------------------------

/**
 * A pooled connection to a real Postgres. TLS settings come from the URL
 * (`sslmode=...`), because that is where a provider puts them; Railway's
 * private-network URL is plaintext and needs none.
 */
function openPostgres(url: string): SqlDriver {
  const pool = new pg.Pool({ connectionString: url });
  // An idle client that dies (deploy, failover) emits on the pool, and an
  // unhandled 'error' event would take the server down with it. The pool
  // discards the client itself; the next query opens a fresh one.
  pool.on('error', (err) => console.error('[arcade] idle postgres client error', err));
  return {
    query: async <T extends Row = Row>(sql: string, params?: unknown[]) => {
      const result = await pool.query(sql, params);
      return { rows: result.rows as T[] };
    },
    exec: async (sql: string) => {
      await pool.query(sql);
    },
    snapshot: async () => null,
    close: () => pool.end(),
  };
}

// -- pglite -----------------------------------------------------------------

/** Where snapshots for a PGLite data dir are kept. */
export function backupDirFor(dataDir: string): string {
  return `${dataDir.replace(/\/+$/, '')}.backups`;
}

async function openPglite(dataDir: string): Promise<SqlDriver> {
  let pg: PGlite;
  try {
    pg = await bootPglite(dataDir);
  } catch (err) {
    // An unclean kill can corrupt the data dir (WAL checkpoint PANIC on
    // boot). If we have a backup tarball, restore it instead of dying.
    const restored = await restoreFromBackup(dataDir, err);
    if (!restored) throw err;
    pg = restored;
  }
  return {
    query: (sql, params) => pg.query(sql, params),
    exec: (sql) => pg.exec(sql).then(() => undefined),
    snapshot: (keep = 3) => dumpPglite(pg, dataDir, keep),
    close: () => pg.close(),
  };
}

async function bootPglite(dataDir: string, loadFrom?: Blob): Promise<PGlite> {
  const pg = new PGlite(dataDir, loadFrom ? { loadDataDir: loadFrom } : {});
  await pg.waitReady;
  return pg;
}

/**
 * Snapshot the whole database as a gzip tarball (safe on a live instance);
 * keeps the newest `keep` snapshots in the backup dir.
 */
async function dumpPglite(pg: PGlite, dataDir: string, keep: number): Promise<string> {
  const dir = backupDirFor(dataDir);
  await mkdir(dir, { recursive: true });
  const blob = await pg.dumpDataDir('gzip');
  const name = `arcade-${new Date().toISOString().replace(/[:.]/g, '-')}.tgz`;
  const path = join(dir, name);
  await writeFile(path, Buffer.from(await blob.arrayBuffer()));
  const all = (await readdir(dir)).filter((f) => f.endsWith('.tgz')).sort();
  for (const stale of all.slice(0, Math.max(0, all.length - keep))) {
    await rm(join(dir, stale), { force: true });
  }
  return path;
}

async function restoreFromBackup(dataDir: string, bootErr: unknown): Promise<PGlite | null> {
  if (dataDir.startsWith('memory:')) return null;
  const dir = backupDirFor(dataDir);
  const newest = (await readdir(dir).catch(() => []))
    .filter((f) => f.endsWith('.tgz'))
    .sort()
    .pop();
  if (!newest) return null;
  const aside = `${dataDir.replace(/\/+$/, '')}.corrupt-${Date.now()}`;
  console.error(
    `[arcade] data dir failed to boot (${String(bootErr).slice(0, 120)}); ` +
      `restoring ${newest} and moving the corrupt dir to ${aside}`,
  );
  await rename(dataDir, aside).catch(() => {});
  const bytes = await readFile(join(dir, newest));
  return bootPglite(dataDir, new Blob([new Uint8Array(bytes)], { type: 'application/gzip' }));
}
