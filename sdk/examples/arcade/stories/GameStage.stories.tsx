/**
 * The stage's job beyond drawing an iframe is deciding who holds the
 * keyboard, so that is what these stories pin: it takes the keyboard when
 * nobody wants it, and never takes it from someone typing.
 */
import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { GameStage } from '../web/src/components/GameStage.tsx';

/** A game that draws something, so the story is a visual reference too. */
const GAME = `data:text/html,${encodeURIComponent(
  '<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0a0a0b;color:#a78bfa;font:600 14px system-ui">Neon Snake</body>',
)}`;

/** The build finishing later, without anything touching focus. */
const SHIP = 'story:ship';

function LateArrival() {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const ship = () => setSrc(GAME);
    window.addEventListener(SHIP, ship);
    return () => window.removeEventListener(SHIP, ship);
  }, []);
  return (
    <div className="flex h-64 flex-col gap-2">
      <input
        aria-label="Say something"
        placeholder="Say something"
        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200"
      />
      <GameStage src={src} title="Neon Snake" fallback={<p>The agent is building…</p>} />
    </div>
  );
}

const meta = {
  title: 'Arcade/GameStage',
  component: GameStage,
  args: { src: GAME, title: 'Neon Snake', fallback: <p>The agent is building…</p> },
  decorators: [
    (Story) => (
      <div className="flex h-64 w-full flex-col">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GameStage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * These are arrow-key games. Opening one and having it ignore every key
 * until you thought to click it first was the bug worth fixing.
 */
export const TakesTheKeyboardOnOpen: Story = {
  play: async ({ canvasElement }) => {
    const frame = within(canvasElement).getByTitle('Neon Snake');
    await expect(frame).toHaveFocus();
  },
};

/** Nothing to focus yet, and no error for trying. */
export const StillBuilding: Story = {
  args: { src: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('The agent is building…')).toBeVisible();
    await expect(canvas.queryByTitle('Neon Snake')).toBeNull();
  },
};

/**
 * The daemon URL usually lands minutes after you opened the page — often
 * mid-sentence in chat. A person typing outranks the game.
 */
export const NeverStealsFromSomeoneTyping: Story = {
  render: () => <LateArrival />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('Say something');
    await userEvent.click(input);
    await userEvent.type(input, 'nice dodge');
    window.dispatchEvent(new CustomEvent(SHIP));
    const frame = await canvas.findByTitle('Neon Snake');
    await expect(input).toHaveFocus();
    await expect(frame).not.toHaveFocus();
    // Getting the keyboard back is the browser's job from here: a click
    // anywhere in an iframe focuses it, which is why the stage has no
    // click handler of its own.
  },
};
