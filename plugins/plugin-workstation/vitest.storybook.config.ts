import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { definePluginStorybookVitestConfig } from '@reflex/ui/storybook-preset';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default definePluginStorybookVitestConfig({
  storybookDir: path.join(dirname, '.storybook'),
});
