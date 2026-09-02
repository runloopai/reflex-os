import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { FullscreenButton } from '../web/src/components/FullscreenButton.tsx';

const meta = {
  title: 'Arcade/FullscreenButton',
  component: FullscreenButton,
  args: { onToggle: fn() },
  decorators: [
    (Story) => (
      <div className="flex w-40 justify-end bg-zinc-950 p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FullscreenButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The stage as it normally sits: the button offers the whole screen. */
export const Windowed: Story = {
  args: { active: false },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Play fullscreen' });
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    await expect(args.onToggle).toHaveBeenCalledOnce();
  },
};

/**
 * In fullscreen the same control is the way out, and says so — a player who
 * cannot find the exit is the failure mode of every fullscreen mode.
 */
export const Fullscreen: Story = {
  args: { active: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Exit fullscreen' });
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.queryByRole('button', { name: 'Play fullscreen' })).not.toBeInTheDocument();
  },
};
