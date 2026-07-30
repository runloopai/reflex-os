import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Avatar } from '../web/src/components/Avatar.tsx';

// 1x1 violet PNG, small enough to inline.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const meta = {
  title: 'Arcade/Avatar',
  component: Avatar,
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InitialFallback: Story = {
  args: { userId: 'user_1', name: 'Alex', size: 40 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('A')).toBeInTheDocument();
  },
};

export const WithImage: Story = {
  args: { userId: 'user_1', name: 'Alex', avatar: PIXEL, size: 40 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('img', { name: "Alex's avatar" })).toBeInTheDocument();
  },
};
