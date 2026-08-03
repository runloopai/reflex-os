import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The npm package this CLI ships as — the registry entry update checks read. */
export const PACKAGE_NAME = '@runloop/reflex-cli';

/**
 * Version from the nearest `package.json` at or above `startDir`.
 *
 * The build collapses `src/**` into a single `dist/main.js`, so a fixed
 * relative path would have to differ between running from source (`pnpm dev`)
 * and running the bundle (`bin/reflex-cli.js`). Walking up lands on the
 * package root either way, including inside a global npm install.
 */
export function findPackageVersion(
  startDir: string,
  readFile: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    try {
      const parsed: unknown = JSON.parse(readFile(path.join(dir, 'package.json')));
      const version = (parsed as { version?: unknown } | null)?.version;
      if (typeof version === 'string' && version.length > 0) return version;
    } catch {
      // No package.json here, or it is unreadable — keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The running CLI's version, or null when the package.json cannot be read.
 * Null rather than a `0.0.0` placeholder on purpose: a placeholder is older
 * than every published version, so it would nag about an update forever.
 */
export const CLI_VERSION: string | null = findPackageVersion(
  path.dirname(fileURLToPath(import.meta.url)),
);
