import { spawnSync } from 'node:child_process';
import type { Command } from 'commander';
import { getConfig, listOrganizations, ReflexSocket } from '@runloop/reflex-client';
import { configureClient } from '../client.js';
import { tryResolveConfig, type CliFlags } from '../context.js';
import type { TuiConfig } from '../config.js';
import { serviceStatus } from '../service/index.js';
import { color } from '../output/table.js';
import type { RegisterContext } from './define.js';

/**
 * `reflex doctor`: connectivity and setup diagnostics. Each check prints
 * pass/fail with a fix hint; informational checks never fail the run. Exit
 * 1 when any required check fails, 0 otherwise. Runs fine unconfigured:
 * the config check fails with the login hint and the server-side checks
 * report skipped.
 */

export interface DoctorCheckResult {
  name: string;
  ok: boolean;
  detail: string;
  /** Not attempted because a prerequisite failed. Does not fail the run. */
  skipped?: boolean;
  /** Environment facts (daemon, clipboard); never fail the run. */
  informational?: boolean;
}

/** Seams for the environment-touching probes, injected for tests. */
export interface DoctorProbes {
  resolveConfig: () => TuiConfig | null;
  /** GET /config through the configured client; returns latency in ms. */
  pingServer: () => Promise<number>;
  /** List org memberships with the configured key. */
  listOrgs: () => Promise<{ id: string; slug: string }[]>;
  /** Open and close a WebSocket to the server. */
  probeSocket: (timeoutMs: number) => Promise<void>;
  daemonDetail: () => string;
  clipboardDetail: () => string;
}

export function liveProbes(flags: CliFlags): DoctorProbes {
  return {
    resolveConfig: () => {
      const config = tryResolveConfig(flags);
      if (config) configureClient(config);
      return config;
    },
    pingServer: async () => {
      const start = Date.now();
      await getConfig();
      return Date.now() - start;
    },
    listOrgs: async () =>
      (await listOrganizations()).data.organizations.map((m) => ({
        id: m.organization.id,
        slug: m.organization.slug,
      })),
    probeSocket: (timeoutMs) =>
      new Promise((resolve, reject) => {
        const socket = new ReflexSocket();
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error(`no connection within ${timeoutMs}ms`));
        }, timeoutMs);
        socket.onStateChange((state) => {
          if (state === 'open') {
            clearTimeout(timer);
            socket.close();
            resolve();
          }
        });
        socket.connect();
      }),
    daemonDetail: () => {
      const status = serviceStatus();
      return `${status.manager}: ${status.detail}`;
    },
    clipboardDetail: () => {
      const helpers =
        process.platform === 'darwin'
          ? ['osascript']
          : process.platform === 'win32'
            ? ['powershell.exe']
            : ['wl-paste', 'xclip'];
      const found = helpers.filter(
        (bin) => spawnSync('which', [bin], { stdio: 'ignore' }).status === 0,
      );
      return found.length > 0
        ? `image paste available (${found.join(', ')})`
        : `no clipboard helper found (looked for ${helpers.join(', ')}); ctrl+v image paste will not work in the TUI`;
    },
  };
}

export async function runDoctorChecks(probes: DoctorProbes): Promise<DoctorCheckResult[]> {
  const results: DoctorCheckResult[] = [];

  const config = probes.resolveConfig();
  if (config) {
    const org = config.organizationId ? `, org ${config.organizationId}` : '';
    results.push({ name: 'config', ok: true, detail: `${config.baseUrl}${org}` });
  } else {
    results.push({
      name: 'config',
      ok: false,
      detail: 'not configured. Run `reflex-cli login`, or set REFLEX_BASE_URL / REFLEX_API_KEY.',
    });
  }

  const skip = (name: string, why: string): void => {
    results.push({ name, ok: false, skipped: true, detail: `skipped (${why})` });
  };

  let serverOk = false;
  if (!config) {
    skip('server', 'no config');
  } else {
    try {
      const ms = await probes.pingServer();
      serverOk = true;
      results.push({ name: 'server', ok: true, detail: `GET /config in ${ms}ms` });
    } catch (err) {
      results.push({
        name: 'server',
        ok: false,
        detail: `unreachable: ${err instanceof Error ? err.message : String(err)}. Check --url / REFLEX_BASE_URL.`,
      });
    }
  }

  if (!serverOk) {
    skip('auth', config ? 'server unreachable' : 'no config');
    skip('websocket', config ? 'server unreachable' : 'no config');
  } else {
    try {
      const orgs = await probes.listOrgs();
      const active = orgs.find(
        (org) => org.id === config?.organizationId || org.slug === config?.organizationId,
      );
      const scope = config?.organizationId
        ? active
          ? `active org ${active.slug}`
          : `org "${config.organizationId}" not among your memberships`
        : 'no org pinned (server default applies)';
      const member = `${orgs.length} org membership(s)`;
      const orgOk = !config?.organizationId || active !== undefined;
      results.push({
        name: 'auth',
        ok: orgOk,
        detail: orgOk
          ? `key valid; ${member}; ${scope}`
          : `key valid, but ${scope}. Fix --org / REFLEX_ORG or run \`reflex-cli orgs list\`.`,
      });
    } catch (err) {
      results.push({
        name: 'auth',
        ok: false,
        detail: `key rejected: ${err instanceof Error ? err.message : String(err)}. Run \`reflex-cli login\`.`,
      });
    }
    try {
      await probes.probeSocket(5000);
      results.push({ name: 'websocket', ok: true, detail: 'connected' });
    } catch (err) {
      results.push({
        name: 'websocket',
        ok: false,
        detail: `failed: ${err instanceof Error ? err.message : String(err)}. Live streams (watch, chat) will not work.`,
      });
    }
  }

  for (const [name, probe] of [
    ['connect daemon', probes.daemonDetail],
    ['clipboard', probes.clipboardDetail],
  ] as const) {
    try {
      results.push({ name, ok: true, informational: true, detail: probe() });
    } catch (err) {
      results.push({
        name,
        ok: true,
        informational: true,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/** Exit code for a doctor run: informational and skipped checks never fail. */
export function doctorExitCode(results: DoctorCheckResult[]): number {
  return results.some((r) => !r.ok && !r.skipped && !r.informational) ? 1 : 0;
}

function renderResult(result: DoctorCheckResult): string {
  const mark = result.skipped
    ? color('-', 'dim')
    : result.informational
      ? color('i', 'cyan')
      : result.ok
        ? color('ok', 'green')
        : color('FAIL', 'red');
  return `${mark.padEnd(result.skipped || result.informational ? 1 : 4)} ${result.name}: ${result.detail}`;
}

export function registerDoctorCommand(program: Command, ctx: RegisterContext): void {
  const cmd = program
    .command('doctor')
    .description('diagnose the setup: config, server, key, org, websocket');
  ctx.addCommonOptions(cmd);
  cmd.option('--json', 'print results as JSON');
  cmd.action((_opts: unknown, c: Command) => {
    const flags = ctx.legacyFlags(c);
    ctx.record('doctor', flags);
    if (!ctx.execute) return;
    return (async () => {
      const results = await runDoctorChecks(liveProbes(flags));
      if (c.optsWithGlobals<{ json?: boolean }>().json) {
        console.log(JSON.stringify({ checks: results }, null, 2));
      } else {
        for (const result of results) console.log(renderResult(result));
      }
      process.exitCode = doctorExitCode(results);
    })();
  });
}
