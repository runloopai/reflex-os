/**
 * Which store the arcade boots against. The choice is environment-only, and
 * getting it wrong on a hosted deployment means writing rows to a container
 * disk that the next deploy throws away — so it is pinned here.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig, resolveStore, resolveTrustProxy } from '../server/config.ts';

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

  // The fallback is a convenience for a laptop and a data-loss bug on a
  // container whose disk goes away with the deploy.
  it('refuses the disk fallback in production when nothing was chosen', () => {
    expect(() => resolveStore({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL is required/);
  });

  // What is refused is the accident, not the deliberate local run: the
  // README's `NODE_ENV=production npm start` preview and the smoke-test
  // stack both name a data dir on purpose.
  it('allows a production-mode run that names its data dir', () => {
    expect(resolveStore({ NODE_ENV: 'production', ARCADE_DATA_DIR: '/tmp/arcade' })).toEqual({
      kind: 'pglite',
      dataDir: '/tmp/arcade',
    });
  });
});

describe('resolveTrustProxy', () => {
  // Hosted, every request comes from the load balancer, so without this the
  // per-IP rate limits put the whole internet in one bucket.
  it('trusts one hop in production and none locally', () => {
    expect(resolveTrustProxy({ NODE_ENV: 'production' })).toBe(1);
    expect(resolveTrustProxy({})).toBe(false);
  });

  it('takes a hop count for a deployment with a CDN in front', () => {
    expect(resolveTrustProxy({ ARCADE_TRUST_PROXY: '2' })).toBe(2);
    expect(resolveTrustProxy({ ARCADE_TRUST_PROXY: '0' })).toBe(0);
  });

  // A count, never `true`: X-Forwarded-For is a list anyone may prepend to,
  // so trusting it wholesale hands out one fresh identity per request. And
  // a typo has to be loud — degrading to "trust nothing" would put every
  // caller behind the balancer in one bucket and lock the site out of
  // joining within a minute of traffic.
  it('refuses anything that is not a hop count', () => {
    expect(() => resolveTrustProxy({ ARCADE_TRUST_PROXY: 'true' })).toThrow(/hop count/);
    expect(() => resolveTrustProxy({ ARCADE_TRUST_PROXY: '-1' })).toThrow(/hop count/);
    expect(() => resolveTrustProxy({ ARCADE_TRUST_PROXY: '1.5' })).toThrow(/hop count/);
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
