import type { Preview } from '@storybook/react-vite';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import 'performative-ui/styles.css';
import '../web/src/index.css';

const preview: Preview = {
  decorators: [
    // Components assume the app's dark shell and (for links) a router.
    (Story) => (
      <MemoryRouter>
        <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100 antialiased">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
};

export default preview;
