import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { About } from '../web/src/pages/About.tsx';

const meta = {
  title: 'Arcade/About',
  component: About,
} satisfies Meta<typeof About>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('heading', { name: /Built by agents, on agents/ }),
    ).toBeInTheDocument();
    // The stack cards name each layer once as a title.
    await expect(canvas.getByText('Reflex')).toBeInTheDocument();
    await expect(canvas.getByText('Runloop')).toBeInTheDocument();
    await expect(canvas.getByText('The Reflex SDK')).toBeInTheDocument();
    await expect(
      canvas.getByRole('heading', { name: 'All of it is open source' }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: /reflex\.runloop\.ai/ })).toHaveAttribute(
      'href',
      'https://reflex.runloop.ai',
    );
  },
};
