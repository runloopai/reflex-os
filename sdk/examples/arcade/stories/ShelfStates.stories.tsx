/**
 * What a shelf shows before it has tiles.
 *
 * Three pages render shelves and each used to answer differently — a bare
 * "Loading games...", a dashed call-to-action, nothing at all. These are the
 * one answer, so a slow fetch looks the same wherever it happens.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Gamepad2 } from 'lucide-react';
import { EmptyShelf, GameCardSkeletons } from '../web/src/components/ShelfStates.tsx';

const meta = {
  title: 'Arcade/ShelfStates',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story: () => React.ReactElement) => (
      <div className="w-[900px] bg-zinc-950 p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

/** Skeletons carry the tiles' own shape, so nothing jumps when they land. */
export const Loading: StoryObj<typeof GameCardSkeletons> = {
  render: () => <GameCardSkeletons count={3} />,
  play: async ({ canvasElement }) => {
    // `getByRole`, not `getByText`: text queries match inside `aria-hidden`
    // subtrees, so they cannot tell an announcement from silence. This one
    // fails if the status ever moves back inside the hidden skeleton grid.
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Loading games…');
  },
};

export const Empty: StoryObj<typeof EmptyShelf> = {
  render: () => (
    <EmptyShelf
      icon={<Gamepad2 size={22} aria-hidden />}
      title="No games yet"
      body="Describe a game and a Reflex agent starts building it live — you watch, the room suggests, hearts steer."
      action={
        <button type="button" className="mt-2 rounded-xl bg-violet-600 px-4 py-2 text-sm">
          Create a game
        </button>
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No games yet')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Create a game' })).toBeVisible();
  },
};

/** Someone else's empty profile has nothing to offer, so no action. */
export const EmptyWithoutAction: StoryObj<typeof EmptyShelf> = {
  render: () => (
    <EmptyShelf
      title="No public games yet"
      body="When this player makes a game public, it appears here."
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No public games yet')).toBeVisible();
    await expect(canvas.queryByRole('button')).toBeNull();
  },
};
