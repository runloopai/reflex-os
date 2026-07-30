import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BASE_URL,
  loadConfig,
  resolveDefaultBaseUrl,
  saveConfig,
  updateSavedConfig,
} from '../config.js';
import { parseCli } from '../cli.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'reflex-cli-cfg-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('config', () => {
  it('round-trips through the config file', () => {
    const file = path.join(dir, 'tui.json');
    saveConfig({ baseUrl: 'https://r.example.com', apiKey: 'rfx_1' }, file);
    expect(loadConfig({}, file)).toEqual({ baseUrl: 'https://r.example.com', apiKey: 'rfx_1' });
  });

  it('lets env vars override the file', () => {
    const file = path.join(dir, 'tui.json');
    saveConfig({ baseUrl: 'https://file.example.com', apiKey: 'rfx_file' }, file);
    const config = loadConfig(
      { REFLEX_BASE_URL: 'https://env.example.com', REFLEX_ORG: 'org_env' },
      file,
    );
    expect(config).toEqual({
      baseUrl: 'https://env.example.com',
      apiKey: 'rfx_file',
      organizationId: 'org_env',
    });
  });

  it('returns null when nothing is configured', () => {
    expect(loadConfig({}, path.join(dir, 'missing.json'))).toBeNull();
  });

  it('merges a patch into the saved file, keeping the other fields', () => {
    const file = path.join(dir, 'tui.json');
    saveConfig({ baseUrl: 'https://r.example.com', apiKey: 'rfx_1' }, file);
    updateSavedConfig({ lastRepo: 'runloopai/reflex#main' }, file);
    expect(loadConfig({}, file)).toEqual({
      baseUrl: 'https://r.example.com',
      apiKey: 'rfx_1',
      lastRepo: 'runloopai/reflex#main',
    });
  });

  it('never persists env-derived values when patching', () => {
    const file = path.join(dir, 'tui.json');
    saveConfig({ baseUrl: 'https://file.example.com', apiKey: 'rfx_file' }, file);
    // Simulate a session running with env overrides: the patch carries only
    // what changed, so the env key must not land in the file.
    updateSavedConfig({ lastRepo: 'owner/repo' }, file);
    const onDisk = loadConfig({}, file);
    expect(onDisk?.apiKey).toBe('rfx_file');
    expect(onDisk?.baseUrl).toBe('https://file.example.com');
  });

  it('creates the file from the patch alone when none exists', () => {
    const file = path.join(dir, 'fresh', 'tui.json');
    updateSavedConfig({ lastRepo: 'owner/repo' }, file);
    // Env vars still complete the config on load.
    expect(
      loadConfig({ REFLEX_BASE_URL: 'https://env.example.com', REFLEX_API_KEY: 'rfx_env' }, file),
    ).toEqual({
      baseUrl: 'https://env.example.com',
      apiKey: 'rfx_env',
      lastRepo: 'owner/repo',
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('tightens permissions on an existing config', () => {
    const configDir = path.join(dir, 'existing');
    const file = path.join(configDir, 'tui.json');
    saveConfig({ baseUrl: 'https://old.example.com', apiKey: 'old' }, file);
    chmodSync(configDir, 0o755);
    chmodSync(file, 0o644);
    writeFileSync(file, '{}');

    saveConfig({ baseUrl: 'https://r.example.com', apiKey: 'rfx_secret' }, file);

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('resolveDefaultBaseUrl', () => {
  it('assumes the hosted instance when nothing is set', () => {
    expect(resolveDefaultBaseUrl(undefined, {})).toBe(DEFAULT_BASE_URL);
    expect(DEFAULT_BASE_URL).toBe('https://reflex.runloop.ai');
  });

  it('lets REFLEX_BASE_URL override the hosted default', () => {
    expect(resolveDefaultBaseUrl(undefined, { REFLEX_BASE_URL: 'https://env.example.com' })).toBe(
      'https://env.example.com',
    );
  });

  it('lets an explicit --url win over the env var', () => {
    expect(
      resolveDefaultBaseUrl('https://flag.example.com', {
        REFLEX_BASE_URL: 'https://env.example.com',
      }),
    ).toBe('https://flag.example.com');
  });
});

describe('parseCli', () => {
  it('parses the default UI command with flags', () => {
    expect(parseCli(['--connect', '--dir', '/tmp/x'])).toEqual({
      command: 'ui',
      flags: expect.objectContaining({ connect: true, dir: '/tmp/x' }),
    });
  });

  it('parses the policy flags', () => {
    expect(parseCli(['connect', '--ask', '--allow-exec', '--allow-write']).flags).toEqual(
      expect.objectContaining({ ask: true, 'allow-exec': true, 'allow-write': true }),
    );
    expect(parseCli(['connect', '--read-only']).flags).toEqual(
      expect.objectContaining({ 'read-only': true }),
    );
  });

  it('parses subcommands', () => {
    expect(parseCli(['connect']).command).toBe('connect');
    expect(parseCli(['login', '--url', 'u', '--key', 'k']).command).toBe('login');
    expect(parseCli(['help']).command).toBe('help');
    expect(parseCli([]).command).toBe('ui');
  });

  it('parses the headless connect flag', () => {
    expect(parseCli(['connect', '--headless']).flags).toEqual(
      expect.objectContaining({ headless: true }),
    );
  });

  it('parses service actions', () => {
    expect(parseCli(['service', 'install', '--dir', '/tmp/x'])).toEqual({
      command: 'service',
      serviceAction: 'install',
      flags: expect.objectContaining({ dir: '/tmp/x' }),
    });
    expect(parseCli(['service', 'uninstall']).serviceAction).toBe('uninstall');
    expect(parseCli(['service', 'status']).serviceAction).toBe('status');
  });

  it('rejects a service command without a valid action', () => {
    expect(() => parseCli(['service'])).toThrow(/service <install\|uninstall\|status>/);
    expect(() => parseCli(['service', 'frob'])).toThrow(/service <install\|uninstall\|status>/);
  });

  it('rejects unknown commands', () => {
    expect(() => parseCli(['frobnicate'])).toThrow(/Unknown command/);
  });
});
