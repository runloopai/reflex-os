import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { ShareButton } from '../web/src/components/ShareButton.tsx';
import { arcadeShareText, shareText, shippedShareText } from '../web/src/lib/share.ts';

const URL = 'https://arcade.example.com/g/game_1';

const meta = {
  title: 'Arcade/ShareButton',
  component: ShareButton,
  args: { url: URL, title: 'MMO Snake' },
} satisfies Meta<typeof ShareButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Desktop has no share sheet, so the button opens the menu. Chromium in
 * this runner has no `navigator.share`, which is exactly that path.
 */
export const OpensTheMenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Share this game' });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('menu')).toBeVisible();
  },
};

/** Every network is one click from the menu, and each carries the game. */
export const EveryNetwork: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Share this game' }));
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
      const item = canvas.getByRole('menuitem', { name: `Share on ${label}` });
      await expect(item).toHaveAttribute('href', expect.stringContaining('game_1'));
    }
  },
};

/** The intent links carry the game's own URL, tagged with where it went. */
export const LinksToTheGame: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Share this game' }));
    const x = canvas.getByRole('menuitem', { name: 'Share on X' });
    await expect(x).toHaveAttribute('href', expect.stringContaining('x.com/intent/post'));
    await expect(x).toHaveAttribute('href', expect.stringContaining('utm_source%3Dx'));
    await expect(x).toHaveAttribute('href', expect.stringContaining(encodeURIComponent(URL)));
    const bluesky = canvas.getByRole('menuitem', { name: 'Share on Bluesky' });
    await expect(bluesky).toHaveAttribute('href', expect.stringContaining('bsky.app'));
  },
};

/** Copying is the path that feeds Slack, Discord and Twitch chat. */
export const CopiesTheLink: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
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
    await userEvent.click(canvas.getByRole('button', { name: 'Share this game' }));
    await userEvent.click(canvas.getByRole('menuitem', { name: 'Copy link' }));
    // Tagged like any other share: a paste spreads the same way a post does.
    await expect(copied).toBe(`${URL}?utm_source=link&utm_medium=social&utm_campaign=arcade-share`);
    await expect(canvas.getByRole('menuitem', { name: 'Link copied' })).toBeVisible();
  },
};

/** Dismissing must work on touch, where there is no blur to listen for. */
export const ClosesOnOutsideClick: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Share this game' });
    await userEvent.click(button);
    await expect(canvas.getByRole('menu')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { hidden: true, name: '' }));
    await expect(button).toHaveAttribute('aria-expanded', 'false');
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
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Share the arcade' });
    await expect(button).toHaveTextContent('Share');
    await userEvent.click(button);
    const x = canvas.getByRole('menuitem', { name: 'Share on X' });
    await expect(x).toHaveAttribute('href', expect.stringContaining(encodeURIComponent('Arcade')));
  },
};

/** A suggestion that shipped: the sharer is in the story they post. */
export const SharingAShippedBuild: Story = {
  args: {
    text: shippedShareText('MMO Snake', 'add a scoreboard'),
    label: 'Share what the agent shipped',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Share what the agent shipped' }));
    const x = canvas.getByRole('menuitem', { name: 'Share on X' });
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
