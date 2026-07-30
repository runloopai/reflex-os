import { spawn } from 'node:child_process';

/**
 * Best-effort "open this URL in the user's browser". Returns `true` when a
 * launcher process was spawned, `false` when we couldn't even try. Callers
 * MUST always also print the URL: headless/SSH sessions have no browser, and
 * even on a desktop the spawn can silently fail.
 */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): boolean {
  // A missing launcher binary (e.g. headless Linux without xdg-open) surfaces
  // as an async 'error' event; without a listener it would crash the process.
  const launch = (command: string, args: string[]) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  };
  try {
    if (platform === 'darwin') {
      launch('open', [url]);
      return true;
    }
    if (platform === 'win32') {
      // `start` is a cmd builtin; the empty title arg avoids it swallowing the
      // URL as the window title. `detached` so it outlives the CLI.
      launch('cmd', ['/c', 'start', '', url]);
      return true;
    }
    launch('xdg-open', [url]);
    return true;
  } catch {
    return false;
  }
}
