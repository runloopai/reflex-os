import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { PanelDock } from '../web/src/components/PanelDock.tsx';

const meta = {
  title: 'Arcade/PanelDock',
  component: PanelDock,
  args: { onSelect: fn() },
  decorators: [
    (Story) => (
      <div className="w-[390px] max-w-none">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PanelDock>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default on a phone: the game has the screen, nothing is open. */
export const Closed: Story = {
  args: { active: null },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const chat = canvas.getByRole('button', { name: 'Chat' });
    await expect(chat).toHaveAttribute('aria-expanded', 'false');
    // Every dock button is a thumb target, not a pointer target — 48px
    // stacked, 40px in the one-line layout a short viewport gets.
    for (const label of ['Chat', 'Agent', 'Suggestions']) {
      const button = canvas.getByRole('button', { name: label });
      await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
    }
    await userEvent.click(chat);
    await expect(args.onSelect).toHaveBeenCalledWith('chat');
  },
};

export const PanelOpen: Story = {
  args: { active: 'suggestions' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Suggestions' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(canvas.getByRole('button', { name: 'Chat' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  },
};

/**
 * Badges are the only signal a room behind the dock can give — and the open
 * panel never wears one, because you are already looking at it.
 */
export const Unread: Story = {
  args: { active: 'agent', unread: { chat: 3, agent: 5, suggestions: 42 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('3 new')).toHaveTextContent('3');
    await expect(canvas.getByLabelText('42 new')).toHaveTextContent('9+');
    await expect(canvas.queryByLabelText('5 new')).not.toBeInTheDocument();
  },
};
