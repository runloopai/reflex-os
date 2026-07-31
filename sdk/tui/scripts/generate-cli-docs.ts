/**
 * Emit (or check) the markdown CLI reference at `docs/cli.md`, rendered
 * from the live Commander tree — the same walk that powers `completion`.
 *
 *   pnpm --filter @runloop/reflex-cli docs:generate   # rewrite docs/cli.md
 *   pnpm --filter @runloop/reflex-cli docs:check      # fail on drift (also a vitest)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProgram } from '../src/cli.js';
import { renderCliDocs } from '../src/reference/markdown.js';
import { walkCommand } from '../src/reference/walker.js';

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'cli.md');
const rendered = renderCliDocs(walkCommand(createProgram()));

if (process.argv.includes('--check')) {
  let committed = '';
  try {
    committed = readFileSync(outPath, 'utf8');
  } catch {
    // Missing file is drift too.
  }
  if (committed !== rendered) {
    console.error(
      'docs/cli.md is out of date with the command tree. Run `pnpm --filter @runloop/reflex-cli docs:generate` and commit the result.',
    );
    process.exit(1);
  }
  console.log('docs/cli.md is up to date.');
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, rendered, 'utf8');
  console.log(`[reflex-cli] wrote ${rendered.length} bytes to ${outPath}`);
}
