import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { TimelineEntryList } from '../web/src/components/TimelineEntryList.tsx';
import type { TimelineEntry } from '../web/src/lib/game-timeline.ts';

const entries: TimelineEntry[] = [
  {
    id: 'ask',
    kind: 'ask',
    at: Date.parse('2026-07-20T10:00:00.000Z'),
    text: 'A cozy browser game where you grow plants on drifting asteroids.',
    authorName: 'Alex',
    authorId: 'user_owner',
  },
  {
    id: 'turn-1',
    kind: 'shipped',
    at: Date.parse('2026-07-20T10:04:00.000Z'),
    text: '',
    turn: 1,
  },
  {
    id: 'sug-1',
    kind: 'suggestion',
    at: Date.parse('2026-07-20T10:06:00.000Z'),
    text: 'add powerups that expire',
    authorName: 'Fan',
    authorId: 'user_fan',
    status: 'done',
    hearts: 3,
    ownerNote: 'keep them subtle',
    category: 'feature',
    dispatched: true,
  },
  {
    id: 'prompt-1',
    kind: 'owner',
    at: Date.parse('2026-07-20T10:10:00.000Z'),
    text: 'Make the starfield parallax slower.',
    authorName: 'Alex',
    authorId: 'user_owner',
  },
  {
    id: 'sug-2',
    kind: 'suggestion',
    at: Date.parse('2026-07-20T10:12:00.000Z'),
    text: 'add a scoreboard',
    authorName: 'Fan two',
    authorId: 'user_fan2',
    status: 'approved',
    hearts: 0,
    ownerNote: null,
    category: 'improvement',
    dispatched: false,
  },
  {
    id: 'fix-1',
    kind: 'housekeeping',
    at: Date.parse('2026-07-20T10:14:00.000Z'),
    text: 'Hosting problem — players currently see an error instead of your game.',
  },
];

const meta = {
  title: 'Arcade/GameTimeline',
  component: TimelineEntryList,
  args: { entries },
  // The preview already wraps stories in a MemoryRouter.
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TimelineEntryList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullStory: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Every kind reads as its own thing.
    await expect(canvas.getByText('The ask')).toBeInTheDocument();
    await expect(canvas.getByText('Owner prompt')).toBeInTheDocument();
    await expect(canvas.getAllByText('Suggestion')).toHaveLength(2);
    await expect(canvas.getByText('Automatic fix')).toBeInTheDocument();
    await expect(canvas.getByText(/Shipped/)).toBeInTheDocument();
    // A suggestion the agent never received says so.
    await expect(canvas.getByText('not sent')).toBeInTheDocument();
    // The owner's note rides along with the suggestion it steered.
    await expect(canvas.getByText('keep them subtle')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { entries: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Nothing has happened yet/)).toBeInTheDocument();
  },
};
