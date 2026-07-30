import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { GameCard } from '../web/src/components/GameCard.tsx';
import { makeGame } from '../tests/fixtures.ts';

const meta = {
  title: 'Arcade/GameCard',
  component: GameCard,
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GameCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LiveAndWorking: Story = {
  args: {
    game: makeGame({ viewers: 3, plays: 12, agentStatus: 'running' }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('LIVE')).toBeInTheDocument();
    await expect(canvas.getByText('working')).toBeInTheDocument();
    await expect(canvas.getByText('3')).toBeInTheDocument();
    await expect(canvas.getByText('12')).toBeInTheDocument();
    // Public listings don't repeat the obvious; the badge is opt-in.
    await expect(canvas.queryByText('public')).not.toBeInTheDocument();
  },
};

export const LiveAndIdle: Story = {
  args: {
    game: makeGame({ agentStatus: 'needs_input' }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('LIVE')).toBeInTheDocument();
    await expect(canvas.getByText('idle')).toBeInTheDocument();
  },
};

export const Building: Story = {
  args: {
    game: makeGame({ status: 'creating', agentStatus: 'starting', daemonUrl: null }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('BUILDING')).toBeInTheDocument();
    await expect(canvas.getByText('starting')).toBeInTheDocument();
  },
};

export const MyGamesVisibility: Story = {
  args: {
    game: makeGame(),
    showVisibility: true,
  },
  render: (args) => (
    <div className="grid w-[42rem] max-w-none grid-cols-2 gap-4">
      <GameCard {...args} showSettings />
      <GameCard
        game={makeGame({
          id: 'game_fixture02',
          status: 'stopped',
          agentStatus: 'terminated',
          isPublic: false,
          daemonUrl: null,
        })}
        showVisibility
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('public')).toBeInTheDocument();
    await expect(canvas.getByText('private')).toBeInTheDocument();
    await expect(canvas.getByText('OFFLINE')).toBeInTheDocument();
    await expect(canvas.getByLabelText(/Settings for Neon Snake/)).toBeInTheDocument();
  },
};

export const WithAgentArt: Story = {
  args: {
    game: makeGame({ hasPreview: true, hasIcon: true, artVersion: 1 }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Cover art replaces the initials watermark; the icon joins the title.
    await expect(canvasElement.querySelector('img[src*="/art/preview"]')).toBeTruthy();
    await expect(canvasElement.querySelector('img[src*="/art/icon"]')).toBeTruthy();
    await expect(canvas.queryByText('NE')).not.toBeInTheDocument();
  },
};

export const HoverLivePreview: Story = {
  args: {
    game: makeGame({ daemonUrl: 'https://example.test/play' }),
  },
  play: async ({ canvasElement }) => {
    const link = canvasElement.querySelector('a')!;
    await userEvent.hover(link);
    // Hover intent is 350ms; the live game iframe mounts inert after it.
    await waitFor(
      () => expect(canvasElement.querySelector('iframe[src*="example.test"]')).toBeTruthy(),
      { timeout: 3000 },
    );
    await userEvent.unhover(link);
    await waitFor(() => expect(canvasElement.querySelector('iframe')).toBeNull(), {
      timeout: 2000,
    });
  },
};

export const GridAlignment: Story = {
  args: { game: makeGame() },
  render: () => (
    <div className="grid w-[64rem] max-w-none grid-cols-3 gap-4">
      <GameCard game={makeGame({ id: 'g1', title: 'Pong', prompt: 'Pong.' })} />
      <GameCard
        game={makeGame({
          id: 'g2',
          title: 'A tower defense game with an extremely long title that must not wrap',
          prompt:
            'A sprawling brief with far more words than two lines can hold: waves, upgrades, bosses, an economy, achievements, controller support, and a level editor for the community to share maps with.',
        })}
      />
      <GameCard
        game={makeGame({
          id: 'g3',
          title: 'Snake',
          prompt: 'A two-line description that lands somewhere in the middle of the other two.',
        })}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const cards = Array.from(canvasElement.querySelectorAll('a'));
    await expect(cards).toHaveLength(3);
    // Equal card heights regardless of copy length...
    const heights = cards.map((c) => c.getBoundingClientRect().height);
    await expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    // ...and the meta rows sit on the same baseline.
    const metaTops = cards.map((c) => c.querySelector('.mt-auto')!.getBoundingClientRect().top);
    await expect(Math.max(...metaTops) - Math.min(...metaTops)).toBeLessThan(1);
    // Long copy ellipsizes instead of growing the card.
    const longTitle = within(cards[1]!).getByText(/tower defense/);
    await expect(longTitle.scrollWidth).toBeGreaterThan(longTitle.clientWidth);
  },
};
