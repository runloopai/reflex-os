/**
 * Flat ESLint config mirroring the host repo's web setup: typescript-eslint
 * recommended everywhere, react-hooks + react-refresh for the app, node
 * globals for the server side, and the storybook rules for stories/.
 */
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import storybook from 'eslint-plugin-storybook';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'storybook-static', 'shots', '.data', 'web/dist', '.storybook-tunnel']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
    },
  },
  {
    files: ['web/src/**/*.{ts,tsx}', 'stories/**/*.tsx', '.storybook/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Fast-refresh hygiene only matters for modules Vite hot-reloads.
    files: ['web/src/**/*.{ts,tsx}'],
    extends: [reactRefresh.configs.vite],
  },
  {
    files: ['server/**/*.ts', 'mock-reflex/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Playwright scripts: node at the top level, but page.evaluate()
    // callbacks execute in the browser.
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // Scaffolded chat-kit output and context-provider modules export hooks
    // and helpers alongside components by design; fast-refresh purity is a
    // kit concern, not something to fork locally.
    files: [
      'web/src/components/reflex/**/*.{ts,tsx}',
      'web/src/hooks/reflex/**/*.{ts,tsx}',
      'web/src/lib/reflex/**/*.{ts,tsx}',
      'web/src/lib/socket.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // Self-scoped to stories and .storybook config files.
  ...storybook.configs['flat/recommended'],
]);
