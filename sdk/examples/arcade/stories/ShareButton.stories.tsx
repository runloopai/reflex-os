import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { ShareButton } from '../web/src/components/ShareButton.tsx';
import { arcadeShareText, shareText, shippedShareText } from '../web/src/lib/share.ts';

const URL = 'https://arcade.example.com/g/game_1';
const TAGGED = `${URL}?utm_source=link&utm_medium=social&utm_campaign=arcade-share`;

/**
 * The menu renders into a body portal (it has to: two of its three call
 * sites sit inside `overflow-hidden` cards), so it is never inside the
 * story canvas.
 */
const menu = () => within(document.body);

/**
 * Open the menu and wait for it to arrive. It fades in, and jest-dom reads
 * a frame-zero opacity of 0 as "not visible" — so asserting on it without
 * waiting is a race every story would lose some of the time.
 */
async function openMenu(canvasElement: HTMLElement, name = 'Share this game') {
  const trigger = within(canvasElement).getByRole('button', { name });
  await userEvent.click(trigger);
  await waitFor(() => expect(menu().getByRole('menu')).toBeVisible());
  return trigger;
}

const meta = {
  title: 'Arcade/ShareButton',
  component: ShareButton,
  args: { url: URL, title: 'MMO Snake' },
  // Room below the trigger, so the menu is not flipped in every screenshot.
  decorators: [
    (Story) => (
      <div className="flex h-96 justify-end p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ShareButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Desktop has no share sheet worth handing off to, so the button opens the
 * menu — and the menu takes the keyboard, because a `role="menu"` nobody
 * can drive with the arrow keys is a promise the markup does not keep.
 */
export const OpensTheMenu: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Share this game' });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await openMenu(canvasElement);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(menu().getByRole('menuitem', { name: 'Copy link' })).toHaveFocus();
  },
};

/**
 * The link leads, because most shares are a paste into a group chat. What
 * is shown is the readable form; what lands on the clipboard is tagged.
 */
export const ShowsTheLinkItWillCopy: Story = {
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement);
    await expect(menu().getByText('arcade.example.com/g/game_1')).toBeVisible();
    // The utm noise is on the clipboard, not in anyone's face.
    await expect(menu().queryByText(/utm_source/)).toBeNull();
  },
};

/** Every network is one click from the menu, and each carries the game. */
export const EveryNetwork: Story = {
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement);
    for (const label of [
      'X',
      'Bluesky',
      'Reddit',
      'LinkedIn',
      'Threads',
      'Facebook',
      'WhatsApp',
      'Telegram',
      'Email',
    ]) {
      const item = menu().getByRole('menuitem', { name: `Share on ${label}` });
      await expect(item).toHaveAttribute('href', expect.stringContaining('game_1'));
      // The monogram is decoration: the label is the accessible name, so a
      // screen reader never announces a lone "f".
      await expect(item).toHaveTextContent(label);
    }
  },
};

/** The intent links carry the game's own URL, tagged with where it went. */
export const LinksToTheGame: Story = {
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement);
    const x = menu().getByRole('menuitem', { name: 'Share on X' });
    await expect(x).toHaveAttribute('href', expect.stringContaining('x.com/intent/post'));
    await expect(x).toHaveAttribute('href', expect.stringContaining('utm_source%3Dx'));
    await expect(x).toHaveAttribute('href', expect.stringContaining(encodeURIComponent(URL)));
    const bluesky = menu().getByRole('menuitem', { name: 'Share on Bluesky' });
    await expect(bluesky).toHaveAttribute('href', expect.stringContaining('bsky.app'));
  },
};

/** Copying is the path that feeds Slack, Discord and Twitch chat. */
export const CopiesTheLink: Story = {
  play: async ({ canvasElement }) => {
    let copied = '';
    // `navigator.clipboard` is a getter-only property, so it is redefined
    // rather than assigned. Chromium here has no clipboard permission.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (value: string) => {
          copied = value;
          return Promise.resolve();
        },
      },
    });
    await openMenu(canvasElement);
    await userEvent.click(menu().getByRole('menuitem', { name: 'Copy link' }));
    // Tagged like any other share: a paste spreads the same way a post does.
    await expect(copied).toBe(TAGGED);
    await expect(menu().getByRole('menuitem', { name: 'Link copied' })).toBeVisible();
    // Announced, not just recoloured — the swap is silent to a screen
    // reader that has already moved past the button.
    await expect(menu().getByText('Link copied to clipboard')).toBeInTheDocument();
  },
};

/** Arrow keys walk the menu, and wrap rather than dead-end. */
export const KeyboardWalksTheMenu: Story = {
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement);
    await userEvent.keyboard('{ArrowDown}');
    await expect(menu().getByRole('menuitem', { name: 'Share on X' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    await expect(menu().getByRole('menuitem', { name: 'Share on Email' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(menu().getByRole('menuitem', { name: 'Copy link' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    await expect(menu().getByRole('menuitem', { name: 'Share on Email' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    await expect(menu().getByRole('menuitem', { name: 'Copy link' })).toHaveFocus();
  },
};

/**
 * Escape and Tab both close it and hand focus back. Tab especially: the
 * menu is a portal at the end of `body`, so tabbing out of a subtree that
 * is unmounting under you otherwise strands focus on `body`.
 */
export const LeavingReturnsFocus: Story = {
  play: async ({ canvasElement }) => {
    const trigger = await openMenu(canvasElement);
    await userEvent.keyboard('{Escape}');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toHaveFocus();

    await openMenu(canvasElement);
    await userEvent.keyboard('{Tab}');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toHaveFocus();
  },
};

/** Dismissing must work on touch, where there is no blur to listen for. */
export const ClosesOnOutsideClick: Story = {
  play: async ({ canvasElement }) => {
    const trigger = await openMenu(canvasElement);
    // The scrim covers the viewport above everything but the menu, so any
    // click that is not on the menu is this click.
    await userEvent.click(menu().getByTestId('share-scrim'));
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  },
};

/**
 * A desktop with a system share sheet keeps it — as one row under the
 * menu, not instead of it. `navigator.share` exists on desktop Chrome and
 * Edge, and short-circuiting to it there meant this menu was never seen on
 * the platform most sharing is done from.
 */
export const SystemSheetStaysReachable: Story = {
  play: async ({ canvasElement }) => {
    let shared: { url?: string } | null = null;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: { url?: string }) => {
        shared = data;
        return Promise.resolve();
      },
    });
    try {
      // The menu opens; the sheet does not pre-empt it.
      await openMenu(canvasElement);
      await expect(shared).toBeNull();
      await userEvent.click(menu().getByRole('menuitem', { name: 'More apps…' }));
      await expect(shared).not.toBeNull();
      await expect(shared!.url).toBe(TAGGED);
    } finally {
      // The runner shares one document across stories, so an installed
      // `navigator.share` would leak into every story after this one.
      Reflect.deleteProperty(navigator, 'share');
    }
  },
};

/** The arcade's own share: a labelled button in the hero, not an icon. */
export const SharingTheArcade: Story = {
  args: {
    url: 'https://arcade.example.com/',
    title: 'Reflex Arcade',
    text: arcadeShareText(),
    label: 'Share the arcade',
    cta: 'Share',
    hint: "Unfurls into the arcade's card when pasted.",
  },
  play: async ({ canvasElement }) => {
    const trigger = await openMenu(canvasElement, 'Share the arcade');
    await expect(trigger).toHaveTextContent('Share');
    const x = menu().getByRole('menuitem', { name: 'Share on X' });
    await expect(x).toHaveAttribute('href', expect.stringContaining(encodeURIComponent('Arcade')));
    // A root URL has no path to show, so the host stands in for it.
    await expect(menu().getByText('arcade.example.com')).toBeVisible();
  },
};

/** A suggestion that shipped: the sharer is in the story they post. */
export const SharingAShippedBuild: Story = {
  args: {
    text: shippedShareText('MMO Snake', 'add a scoreboard'),
    label: 'Share what the agent shipped',
  },
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement, 'Share what the agent shipped');
    const x = menu().getByRole('menuitem', { name: 'Share on X' });
    await expect(x).toHaveAttribute(
      'href',
      expect.stringContaining(encodeURIComponent('I asked for')),
    );
  },
};

export const ShareCopy: Story = {
  play: async () => {
    await expect(shareText('MMO Snake')).toContain('"MMO Snake"');
    await expect(shareText('MMO Snake')).toContain('Reflex Arcade');
    await expect(shippedShareText('MMO Snake', 'a scoreboard')).toContain('a scoreboard');
  },
};
