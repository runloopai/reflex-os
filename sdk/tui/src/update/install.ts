import { spawnSync } from 'node:child_process';
import { PACKAGE_NAME } from './version.js';

/** Quote one argument for the single shell line the update runs in. */
function quote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * The command that installs the published latest and hands the terminal to
 * the new binary. `exec` replaces this process, re-running the arguments the
 * session started with, so `--connect --dir ~/dev` survives the upgrade.
 *
 * `cmd.exe` has no `exec`, so on Windows the update only installs; the CLI
 * then exits and the next launch is the new version.
 */
export function updateCommand(
  args: readonly string[] = process.argv.slice(2),
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  const install = `npm install -g ${PACKAGE_NAME}@latest`;
  if (platform === 'win32') return { command: 'cmd.exe', args: ['/c', install] };
  const relaunch = ['reflex-cli', ...args].map(quote).join(' ');
  return { command: 'sh', args: ['-c', `${install} && exec ${relaunch}`] };
}

/**
 * Install the newer CLI in place of this one. Ink owns the terminal while the
 * TUI is up, so hand it back first — raw mode off, attributes reset, cursor
 * shown — and let npm draw on a normal terminal. On success `exec` replaces
 * this process, so this never returns.
 */
export function runSelfUpdate(args?: readonly string[]): never {
  process.stdin.pause();
  if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
  // SGR reset + show cursor: Ink hides the cursor and may leave a color set.
  if (process.stdout.isTTY) process.stdout.write('\x1b[0m\x1b[?25h');
  const { command, args: commandArgs } = updateCommand(args);
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
