#!/usr/bin/env node
/**
 * Sync the chat-kit registry templates into this package's `src/`.
 *
 * `@runloop/reflex-ui` and `@runloop/reflex-chat-kit` ship the same
 * components in two delivery models: chat-kit copies the templates into a
 * consumer app (shadcn-style), this package compiles them into an
 * importable library. `sdk/chat-kit/registry/` is the single source of
 * truth; the copies under `src/` are committed so typecheck and tests work
 * without a build step, and `--check` fails on drift (same pattern as the
 * orval-generated client, see `pnpm client:check`).
 *
 * Usage: `node scripts/sync-registry.mjs [--check]`
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryDir = path.resolve(packageRoot, '../chat-kit/registry');

export function registryFiles() {
  const manifest = JSON.parse(readFileSync(path.join(registryDir, 'registry.json'), 'utf8'));
  return manifest.items.flatMap((item) => item.files);
}

export function expectedContent(file) {
  const source = readFileSync(path.join(registryDir, file), 'utf8');
  const banner = `// AUTO-SYNCED from sdk/chat-kit/registry/${file} — edit there, then run \`pnpm --filter @runloop/reflex-ui sync\`.\n`;
  return banner + source;
}

const check = process.argv.includes('--check');
const drifted = [];

for (const file of registryFiles()) {
  const dest = path.join(packageRoot, 'src', file);
  const expected = expectedContent(file);
  if (check) {
    const actual = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
    if (actual !== expected) drifted.push(file);
  } else {
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, expected);
  }
}

if (check) {
  if (drifted.length > 0) {
    console.error(
      `src/ is out of sync with sdk/chat-kit/registry for: ${drifted.join(', ')}.\n` +
        'Run `pnpm --filter @runloop/reflex-ui sync` and commit the result.',
    );
    process.exit(1);
  }
  console.log('src/ is in sync with sdk/chat-kit/registry.');
} else {
  console.log(`Synced ${registryFiles().length} files from sdk/chat-kit/registry.`);
}
