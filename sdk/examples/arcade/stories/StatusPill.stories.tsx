import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { StatusPill } from '../web/src/components/StatusPill.tsx';

const meta = {
  title: 'Arcade/StatusPill',
  component: StatusPill,
} satisfies Meta<typeof StatusPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllStatuses: Story = {
  args: { status: 'live' },
  render: () => (
    <div className="flex gap-3">
      <StatusPill status="creating" />
      <StatusPill status="live" />
      <StatusPill status="error" />
      <StatusPill status="stopped" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const label of ['building', 'live', 'error', 'stopped']) {
      await expect(canvas.getByText(label)).toBeInTheDocument();
    }
  },
};
