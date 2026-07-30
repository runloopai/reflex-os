#!/usr/bin/env node
/**
 * Rewrite extensionless relative imports in `dist/` to explicit `.js`
 * specifiers (`'../lib/event-utils'` → `'../lib/event-utils.js'`).
 *
 * The synced registry sources use bundler-style extensionless imports (they
 * must stay byte-identical to `sdk/chat-kit/registry/`, whose copies are
 * resolved by consumer bundlers), so tsc emits them verbatim. The published
 * package is native ESM and must also load under plain Node, which requires
 * fully-specified relative imports — same constraint the client solves in
 * `sdk/client/scripts/add-js-extensions.mjs`, applied post-build here
 * because the sources cannot be rewritten. Covers `.js` and `.d.ts` output;
 * idempotent.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.js') || full.endsWith('.d.ts')) yield full;
  }
}

for (const file of walk(distDir)) {
  const source = readFileSync(file, 'utf8');
  const rewritten = source.replace(
    /(from\s+')(\.{1,2}\/[^']+)(')/g,
    (match, prefix, specifier, suffix) => {
      if (/\.(js|json)$/.test(specifier)) return match;
      const target = resolve(dirname(file), specifier);
      return existsSync(`${target}.js`) ? `${prefix}${specifier}.js${suffix}` : match;
    },
  );
  if (rewritten !== source) writeFileSync(file, rewritten);
}
