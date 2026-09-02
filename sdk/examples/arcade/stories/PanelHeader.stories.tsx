/**
 * The header card the three room panels share, and the agent status chip
 * that rides in it.
 *
 * Two rules are pinned here. The title row hides below `lg`, because the
 * phone sheet already carries the panel's name in its own title bar and two
 * headings stacked is the sheet saying "Suggestions" twice. And the status
 * chip says the same word `agentChip` gives every other surface, so a tile,
 * a banner and this never disagree about what the agent is doing.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Lightbulb } from 'lucide-react';
import { AgentStatusChip, PanelHeader } from '../web/src/components/PanelHeader.tsx';

const meta = {
  title: 'Arcade/PanelHeader',
  component: PanelHeader,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story: () => React.ReactElement) => (
      <div className="w-[380px] bg-zinc-950 p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PanelHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithStatus: Story = {
  args: {
    title: 'Suggestions',
    icon: <Lightbulb size={15} aria-hidden />,
    right: <AgentStatusChip status="running" />,
    children: (
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        The owner reviews suggestions; the agent works the most-hearted first.
      </p>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Suggestions' })).toBeInTheDocument();
    // `running` is "working" everywhere in the arcade, never the raw status.
    await expect(canvas.getByText('Agent working')).toBeVisible();
    await expect(canvas.getByText(/most-hearted first/)).toBeVisible();
  },
};

/** A devbox that suspended between turns reads as asleep, not offline. */
export const AsleepAgent: Story = {
  args: {
    title: 'Agent transcript',
    right: <AgentStatusChip status="suspended" />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(within(canvasElement).getByText('Agent asleep')).toBeVisible();
    await expect(canvas.getByRole('heading', { name: 'Agent transcript' })).toBeInTheDocument();
  },
};

/** No status to report: the chip renders nothing rather than an empty pill. */
export const NoStatus: Story = {
  args: {
    title: 'Room chat',
    right: <AgentStatusChip status={null} />,
    children: (
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        Everyone watching talks here. The owner wears a crown.
      </p>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/^Agent /)).toBeNull();
    await expect(canvas.getByText(/wears a crown/)).toBeVisible();
  },
};
