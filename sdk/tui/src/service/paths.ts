import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** launchd label / systemd unit basename for the connect daemon. */
export const SERVICE_LABEL = 'ai.runloop.reflex-connect';
export const SYSTEMD_UNIT_NAME = 'reflex-connect.service';

/**
 * How to re-invoke this CLI from a service manager: the absolute node binary
 * plus the resolved entry script. Service units must use absolute paths — a
 * bare `reflex-cli` isn't on launchd/systemd's PATH — so we anchor on
 * `process.execPath` (node) and the realpath of the invoked script (the `bin`
 * shim). `realpathSync` collapses the pnpm/npm symlink to the real file so the
 * unit keeps working if the PATH shim is later rewritten.
 */
export function resolveCliInvocation(
  argv: readonly string[] = process.argv,
  execPath: string = process.execPath,
): { execPath: string; script: string } {
  const raw = argv[1];
  if (!raw) throw new Error('cannot resolve the reflex-cli entry script from argv');
  let script = path.resolve(raw);
  try {
    script = realpathSync(script);
  } catch {
    // Keep the resolved-but-unrealpathed path; the file may still be runnable.
  }
  return { execPath, script };
}

export function launchAgentsDir(home: string = homedir()): string {
  return path.join(home, 'Library', 'LaunchAgents');
}

export function launchdPlistPath(home: string = homedir()): string {
  return path.join(launchAgentsDir(home), `${SERVICE_LABEL}.plist`);
}

export function systemdUserDir(home: string = homedir()): string {
  return path.join(home, '.config', 'systemd', 'user');
}

export function systemdUnitPath(home: string = homedir()): string {
  return path.join(systemdUserDir(home), SYSTEMD_UNIT_NAME);
}

/** Log directory the launchd daemon writes stdout/stderr to (systemd uses the journal). */
export function serviceLogDir(home: string = homedir()): string {
  return path.join(home, '.reflex', 'logs');
}

export function serviceLogPaths(home: string = homedir()): { out: string; err: string } {
  const dir = serviceLogDir(home);
  return { out: path.join(dir, 'connect.out.log'), err: path.join(dir, 'connect.err.log') };
}
