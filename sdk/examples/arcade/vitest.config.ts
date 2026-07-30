/**
 * Two test projects, both outside the src dirs:
 *  - `unit` runs `tests/**` in node (pure logic + PGLite-backed db tests).
 *  - `storybook` runs every story's play function in headless Chromium via
 *    @storybook/addon-vitest; stories are the component test surface.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
        },
      },
      {
        // storybookTest loads .storybook/main.ts (including viteFinal), so
        // Tailwind, aliases, and the react plugin all come from there.
        plugins: [storybookTest({ configDir: path.join(here, '.storybook') })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            screenshotFailures: false,
          },
        },
      },
    ],
  },
});
