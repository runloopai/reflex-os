/**
 * The words and the links a share carries.
 *
 * Intent URLs are the whole integration with each network — there is no
 * SDK to catch a mistake, and a malformed one fails silently as an empty
 * compose box — so every target is pinned here: the link it carries, the
 * attribution on it, and that the text survives encoding.
 */
import { describe, expect, it } from 'vitest';
import { BRAND_MARKS } from '../web/src/lib/brand-marks.ts';
import {
  SHARE_SOURCES,
  SHARE_TARGETS,
  arcadeShareText,
  copyShareUrl,
  displayShareUrl,
  shareText,
  shippedShareText,
  taggedShareUrl,
} from '../web/src/lib/share.ts';

const LINK = 'https://arcade.example.com/g/game_1';
const subject = { url: LINK, title: 'MMO Snake', text: shareText('MMO Snake') };

describe('taggedShareUrl', () => {
  it('adds standard utm params without losing the existing query', () => {
    const tagged = new URL(taggedShareUrl(`${LINK}?panel=chat#top`, 'x'));
    expect(tagged.origin + tagged.pathname).toBe(LINK);
    expect(tagged.searchParams.get('panel')).toBe('chat');
    expect(tagged.searchParams.get('utm_source')).toBe('x');
    expect(tagged.searchParams.get('utm_medium')).toBe('social');
    expect(tagged.searchParams.get('utm_campaign')).toBe('arcade-share');
    expect(tagged.hash).toBe('#top');
  });

  it('keeps a relative link relative', () => {
    expect(taggedShareUrl('/g/game_1', 'reddit')).toBe(
      '/g/game_1?utm_source=reddit&utm_medium=social&utm_campaign=arcade-share',
    );
  });

  it('replaces its own params rather than stacking them', () => {
    const once = taggedShareUrl(LINK, 'x');
    const twice = taggedShareUrl(once, 'bluesky');
    expect(twice.match(/utm_source/g)).toHaveLength(1);
    expect(new URL(twice).searchParams.get('utm_source')).toBe('bluesky');
  });

  it('passes through anything it cannot parse', () => {
    expect(taggedShareUrl('', 'x')).toBe('');
  });
});

describe('SHARE_TARGETS', () => {
  it('covers the networks a game spreads on, each exactly once', () => {
    expect(SHARE_TARGETS.map((t) => t.id)).toEqual([
      'x',
      'bluesky',
      'reddit',
      'linkedin',
      'threads',
      'facebook',
      'whatsapp',
      'telegram',
      'email',
    ]);
  });

  it('gives every target a logo and a colour to find it by', () => {
    for (const t of SHARE_TARGETS) {
      // A target with no mark renders an empty circle, which looks like a
      // broken image rather than a missing feature.
      expect(BRAND_MARKS[t.id], t.id).toBeTruthy();
      expect(t.accent, t.id).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Two brands sharing a colour would defeat the point of having one.
    const accents = SHARE_TARGETS.map((t) => t.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it('carries the shared link, tagged with the target it went to', () => {
    for (const target of SHARE_TARGETS) {
      const href = target.href(subject);
      const decoded = decodeURIComponent(href);
      expect(decoded, target.id).toContain(LINK);
      expect(decoded, target.id).toContain(`utm_source=${target.id}`);
      // A network that got an untagged copy too would report the wrong
      // source for half its arrivals.
      expect(decoded.match(new RegExp(`${LINK}(?!\\?)`, 'g')), target.id).toBeNull();
    }
  });

  it('sends the pitch everywhere the network accepts one', () => {
    // Facebook and LinkedIn are the exceptions: both dropped prefilled
    // text and compose the post from the card's own tags instead.
    const composeFromCard = new Set(['facebook', 'linkedin']);
    for (const target of SHARE_TARGETS.filter((t) => !composeFromCard.has(t.id))) {
      expect(decodeURIComponent(target.href(subject)), target.id).toContain(subject.text);
    }
    for (const id of composeFromCard) expect(target(id).href(subject)).not.toContain('text=');
  });

  it('encodes the text, so a title with punctuation cannot break the URL', () => {
    const tricky = { ...subject, text: 'Snake & Ladders? "live" #now', title: 'Snake & Ladders' };
    for (const t of SHARE_TARGETS) {
      const href = t.href(tricky);
      expect(href, t.id).not.toContain(' ');
      expect(href, t.id).not.toContain('"');
      // Everything after the first `?` is query, so a bare `#` there would
      // truncate the post at the hash.
      expect(href.slice(href.indexOf('?') + 1), t.id).not.toContain('#');
    }
  });

  it('opens each network on its own posting endpoint', () => {
    const hosts: Record<string, string> = {
      x: 'x.com/intent/post',
      bluesky: 'bsky.app/intent/compose',
      reddit: 'reddit.com/submit',
      linkedin: 'linkedin.com/sharing/share-offsite',
      threads: 'threads.net/intent/post',
      facebook: 'facebook.com/sharer',
      whatsapp: 'api.whatsapp.com/send',
      telegram: 't.me/share/url',
      email: 'mailto:',
    };
    for (const t of SHARE_TARGETS) expect(t.href(subject), t.id).toContain(hosts[t.id]!);
  });

  it('gives each target the line it actually shows', () => {
    // Reddit's title IS the post; email's subject is the line in an inbox.
    expect(decodeURIComponent(target('reddit').href(subject))).toContain(`title=${subject.text}`);
    expect(decodeURIComponent(target('email').href(subject))).toContain('subject=MMO Snake');
  });
});

describe('share copy', () => {
  it('names the game and the arcade, so a stranger knows what they clicked', () => {
    expect(shareText('MMO Snake')).toContain('"MMO Snake"');
    expect(shareText('MMO Snake')).toContain('Reflex Arcade');
    expect(arcadeShareText()).toContain('Reflex Arcade');
  });

  it('puts the sharer in the story when their suggestion shipped', () => {
    const text = shippedShareText('MMO Snake', 'add a scoreboard');
    expect(text).toContain('add a scoreboard');
    expect(text).toContain('MMO Snake');
    expect(text.startsWith('I asked for')).toBe(true);
  });

  it('clips a long suggestion so the post fits the networks that carry it', () => {
    // Bodies are capped at 500 server-side; X stops at 280 and Reddit
    // refuses a title over 300, so an unclipped quote is a post that
    // cannot be sent.
    const text = shippedShareText('MMO Snake', 'add a scoreboard '.repeat(30));
    expect(text.length).toBeLessThan(280);
    expect(text).toContain('…');
  });
});

describe('SHARE_SOURCES', () => {
  it('is every source our own links can carry, and nothing else', () => {
    expect(SHARE_SOURCES).toEqual([...SHARE_TARGETS.map((t) => t.id), 'link']);
    expect(SHARE_SOURCES).not.toContain('competitor_ad');
  });
});

describe('copyShareUrl', () => {
  it('tags a copied link too — most shares are a paste', () => {
    expect(copyShareUrl(LINK)).toContain('utm_source=link');
  });
});

describe('BRAND_MARKS', () => {
  it('is exactly the targets, with nothing orphaned', () => {
    expect(Object.keys(BRAND_MARKS).sort()).toEqual(SHARE_TARGETS.map((t) => t.id).sort());
  });

  it('is bare path data, so every mark can be drawn the same way', () => {
    for (const [id, d] of Object.entries(BRAND_MARKS)) {
      // Markup here would mean a brand shipped its own <svg>/<title> or a
      // background <rect>, and the mark would not take the menu's colour.
      expect(d, id).not.toContain('<');
      expect(d.startsWith('M'), id).toBe(true);
    }
  });

  it('draws every mark on the same 24 grid', () => {
    for (const [id, d] of Object.entries(BRAND_MARKS)) {
      // Coordinates only mean anything against a shared viewBox: a mark
      // authored on a 1024 grid (the usual size elsewhere) renders as a
      // giant fragment of itself inside a `0 0 24 24` one.
      //
      // A loose bound on purpose. Not every number in path data is a
      // coordinate — an arc's radii are not, and Facebook's mark legally
      // carries a 26.805 radius for a nearly-flat curve — so this catches
      // the wrong grid, which is off by a factor of tens, and does not try
      // to be a bounds check on the drawing.
      //
      // Numbers are written compactly: `-.929` and `1.56.5` are both legal,
      // so a naive \d+ pattern reads `-.929` as 929.
      const numbers = d.match(/-?(?:\d+(?:\.\d+)?|\.\d+)/g)?.map(Number) ?? [];
      expect(numbers.length, id).toBeGreaterThan(0);
      expect(Math.max(...numbers.map(Math.abs)), id).toBeLessThan(100);
    }
  });
});

describe('displayShareUrl', () => {
  it('shows the part a person recognises, not the tracking', () => {
    expect(displayShareUrl(copyShareUrl(LINK))).toBe('arcade.example.com/g/game_1');
  });

  it('keeps the host when there is no path to show', () => {
    expect(displayShareUrl('https://arcade.example.com/')).toBe('arcade.example.com');
    expect(displayShareUrl('https://www.arcade.example.com')).toBe('arcade.example.com');
  });

  it('leaves a relative link as its path', () => {
    expect(displayShareUrl('/g/game_1')).toBe('/g/game_1');
  });

  it('passes through anything it cannot parse', () => {
    expect(displayShareUrl('')).toBe('');
    expect(displayShareUrl('   ')).toBe('');
  });
});

function target(id: string) {
  const found = SHARE_TARGETS.find((t) => t.id === id);
  if (!found) throw new Error(`no share target ${id}`);
  return found;
}
