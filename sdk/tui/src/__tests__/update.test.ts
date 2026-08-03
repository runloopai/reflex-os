import { describe, expect, it, vi } from 'vitest';
import { checkForUpdate, compareVersions, isUpdateCheckDisabled } from '../update/check.js';
import { updateCommand } from '../update/install.js';
import { CLI_VERSION, PACKAGE_NAME, findPackageVersion } from '../update/version.js';

/** Minimal stand-in for the one registry response `checkForUpdate` reads. */
function registryResponding(body: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('compareVersions', () => {
  it('orders release versions numerically, not lexically', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('treats missing parts as zero and ignores a leading v', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('v1.3.0', '1.2.9')).toBeGreaterThan(0);
  });

  it('sorts a prerelease below the release it leads to', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta.1')).toBe(0);
  });

  it('does not choke on unparseable parts', () => {
    expect(compareVersions('next', '0.0.0')).toBe(0);
  });
});

describe('checkForUpdate', () => {
  it('returns the published version when it is newer', async () => {
    await expect(
      checkForUpdate({
        currentVersion: '0.1.0',
        fetchImpl: registryResponding({ version: '0.2.0' }),
        env: {},
      }),
    ).resolves.toBe('0.2.0');
  });

  it('stays quiet when the running version is current or ahead', async () => {
    for (const version of ['0.1.0', '0.0.9']) {
      await expect(
        checkForUpdate({
          currentVersion: '0.1.0',
          fetchImpl: registryResponding({ version }),
          env: {},
        }),
      ).resolves.toBeNull();
    }
  });

  it('stays quiet on a failed request, a bad status, or a junk body', async () => {
    const rejecting = vi.fn(async () => {
      throw new Error('ENOTFOUND registry.npmjs.org');
    }) as unknown as typeof fetch;
    const cases: (typeof fetch)[] = [
      rejecting,
      registryResponding({ version: '9.9.9' }, false),
      registryResponding({ version: 42 }),
      registryResponding(null),
    ];
    for (const fetchImpl of cases) {
      await expect(
        checkForUpdate({ currentVersion: '0.1.0', fetchImpl, env: {} }),
      ).resolves.toBeNull();
    }
  });

  it('makes no request at all when the check is opted out of', async () => {
    const fetchImpl = registryResponding({ version: '9.9.9' });
    await expect(
      checkForUpdate({
        currentVersion: '0.1.0',
        fetchImpl,
        env: { REFLEX_NO_UPDATE_CHECK: '1' },
      }),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('makes no request when the running version is unknown', async () => {
    const fetchImpl = registryResponding({ version: '9.9.9' });
    await expect(checkForUpdate({ currentVersion: null, fetchImpl, env: {} })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('isUpdateCheckDisabled', () => {
  it('reads the env var as a flag, ignoring the off-ish values', () => {
    expect(isUpdateCheckDisabled({})).toBe(false);
    expect(isUpdateCheckDisabled({ REFLEX_NO_UPDATE_CHECK: '' })).toBe(false);
    expect(isUpdateCheckDisabled({ REFLEX_NO_UPDATE_CHECK: '0' })).toBe(false);
    expect(isUpdateCheckDisabled({ REFLEX_NO_UPDATE_CHECK: 'false' })).toBe(false);
    expect(isUpdateCheckDisabled({ REFLEX_NO_UPDATE_CHECK: '1' })).toBe(true);
    expect(isUpdateCheckDisabled({ REFLEX_NO_UPDATE_CHECK: 'yes' })).toBe(true);
  });
});

describe('updateCommand', () => {
  it('installs the latest and re-execs with the session arguments', () => {
    expect(updateCommand(['--connect', '--dir', '~/dev'], 'darwin')).toEqual({
      command: 'sh',
      args: [
        '-c',
        `npm install -g ${PACKAGE_NAME}@latest && exec 'reflex-cli' '--connect' '--dir' '~/dev'`,
      ],
    });
  });

  it('quotes arguments so a crafted one cannot escape into the shell line', () => {
    const { args } = updateCommand(["--name=it's; rm -rf /"], 'linux');
    expect(args[1]).toBe(
      `npm install -g ${PACKAGE_NAME}@latest && exec 'reflex-cli' '--name=it'\\''s; rm -rf /'`,
    );
  });

  it('only installs on Windows, where cmd.exe has no exec', () => {
    expect(updateCommand(['--connect'], 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/c', `npm install -g ${PACKAGE_NAME}@latest`],
    });
  });
});

describe('findPackageVersion', () => {
  it('walks up to the nearest readable package.json', () => {
    const files: Record<string, string> = {
      '/app/package.json': JSON.stringify({ name: 'root', version: '9.9.9' }),
      '/app/pkg/package.json': JSON.stringify({ name: PACKAGE_NAME, version: '1.2.3' }),
    };
    const readFile = (file: string): string => {
      const contents = files[file];
      if (contents === undefined) throw new Error(`ENOENT: ${file}`);
      return contents;
    };
    expect(findPackageVersion('/app/pkg/dist', readFile)).toBe('1.2.3');
    expect(findPackageVersion('/app/other/deep', readFile)).toBe('9.9.9');
  });

  it('returns null when no package.json has a version, instead of looping', () => {
    expect(
      findPackageVersion('/nowhere/at/all', () => {
        throw new Error('ENOENT');
      }),
    ).toBeNull();
    expect(findPackageVersion('/nowhere', () => JSON.stringify({ name: 'x' }))).toBeNull();
  });

  it('resolves this package at runtime, from source and from the bundle alike', () => {
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reports an unreadable package as null rather than a stale placeholder', () => {
    // A `0.0.0` fallback would sort below every published version and nag forever.
    expect(findPackageVersion('/nowhere', () => JSON.stringify({ version: '' }))).toBeNull();
  });
});
