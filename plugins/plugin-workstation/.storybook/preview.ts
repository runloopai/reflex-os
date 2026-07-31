/**
 * Per-plugin Storybook preview. Composes the shared preview helper from
 * `@reflex/ui/storybook-preset/preview-composer` so this plugin's Storybook
 * gets the same MSW defaults, QueryClient + Tooltip + AuthContext wrappers,
 * and theme decorator as the host `web` Storybook.
 */
import type { Preview } from '@storybook/react-vite';
import { defineWebStorybookPreview } from '@reflex/ui/storybook-preset/preview-composer';
import { AuthContext, mockAuth } from '@reflex/ui/test-utils/providers';
import '@reflex/ui/styles.css';

const preview: Preview = defineWebStorybookPreview({
  authContext: AuthContext,
  mockAuth,
});

export default preview;
