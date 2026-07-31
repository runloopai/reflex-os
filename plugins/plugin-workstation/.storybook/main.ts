/**
 * Per-plugin Storybook config. The shared preset in
 * `@reflex/ui/storybook-preset` provides the baseline framework + addons.
 *
 * Run from the plugin root:
 *   pnpm --filter @reflex/plugin-workstation storybook
 */
import type { StorybookConfig } from '@storybook/react-vite';
import { definePluginStorybookConfig } from '@reflex/ui/storybook-preset';

const config: StorybookConfig = definePluginStorybookConfig({
  stories: ['../src/web/**/*.stories.@(ts|tsx)'],
});

export default config;
