import { defineConfig } from 'vitest/config';
import { serverConditions, ssrResolve } from '../../vite-conditions';

export default defineConfig({
  // Workspace deps (`@reflex/shared`, `@reflex/plugin-workstation`) publish
  // compiled `dist/*.js` under the default condition; tests opt into
  // `@reflex/source` so they resolve TS source without a prior build.
  resolve: {
    conditions: [...serverConditions],
  },
  ssr: {
    resolve: {
      conditions: [...ssrResolve.conditions],
      externalConditions: [...ssrResolve.externalConditions],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
