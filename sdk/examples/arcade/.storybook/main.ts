/**
 * Storybook for the arcade's web components. Stories live in `stories/`
 * (not `web/src/`) and import components from `../web/src/...`. The Vite
 * setup mirrors `web/vite.config.ts`: Tailwind 4, the SDK consumed from
 * its TypeScript sources, and a single copy of react/react-query.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.tsx'],
  addons: ['@storybook/addon-vitest'],
  framework: '@storybook/react-vite',
  core: { disableTelemetry: true },
  // Serve fixture art where gameArtUrl() points for the story fixture id.
  staticDirs: [{ from: '../tests/art', to: '/api/games/game_fixture01/art' }],
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      plugins: [tailwindcss()],
      // Files in stories/ sit outside the react plugin's coverage in the
      // addon-vitest pipeline; make esbuild's own JSX automatic so story
      // JSX never falls back to classic React.createElement.
      esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
      resolve: {
        alias: {
          '@runloop/reflex-client': path.join(repoRoot, 'sdk/client/src/index.ts'),
          '@': path.join(here, '../web/src'),
        },
        dedupe: ['react', 'react-dom', '@tanstack/react-query'],
      },
      // Pre-bundle everything that imports react in one pass, so the dep
      // chunks share a single react instance ("Cannot read properties of
      // null (reading 'useRef')" in MemoryRouter otherwise).
      optimizeDeps: {
        include: [
          'react',
          'react-dom',
          'react-dom/client',
          'react/jsx-dev-runtime',
          'react/jsx-runtime',
          'react-router-dom',
          'react-router',
          'lucide-react',
          'performative-ui',
        ],
      },
    }),
};

export default config;
