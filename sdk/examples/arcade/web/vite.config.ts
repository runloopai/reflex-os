import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { shareCardsInDev } from './og-dev-plugin.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

// The Reflex client SDK is consumed straight from its TypeScript sources
// (same trick as the repo's own `@reflex/source` export condition), so the
// demo needs no SDK build step and no workspace linkage. The chat UI is not
// imported at all: it was scaffolded into src/{components,hooks,lib}/reflex
// by @runloop/reflex-chat-kit and customized there.
export default defineConfig({
  root: here,
  plugins: [
    react(),
    tailwindcss(),
    // Dev is the mode a tunnel gets pointed at, so it needs share cards too.
    shareCardsInDev(process.env.ARCADE_API_ORIGIN ?? 'http://localhost:8790'),
  ],
  resolve: {
    alias: {
      '@runloop/reflex-client': path.join(repoRoot, 'sdk/client/src/index.ts'),
      '@': path.join(here, 'src'),
    },
    // The SDK sources sit next to the repo's own node_modules; force every
    // import onto the demo's single copy of these packages.
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  server: {
    port: 5674,
    // Reachable through devbox/preview tunnels, not just localhost.
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': { target: process.env.ARCADE_API_ORIGIN ?? 'http://localhost:8790', ws: true },
      '/reflex': { target: process.env.ARCADE_API_ORIGIN ?? 'http://localhost:8790', ws: true },
      // Mock-reflex daemon pages (relative /play/... URLs when the mock runs
      // with MOCK_PLAY_BASE=''), so game iframes work through tunnels too.
      '/play': { target: process.env.ARCADE_MOCK_ORIGIN ?? 'http://localhost:8791' },
      // The mock's stand-in for Reflex's approval page, for the same reason
      // (relative when the mock runs with MOCK_APP_BASE='').
      '/mock-connect': { target: process.env.ARCADE_MOCK_ORIGIN ?? 'http://localhost:8791' },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
