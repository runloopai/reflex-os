/**
 * Which store the arcade boots against. The choice is environment-only, and
 * getting it wrong on a hosted deployment means writing rows to a container
 * disk that the next deploy throws away — so it is pinned here.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig, resolveStore } from '../server/config.ts';

describe('resolveStore', () => {
  it('uses Postgres when DATABASE_URL is set', () => {
    expect(resolveStore({ DATABASE_URL: 'postgres://u@h/db' })).toEqual({
      kind: 'postgres',
      url: 'postgres://u@h/db',
    });
  });

  it('prefers ARCADE_DATABASE_URL over an inherited DATABASE_URL', () => {
    expect(
      resolveStore({
        DATABASE_URL: 'postgres://other/db',
        ARCADE_DATABASE_URL: 'postgres://mine/db',
      }),
    ).toEqual({ kind: 'postgres', url: 'postgres://mine/db' });
  });

  it('falls back to a PGLite data dir so the demo runs with no database', () => {
    expect(resolveStore({ ARCADE_DATA_DIR: '/tmp/arcade' })).toEqual({
      kind: 'pglite',
      dataDir: '/tmp/arcade',
    });
    expect(resolveStore({}).kind).toBe('pglite');
  });
});

describe('loadConfig', () => {
  it('reads the whole environment it is given, not process.env', () => {
    const config = loadConfig({
      PORT: '9000',
      HOST: '0.0.0.0',
      REFLEX_BASE_URL: 'https://reflex.example.com/',
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u@h/db',
    });
    expect(config).toMatchObject({
      port: 9000,
      host: '0.0.0.0',
      // Trailing slash trimmed: every SDK call appends its own path.
      reflexBaseUrl: 'https://reflex.example.com',
      serveWeb: true,
      store: { kind: 'postgres' },
    });
  });
});
