import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = path.dirname(fileURLToPath(import.meta.url));

// Standalone example (outside the pnpm workspace): the Reflex client SDK is
// consumed straight from its TypeScript sources, so there is no build step
// and no workspace linkage. The chat UI itself is scaffold output from
// @runloop/reflex-chat-kit living in src/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@runloop/reflex-client': path.resolve(here, '../../client/src/index.ts'),
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  server: { port: 4002 },
});
