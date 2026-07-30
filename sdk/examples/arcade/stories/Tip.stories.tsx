import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Tip } from '../web/src/components/Tip.tsx';

const meta = {
  title: 'Arcade/Tip',
  component: Tip,
} satisfies Meta<typeof Tip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'Anyone can watch and suggest',
    children: (
      <button className="rounded-md border border-zinc-700 px-3 py-1 text-sm">badge</button>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The tooltip node is always in the DOM (revealed by CSS :hover); assert
    // its presence and role rather than a hover-driven visibility flip.
    const tip = canvas.getByRole('tooltip');
    await expect(tip).toHaveTextContent('Anyone can watch and suggest');
  },
};
