#!/usr/bin/env node
/**
 * Rewrite extensionless relative imports in the orval output to explicit
 * `.js` specifiers (`'../http'` → `'../http.js'`, `'./model'` →
 * `'./model/index.js'`).
 *
 * orval emits bundler-style extensionless imports, but `@runloop/reflex-client`
 * is published as native ESM and must load under plain Node, which requires
 * fully-specified relative imports. Runs as the `reflexSdk` and `reflex`
 * projects' `afterAllFilesWrite` hook in `orval.config.ts` (covering both
 * `src/generated` and `src/react`), so `pnpm client:generate` always produces
 * Node-ready local output. Idempotent: already-suffixed specifiers are left
 * alone.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const generatedDirs = [resolve(scriptDir, '../src/generated'), resolve(scriptDir, '../src/react')];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.ts')) yield full;
  }
}

for (const generatedDir of generatedDirs) {
  if (!existsSync(generatedDir)) continue;
  for (const file of walk(generatedDir)) {
    const source = readFileSync(file, 'utf8');
    const rewritten = source.replace(
      /(from\s+')(\.{1,2}\/[^']+)(')/g,
      (match, prefix, specifier, suffix) => {
        if (/\.(js|ts|json)$/.test(specifier)) return match;
        const target = resolve(dirname(file), specifier);
        const suffixed = existsSync(`${target}.ts`)
          ? `${specifier}.js`
          : existsSync(join(target, 'index.ts'))
            ? `${specifier}/index.js`
            : specifier;
        return `${prefix}${suffixed}${suffix}`;
      },
    );
    if (rewritten !== source) writeFileSync(file, rewritten);
  }
}
