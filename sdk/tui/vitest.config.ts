import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

/**
 * Deliberately self-contained rather than importing the repository-root
 * `vite-conditions`: everything under `sdk/` is exported to the public mirror
 * and has to build and test there, where that file does not exist.
 *
 * Sibling packages (`@runloop/reflex-contract`, `@runloop/reflex-workstation`)
 * publish compiled `dist/*.js` under the default condition, so tests opt into
 * `@reflex/source` to resolve their TypeScript source without a prior build.
 * `module` is dropped for the same reason the root config drops it: Vitest's
 * Node loader does not resolve the extensionless imports some published ESM
 * builds contain, so matching `module` hands back a broken entry point.
 */
const conditions = [...defaultServerConditions.filter((c) => c !== 'module'), '@reflex/source'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
