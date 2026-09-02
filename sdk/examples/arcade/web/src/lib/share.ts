/**
 * Everything a share carries: the words, the networks, and the tag that
 * says which post a visitor came back through.
 *
 * Kept apart from the button that sends them because a module mixing
 * components and plain exports loses Fast Refresh — and because the pitch
 * and the intent URLs are worth testing without a browser.
 *
 * The link itself is the product: pasted anywhere it unfurls into a card
 * with the agent's own cover art (`server/share.ts` renders those tags), so
 * every target below is a plain intent URL. No third-party script ever
 * loads on the page, which keeps sharing free of trackers and of the
 * layout jank their widgets bring.
 */

/** What a share is about: a game, the arcade itself, or a shipped build. */
export interface ShareSubject {
  /** Canonical, untagged URL. Each target adds its own attribution. */
  url: string;
  /** Subject line for the targets that have one (email, Reddit). */
  title: string;
  /** The pitch that rides along with the link. */
  text: string;
}

/** The pitch that rides along on a post about a game. */
export function shareText(title: string): string {
  return `An agent is building "${title}" live on Reflex Arcade — watch it, play it, tell it what to build next.`;
}

/** The pitch for the arcade itself, for people sharing the shelf. */
export function arcadeShareText(): string {
  return 'Reflex Arcade: agents building playable games live, steered by whoever is watching. Pick one and tell it what to build next.';
}

/**
 * Trim to a word boundary so a post never ends mid-word. Mirrors the
 * server's `truncate` in `server/share.ts`; the two cannot share a module
 * across the web/server tsconfig split, and it is five lines.
 */
function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The pitch for a suggestion that just shipped — the moment worth sharing,
 * because whoever posts it is in the story: they asked, an agent built it,
 * and the link is the proof you can play.
 *
 * A suggestion body may be 500 characters; X stops at 280 and Reddit
 * refuses a title over 300, so the quoted ask is clipped rather than
 * silently producing a post that cannot be sent.
 */
export function shippedShareText(gameTitle: string, suggestion: string): string {
  return `I asked for "${truncate(suggestion, 120)}" and an agent shipped it into "${truncate(
    gameTitle,
    60,
  )}" on Reflex Arcade. Play it, then tell it what to build next.`;
}

/**
 * Tag a link so an arrival can be traced back to the post that carried it.
 * Standard `utm_*` names, so any analytics tool reads them unaided, and
 * existing query params (a deep link into a game) are preserved.
 *
 * A relative URL is resolved against a placeholder base for parsing only:
 * what goes in absolute comes back absolute, and a router path stays a path.
 */
export function taggedShareUrl(url: string, source: string): string {
  if (!url.trim()) return url;
  const base = 'https://arcade.invalid';
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return url;
  }
  parsed.searchParams.set('utm_source', source);
  parsed.searchParams.set('utm_medium', 'social');
  parsed.searchParams.set('utm_campaign', 'arcade-share');
  return parsed.origin === base ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
}

function tagged(url: string, source: string): string {
  return taggedShareUrl(url, source);
}

/**
 * How a link reads once the protocol and the tracking are stripped off it:
 * the part a person recognises. The menu shows this while the clipboard
 * gets the tagged URL — nobody wants to read `utm_medium=social`, and a
 * wrapped 90-character string tells you less about where you are going
 * than `arcade.reflex.run/g/mmo-snake` does.
 */
export function displayShareUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  let parsed: URL;
  try {
    parsed = new URL(trimmed, 'https://arcade.invalid');
  } catch {
    return trimmed;
  }
  const host = parsed.host.replace(/^www\./, '');
  const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
  return `${parsed.origin === 'https://arcade.invalid' ? '' : host}${path}` || host;
}

export interface ShareTarget {
  /** Stable id; also the `utm_source` a visitor arrives with. */
  id: string;
  label: string;
  /**
   * The network's colour. Its official brand value where that reads on the
   * zinc-950 menu, and a lightened cast of it where it does not — the two
   * marks whose brand colour is pure black (X, Threads) are drawn light,
   * the way both brands draw them on a dark ground themselves. Each entry
   * records the official value it came from. Used as a tint and a ring,
   * never as a fill behind body text.
   *
   * The logo itself is keyed by `id` in `brand-marks.ts`.
   */
  accent: string;
  /** Intent URL for this network, with the link already tagged. */
  href: (subject: ShareSubject) => string;
}

const q = encodeURIComponent;

/**
 * Where a game can go, roughly in the order this audience uses them.
 *
 * Targets that take the text and the link separately get them separately
 * (X, Reddit, Telegram, email); the rest accept only one field, so the link
 * is appended to the text — each of them linkifies it and unfurls the card.
 * Facebook takes no text at all and composes from the card itself.
 */
export const SHARE_TARGETS: ShareTarget[] = [
  {
    id: 'x',
    label: 'X',
    accent: '#e7e9ea', // official: 000000, drawn light for a dark ground
    href: ({ url, text }) => `https://x.com/intent/post?text=${q(text)}&url=${q(tagged(url, 'x'))}`,
  },
  {
    id: 'bluesky',
    label: 'Bluesky',
    accent: '#4c9eff', // official: 1185FE
    href: ({ url, text }) =>
      `https://bsky.app/intent/compose?text=${q(`${text}\n\n${tagged(url, 'bluesky')}`)}`,
  },
  {
    // Reddit's `title` is the post itself — the line people scroll past —
    // so it gets the pitch, not the bare game name.
    id: 'reddit',
    label: 'Reddit',
    accent: '#ff5c33', // official: FF4500
    href: ({ url, text }) =>
      `https://www.reddit.com/submit?url=${q(tagged(url, 'reddit'))}&title=${q(text)}`,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    accent: '#4aa3e8', // official: 0A66C2
    href: ({ url }) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${q(tagged(url, 'linkedin'))}`,
  },
  {
    id: 'threads',
    label: 'Threads',
    accent: '#b8bcc4', // official: 000000, drawn light for a dark ground
    href: ({ url, text }) =>
      `https://www.threads.net/intent/post?text=${q(`${text}\n\n${tagged(url, 'threads')}`)}`,
  },
  {
    id: 'facebook',
    label: 'Facebook',
    accent: '#5b8def', // official: 0866FF
    href: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${q(tagged(url, 'facebook'))}`,
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    accent: '#34d97a', // official: 25D366
    href: ({ url, text }) =>
      `https://api.whatsapp.com/send?text=${q(`${text} ${tagged(url, 'whatsapp')}`)}`,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    accent: '#41b0e8', // official: 26A5E4
    href: ({ url, text }) =>
      `https://t.me/share/url?url=${q(tagged(url, 'telegram'))}&text=${q(text)}`,
  },
  {
    // The one target with no brand behind it, so it gets the app's own
    // violet and an envelope drawn to match the eight logos beside it.
    id: 'email',
    label: 'Email',
    accent: '#a78bfa', // official: no brand — the app’s own violet
    href: ({ url, title, text }) =>
      `mailto:?subject=${q(title)}&body=${q(`${text}\n\n${tagged(url, 'email')}`)}`,
  },
];

/** The source a copied link (and the OS share sheet) reports. */
export const COPY_SOURCE = 'link';

/**
 * The link for the clipboard and for the OS share sheet. Tagged as well:
 * a link pasted into Slack, Discord or a group chat spreads exactly like a
 * post does, and copying is where most shares actually go.
 */
export function copyShareUrl(url: string): string {
  return taggedShareUrl(url, COPY_SOURCE);
}

/**
 * Every source one of our own links can carry. The join route checks
 * arrivals against this, so a crafted `?utm_source=` cannot invent a
 * channel in the arcade's own numbers.
 */
export const SHARE_SOURCES: readonly string[] = [
  ...SHARE_TARGETS.map((target) => target.id),
  COPY_SOURCE,
];
