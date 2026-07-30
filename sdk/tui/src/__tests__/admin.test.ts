import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCli } from '../cli.js';
import { formatUninstallConfirm, parseBooleanValue, parseSettingPairs } from '../commands/admin.js';
import { loadConfig, saveConfig, updateSavedConfig } from '../config.js';

describe('admin command parsing', () => {
  it('records noun:verb names across the admin tree', () => {
    expect(parseCli(['orgs', 'use', 'acme']).command).toBe('orgs:use');
    expect(parseCli(['orgs', 'show']).command).toBe('orgs:show');
    expect(parseCli(['orgs', 'members', 'add', 'usr_1']).command).toBe('orgs:members:add');
    expect(parseCli(['orgs', 'invites', 'create', '--email', 'a@b.co']).command).toBe(
      'orgs:invites:create',
    );
    expect(parseCli(['orgs', 'plugins', 'uninstall', 'linear', '--yes']).command).toBe(
      'orgs:plugins:uninstall',
    );
    expect(parseCli(['orgs', 'sandbox', 'set', '--api-key', 'rk_x']).command).toBe(
      'orgs:sandbox:set',
    );
    expect(parseCli(['orgs', 'base-image', 'rebuild', '--yes']).command).toBe(
      'orgs:base-image:rebuild',
    );
    expect(parseCli(['orgs', 'secrets', 'status']).command).toBe('orgs:secrets:status');
    expect(parseCli(['teams', 'set-role', 'tem_1', 'usr_1', 'rol_1']).command).toBe(
      'teams:set-role',
    );
    expect(parseCli(['teams', 'members', 'rm', 'tem_1', 'usr_1']).command).toBe('teams:members:rm');
    expect(parseCli(['keys', 'revoke', 'pak_1', '--yes']).command).toBe('keys:revoke');
    expect(parseCli(['secrets', 'providers', 'list']).command).toBe('secrets:providers:list');
    expect(parseCli(['users', 'show', 'usr_1']).command).toBe('users:show');
  });

  it('routes flags overrides to the nested group and keeps the read command', () => {
    expect(parseCli(['flags', 'list']).command).toBe('flags:list');
    expect(parseCli(['flags', 'set', 'my-flag', 'true']).command).toBe('flags:set');
    expect(parseCli(['flags', 'overrides', 'my-flag']).command).toBe('flags:overrides');
    expect(parseCli(['flags', 'overrides', 'set', 'my-flag', 'usr_1', 'true']).command).toBe(
      'flags:overrides:set',
    );
    expect(parseCli(['flags', 'overrides', 'rm', 'my-flag', 'usr_1']).command).toBe(
      'flags:overrides:rm',
    );
  });

  it('keeps global flags working on admin commands', () => {
    expect(parseCli(['orgs', 'members', 'list', '--org', 'acme']).flags.org).toBe('acme');
    expect(
      parseCli(['flags', 'overrides', 'set', 'k', 'usr_1', 'false', '--org', 'o']).flags.org,
    ).toBe('o');
  });
});

describe('orgs use persistence', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'reflex-cli-admin-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes organizationId into the config file, keeping the other fields', () => {
    // `orgs use` persists through updateSavedConfig; this pins the exact
    // write path the command uses.
    const file = path.join(dir, 'tui.json');
    saveConfig({ baseUrl: 'https://r.example.com', apiKey: 'rfx_1', lastRepo: 'a/b' }, file);
    updateSavedConfig({ organizationId: 'org_123' }, file);
    expect(loadConfig({}, file)).toEqual({
      baseUrl: 'https://r.example.com',
      apiKey: 'rfx_1',
      lastRepo: 'a/b',
      organizationId: 'org_123',
    });
  });

  it('replaces a previously selected org', () => {
    const file = path.join(dir, 'tui.json');
    saveConfig(
      { baseUrl: 'https://r.example.com', apiKey: 'rfx_1', organizationId: 'org_old' },
      file,
    );
    updateSavedConfig({ organizationId: 'org_new' }, file);
    expect(loadConfig({}, file)?.organizationId).toBe('org_new');
  });
});

describe('parseBooleanValue', () => {
  it('accepts the usual spellings', () => {
    for (const v of ['true', 'on', '1', 'yes', 'enabled', 'TRUE']) {
      expect(parseBooleanValue(v, '<value>')).toBe(true);
    }
    for (const v of ['false', 'off', '0', 'no', 'disabled', 'False']) {
      expect(parseBooleanValue(v, '<value>')).toBe(false);
    }
  });

  it('rejects anything else', () => {
    expect(() => parseBooleanValue('maybe', '<value>')).toThrow(/true or false/);
    expect(() => parseBooleanValue('', '<value>')).toThrow(/true or false/);
  });
});

describe('parseSettingPairs', () => {
  it('parses JSON-looking values and keeps the rest as strings', () => {
    expect(parseSettingPairs(['retries=3', 'debug=true', 'channel=beta', 'label=a b'])).toEqual({
      retries: 3,
      debug: true,
      channel: 'beta',
      label: 'a b',
    });
  });

  it('keeps later pairs winning and allows = in values', () => {
    expect(parseSettingPairs(['k=1', 'k=2', 'url=https://x?a=b'])).toEqual({
      k: 2,
      url: 'https://x?a=b',
    });
  });

  it('rejects pairs without a key', () => {
    expect(() => parseSettingPairs(['novalue'])).toThrow(/key=value/);
    expect(() => parseSettingPairs(['=x'])).toThrow(/key=value/);
  });
});

describe('formatUninstallConfirm', () => {
  it('names the dependent plugins the uninstall cascades to', () => {
    expect(formatUninstallConfirm('linear', [])).toBe('Uninstall linear from the org?');
    expect(formatUninstallConfirm('github', ['linear', 'slack'])).toBe(
      'Uninstall github from the org? This also uninstalls the plugins that depend on it: ' +
        'linear, slack.',
    );
  });
});
