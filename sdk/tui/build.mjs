#!/usr/bin/env node
/**
 * Bundle the CLI into a single self-contained `dist/main.js`.
 *
 * Why bundle instead of a plain `tsc` per-file emit (the pattern most
 * workspaces use): the TUI is an *end-user binary*, run off `dist/` via the
 * `bin`. A per-file emit leaves the workspace imports (`@reflex/shared`,
 * `@reflex/plugin-workstation`, `@runloop/reflex-client`) as bare specifiers
 * resolved at *runtime* to each sibling's `dist/`. If a sibling `dist/` is
 * stale or unbuilt, the CLI crashes with a cryptic "does not provide an export
 * named …" the first time it imports it — divorced from the edit that caused it.
 *
 * Bundling inlines only the monorepo's own packages, pulled from their
 * TypeScript *source* via the `@reflex/source` export condition. Every
 * third-party dependency stays an external runtime `import` resolved from
 * node_modules (react, ink, zod, …), so the bundle stays small and we never
 * try to bundle native/CJS deps. Net effect:
 *   - a single `reflex-cli` build is always internally consistent — no sibling
 *     `dist/` to keep in sync, so the stale-export class of bug cannot recur;
 *   - `build:watch` (used by the repo-root `pnpm dev`) watches the inlined
 *     sources too, so editing `@reflex/shared` rebuilds the CLI automatically.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
);
const watch = process.argv.includes('--watch');

const isWorkspaceImport = (path) =>
  path.startsWith('@reflex/') ||
  path === '@runloop/reflex-client' ||
  path.startsWith('@runloop/reflex-client/');

/**
 * Inline the monorepo's own packages; keep every other bare import (npm deps
 * and `node:` builtins) external. Entry points and relative imports fall
 * through to esbuild's normal resolution.
 */
const bundleWorkspaceOnly = {
  name: 'bundle-workspace-only',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.kind === 'entry-point') return undefined;
      if (isWorkspaceImport(args.path)) return undefined;
      return { path: args.path, external: true };
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  jsx: 'automatic',
  sourcemap: true,
  // Resolve `@reflex/*` / `@runloop/reflex-client` to their TS source, not dist.
  conditions: ['@reflex/source'],
  plugins: [bundleWorkspaceOnly],
  logLevel: 'info',
  metafile: false,
  banner: {
    js: `// reflex-cli ${pkg.version} — bundled CLI entrypoint (see build.mjs)`,
  },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[reflex-cli] watching src/ (+ inlined workspace sources)…');
} else {
  await esbuild.build(options);
  console.log('[reflex-cli] built dist/main.js');
}
