import { describe, expect, it } from 'vitest';
import { doctorExitCode, runDoctorChecks, type DoctorProbes } from '../commands/doctor.js';

function probes(overrides: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    resolveConfig: () => ({ baseUrl: 'https://r.example.com', apiKey: 'rfx_1' }),
    pingServer: async () => 42,
    listOrgs: async () => [{ id: 'org_1', slug: 'acme' }],
    probeSocket: async () => {},
    daemonDetail: () => 'systemd: not installed',
    clipboardDetail: () => 'image paste available (xclip)',
    ...overrides,
  };
}

describe('runDoctorChecks', () => {
  it('passes everything with a healthy setup', async () => {
    const results = await runDoctorChecks(probes());
    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ['config', true],
      ['server', true],
      ['auth', true],
      ['websocket', true],
      ['connect daemon', true],
      ['clipboard', true],
    ]);
    expect(doctorExitCode(results)).toBe(0);
  });

  it('fails config and skips server-side checks when unconfigured', async () => {
    const results = await runDoctorChecks(probes({ resolveConfig: () => null }));
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName.config.ok).toBe(false);
    expect(byName.config.detail).toContain('reflex-cli login');
    expect(byName.server.skipped).toBe(true);
    expect(byName.auth.skipped).toBe(true);
    expect(byName.websocket.skipped).toBe(true);
    expect(doctorExitCode(results)).toBe(1);
  });

  it('skips auth and websocket when the server is unreachable', async () => {
    const results = await runDoctorChecks(
      probes({
        pingServer: async () => {
          throw new Error('fetch failed');
        },
      }),
    );
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName.server.ok).toBe(false);
    expect(byName.auth.skipped).toBe(true);
    expect(doctorExitCode(results)).toBe(1);
  });

  it('flags a pinned org that is not among the memberships', async () => {
    const results = await runDoctorChecks(
      probes({
        resolveConfig: () => ({
          baseUrl: 'https://r.example.com',
          apiKey: 'rfx_1',
          organizationId: 'ghost-org',
        }),
      }),
    );
    const auth = results.find((r) => r.name === 'auth');
    expect(auth?.ok).toBe(false);
    expect(auth?.detail).toContain('ghost-org');
    expect(doctorExitCode(results)).toBe(1);
  });

  it('never fails the run on informational checks', async () => {
    const results = await runDoctorChecks(
      probes({
        daemonDetail: () => {
          throw new Error('unsupported platform');
        },
      }),
    );
    const daemon = results.find((r) => r.name === 'connect daemon');
    expect(daemon?.informational).toBe(true);
    expect(doctorExitCode(results)).toBe(0);
  });
});
