import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { defaultConfigPath, loadConfig } from '../config.js';
import {
  SERVICE_LABEL,
  SYSTEMD_UNIT_NAME,
  launchAgentsDir,
  launchdPlistPath,
  resolveCliInvocation,
  serviceLogDir,
  serviceLogPaths,
  systemdUnitPath,
  systemdUserDir,
} from './paths.js';
import {
  buildConnectArgs,
  renderLaunchdPlist,
  renderSystemdUnit,
  type ServiceConnectFlags,
} from './unit.js';

export type ServiceManager = 'launchd' | 'systemd';

/** Which init system to target, or null on an unsupported platform. */
export function detectServiceManager(
  platform: NodeJS.Platform = process.platform,
): ServiceManager | null {
  if (platform === 'darwin') return 'launchd';
  if (platform === 'linux') return 'systemd';
  return null;
}

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[]): RunResult {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  return {
    ok: res.status === 0,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? res.error?.message ?? '').trim(),
  };
}

function requireRun(result: RunResult, action: string): void {
  if (result.ok) return;
  throw new Error(`${action} failed${result.stderr ? `: ${result.stderr}` : ''}`);
}

function unsupported(): never {
  throw new Error(
    `Installing the connect service is only supported on macOS (launchd) and Linux (systemd). ` +
      `On ${process.platform}, run \`reflex-cli connect\` in a terminal or your own process supervisor instead.`,
  );
}

/**
 * Ensure the saved config file (not env vars) carries an API key: the daemon
 * runs without the installing shell's environment, so it can only authenticate
 * from `~/.reflex/tui.json`.
 */
function requireSavedCredentials(): void {
  const config = loadConfig({}, defaultConfigPath());
  if (!config) {
    throw new Error(
      `No saved credentials at ${defaultConfigPath()}. Run \`reflex-cli login\` first — the ` +
        `service can't read REFLEX_API_KEY from your shell.`,
    );
  }
}

export interface InstallServiceResult {
  manager: ServiceManager;
  unitPath: string;
  args: string[];
  logHint: string;
}

/**
 * Write the platform unit and register it so connect starts now and on boot.
 * Returns details for the caller to print; throws with an actionable message
 * on an unsupported platform or missing credentials.
 */
export function installService(
  flags: ServiceConnectFlags,
  home: string = homedir(),
): InstallServiceResult {
  const manager = detectServiceManager();
  if (!manager) unsupported();
  requireSavedCredentials();

  const { execPath, script } = resolveCliInvocation();
  const workingDir = path.resolve(flags.dir ?? process.cwd());
  const args = buildConnectArgs({ ...flags, dir: workingDir });

  if (manager === 'launchd') {
    return installLaunchd({ execPath, script, args, workingDir, home });
  }
  return installSystemd({ execPath, script, args, workingDir, home });
}

interface InstallArgs {
  execPath: string;
  script: string;
  args: string[];
  workingDir: string;
  home: string;
}

function launchdDomainTarget(): { domain: string; target: string } {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  return { domain: `gui/${uid}`, target: `gui/${uid}/${SERVICE_LABEL}` };
}

function installLaunchd(opts: InstallArgs): InstallServiceResult {
  const logs = serviceLogPaths(opts.home);
  mkdirSync(serviceLogDir(opts.home), { recursive: true });
  mkdirSync(launchAgentsDir(opts.home), { recursive: true });
  const plistPath = launchdPlistPath(opts.home);
  writeFileSync(
    plistPath,
    renderLaunchdPlist({
      execPath: opts.execPath,
      script: opts.script,
      args: opts.args,
      workingDir: opts.workingDir,
      logOut: logs.out,
      logErr: logs.err,
    }),
  );

  const { domain, target } = launchdDomainTarget();
  // Replace any prior instance, then load, enable, and start immediately.
  run('launchctl', ['bootout', target]);
  const boot = run('launchctl', ['bootstrap', domain, plistPath]);
  if (!boot.ok) {
    // Fall back to the legacy loader on older macOS where bootstrap is fussy.
    requireRun(run('launchctl', ['load', '-w', plistPath]), 'Loading the launchd service');
  }
  requireRun(run('launchctl', ['enable', target]), 'Enabling the launchd service');
  requireRun(run('launchctl', ['kickstart', '-k', target]), 'Starting the launchd service');

  return {
    manager: 'launchd',
    unitPath: plistPath,
    args: opts.args,
    logHint: `tail -f ${logs.out} ${logs.err}`,
  };
}

function installSystemd(opts: InstallArgs): InstallServiceResult {
  mkdirSync(systemdUserDir(opts.home), { recursive: true });
  const unitPath = systemdUnitPath(opts.home);
  writeFileSync(
    unitPath,
    renderSystemdUnit({
      execPath: opts.execPath,
      script: opts.script,
      args: opts.args,
      workingDir: opts.workingDir,
    }),
  );

  requireRun(run('systemctl', ['--user', 'daemon-reload']), 'Reloading user systemd');
  requireRun(
    run('systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT_NAME]),
    'Enabling the systemd service',
  );
  // Linger lets the user service start at boot without an active login session.
  const user = process.env.USER ?? process.env.LOGNAME;
  if (user) {
    requireRun(run('loginctl', ['enable-linger', user]), 'Enabling systemd user linger');
  }

  return {
    manager: 'systemd',
    unitPath,
    args: opts.args,
    logHint: `journalctl --user -u ${SYSTEMD_UNIT_NAME} -f`,
  };
}

export interface UninstallServiceResult {
  manager: ServiceManager;
  removed: boolean;
  unitPath: string;
}

/** Stop, disable, and remove the unit. Idempotent — safe if nothing is installed. */
export function uninstallService(home: string = homedir()): UninstallServiceResult {
  const manager = detectServiceManager();
  if (!manager) unsupported();

  if (manager === 'launchd') {
    const plistPath = launchdPlistPath(home);
    const { target } = launchdDomainTarget();
    run('launchctl', ['bootout', target]);
    if (existsSync(plistPath)) run('launchctl', ['unload', '-w', plistPath]);
    const removed = existsSync(plistPath);
    if (removed) rmSync(plistPath, { force: true });
    return { manager, removed, unitPath: plistPath };
  }

  const unitPath = systemdUnitPath(home);
  run('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT_NAME]);
  const removed = existsSync(unitPath);
  if (removed) rmSync(unitPath, { force: true });
  run('systemctl', ['--user', 'daemon-reload']);
  return { manager, removed, unitPath };
}

export interface ServiceStatus {
  manager: ServiceManager;
  installed: boolean;
  running: boolean;
  unitPath: string;
  detail: string;
}

/** Report whether the unit is installed and currently running. */
export function serviceStatus(home: string = homedir()): ServiceStatus {
  const manager = detectServiceManager();
  if (!manager) unsupported();

  if (manager === 'launchd') {
    const plistPath = launchdPlistPath(home);
    const installed = existsSync(plistPath);
    const listed = run('launchctl', ['list', SERVICE_LABEL]);
    return {
      manager,
      installed,
      running: listed.ok,
      unitPath: plistPath,
      detail: listed.ok ? 'loaded' : installed ? 'installed but not loaded' : 'not installed',
    };
  }

  const unitPath = systemdUnitPath(home);
  const installed = existsSync(unitPath);
  const active = run('systemctl', ['--user', 'is-active', SYSTEMD_UNIT_NAME]);
  return {
    manager,
    installed,
    running: active.stdout === 'active',
    unitPath,
    detail: active.stdout || (installed ? 'inactive' : 'not installed'),
  };
}
