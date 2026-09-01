/**
 * Share cards. These run the same functions both HTML paths use, so this
 * is the spec for what a pasted arcade link says — including the two
 * things that are easy to get wrong and impossible to see from inside the
 * app: a private game must not unfurl, and the shell's default card must
 * not survive next to a game's.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameRow } from '../server/db.ts';
import {
  arcadeCard,
  gameIdFromUrl,
  injectShareTags,
  isAppRoute,
  oEmbedFor,
  originFromRequest,
  renderShareTags,
  shareCardFor,
  shareDescription,
  stripShareTags,
  truncate,
} from '../server/share.ts';
import {
  fallbackCardSvg,
  MAX_SVG_BYTES,
  sanitizeSvg,
  shareImageFor,
  wrapTitle,
} from '../server/og-image.ts';

const ORIGIN = 'https://arcade.example.com';

function game(overrides: Partial<GameRow> = {}): GameRow {
  return {
    id: 'game_1',
    ownerId: 'user_1',
    keyId: 'key_1',
    title: 'MMO Snake',
    prompt: 'Multiplayer snake in one shared world.',
    agentId: 'agent_1',
    agentStreamId: 'stream_1',
    agentType: 'claude-code',
    model: null,
    status: 'live',
    agentStatus: 'idle',
    isPublic: true,
    autoApprove: false,
    daemonUrl: 'https://5173-abc.tunnel.runloop.ai',
    daemonName: null,
    currentTask: null,
    currentTaskKind: null,
    plays: 12,
    previewArt: null,
    previewAnimArt: null,
    iconArt: null,
    artVersion: 3,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  } as GameRow;
}

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <title>Reflex Arcade</title>
    <meta name="description" content="the default blurb" />
    <meta property="og:title" content="Reflex Arcade — games built live by agents" />
    <meta property="og:image" content="/api/share-image" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="canonical" href="https://arcade.example.com/" />
  </head>
  <body><div id="root"></div></body>
</html>`;

describe('shareCardFor', () => {
  it('builds absolute URLs, because a crawler has no page to resolve against', () => {
    const card = shareCardFor(game(), 'Streamer', 4, ORIGIN)!;
    expect(card.url).toBe(`${ORIGIN}/g/game_1`);
    expect(card.image).toBe(`${ORIGIN}/api/games/game_1/og-image?v=3`);
    expect(card.title).toContain('MMO Snake');
    expect(card.author).toBe('Streamer');
  });

  it('busts the image cache when the agent redraws its cover', () => {
    const before = shareCardFor(game({ artVersion: 3 }), 'Streamer', 0, ORIGIN)!;
    const after = shareCardFor(game({ artVersion: 4 }), 'Streamer', 0, ORIGIN)!;
    expect(before.image).not.toBe(after.image);
  });

  // The privacy rule: a private link must not unfurl into its own title.
  it('refuses a card for a private game', () => {
    expect(shareCardFor(game({ isPublic: false }), 'Streamer', 0, ORIGIN)).toBeNull();
  });

  it('refuses a card for a game that does not exist', () => {
    expect(shareCardFor(null, 'nobody', 0, ORIGIN)).toBeNull();
  });

  it('offers an embed only while the game is live and reachable', () => {
    expect(shareCardFor(game(), 'S', 0, ORIGIN)!.embedUrl).toBe(
      'https://5173-abc.tunnel.runloop.ai',
    );
    expect(shareCardFor(game({ status: 'creating' }), 'S', 0, ORIGIN)!.embedUrl).toBeNull();
    expect(shareCardFor(game({ daemonUrl: null }), 'S', 0, ORIGIN)!.embedUrl).toBeNull();
  });
});

describe('shareDescription', () => {
  it('leads with the prompt and follows with what is happening', () => {
    const text = shareDescription({ prompt: 'Multiplayer snake.', status: 'live', plays: 12 }, 3);
    expect(text).toBe(
      'Multiplayer snake. — Playable now · 3 suggestions shipped · 12 plays. ' +
        'Watch the agent build it, then say what it should add.',
    );
  });

  it('counts one shipped suggestion in the singular', () => {
    expect(shareDescription({ prompt: 'p', status: 'live', plays: 1 }, 1)).toContain(
      '1 suggestion shipped · 1 play',
    );
  });

  it('says something useful for a game with no history yet', () => {
    const text = shareDescription({ prompt: 'p', status: 'creating', plays: 0 }, 0);
    expect(text).toBe('p — Watch the agent build it, then say what it should add.');
  });
});

describe('truncate', () => {
  it('cuts at a word boundary', () => {
    expect(truncate('one two three four', 12)).toBe('one two…');
  });

  it('leaves short text alone and collapses whitespace', () => {
    expect(truncate('one\n  two', 40)).toBe('one two');
  });
});

describe('renderShareTags', () => {
  it('escapes user text into attributes', () => {
    const card = shareCardFor(game({ title: 'Snake" onload="alert(1)' }), 'S', 0, ORIGIN)!;
    const tags = renderShareTags(card, `${ORIGIN}/api/oembed`);
    expect(tags).not.toContain('onload="alert(1)"');
    expect(tags).toContain('&quot;');
  });

  it('carries the card formats the big targets read', () => {
    const tags = renderShareTags(shareCardFor(game(), 'S', 0, ORIGIN)!, `${ORIGIN}/api/oembed`);
    expect(tags).toContain('property="og:image"');
    expect(tags).toContain('name="twitter:card" content="summary_large_image"');
    expect(tags).toContain('type="application/json+oembed"');
  });
});

describe('injectShareTags', () => {
  const injected = injectShareTags(
    SHELL,
    shareCardFor(game(), 'Streamer', 2, ORIGIN)!,
    `${ORIGIN}/api/oembed`,
  );

  // Two og:titles and the crawler keeps the first one — the shell's. Every
  // game would unfurl as the generic arcade card.
  it('leaves exactly one of each tag it owns', () => {
    // Anchored on the closing quote: `og:image` is a prefix of
    // `og:image:width`, and a loose match would count those too.
    for (const tag of ['og:title', 'og:image', 'og:description']) {
      expect(injected.match(new RegExp(`property="${tag}"`, 'g'))).toHaveLength(1);
    }
    expect(injected.match(/name="twitter:card"/g)).toHaveLength(1);
    expect(injected.match(/name="description"/g)).toHaveLength(1);
    expect(injected.match(/rel="canonical"/g)).toHaveLength(1);
  });

  it('replaces the title rather than appending a second one', () => {
    expect(injected.match(/<title>/g)).toHaveLength(1);
    expect(injected).toContain('<title>MMO Snake — built by Reflex Arcade</title>');
  });

  it('keeps the app itself intact', () => {
    expect(injected).toContain('<div id="root"></div>');
  });

  it('strips the defaults on their own too', () => {
    const stripped = stripShareTags(SHELL);
    expect(stripped).not.toContain('og:title');
    expect(stripped).toContain('<title>Reflex Arcade</title>');
  });

  it('describes the game to a search engine as a game', () => {
    // The meta tags are what a chat client draws a card from; this is what
    // says `/g/:id` is a VideoGame with an author, not one more page.
    const block = injected.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(block).not.toBeNull();
    expect(JSON.parse(block![1]!)).toMatchObject({
      '@type': 'VideoGame',
      name: 'MMO Snake — built by Reflex Arcade',
      url: `${ORIGIN}/g/game_1`,
      author: { '@type': 'Person', name: 'Streamer' },
    });
  });

  it('leaves one JSON-LD block when injected over its own output', () => {
    // The dev plugin and the server both inject; injecting twice must be
    // the same document, not two blocks a crawler has to choose between.
    const twice = injectShareTags(
      injected,
      shareCardFor(game(), 'Streamer', 2, ORIGIN)!,
      `${ORIGIN}/api/oembed`,
    );
    expect(twice.match(/application\/ld\+json/g)).toHaveLength(1);
    expect(twice.match(/property="og:title"/g)).toHaveLength(1);
  });

  it('cannot be broken out of by a title that closes the script', () => {
    const hostile = shareCardFor(
      { ...game(), title: '</script><img src=x onerror=alert(1)>' },
      'Streamer',
      0,
      ORIGIN,
    )!;
    const html = injectShareTags(SHELL, hostile, `${ORIGIN}/api/oembed`);
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!;
    expect(block).not.toContain('</script>');
    expect(JSON.parse(block).name).toContain('</script>');
  });
});

describe('oEmbedFor', () => {
  it('embeds a live game as the playable game itself', () => {
    const payload = oEmbedFor(shareCardFor(game(), 'Streamer', 0, ORIGIN)!, ORIGIN);
    expect(payload.type).toBe('rich');
    expect(payload.html).toContain('<iframe src="https://5173-abc.tunnel.runloop.ai"');
    expect(payload.author_name).toBe('Streamer');
  });

  it('falls back to a link when there is nothing to embed', () => {
    const card = shareCardFor(game({ daemonUrl: null }), 'Streamer', 0, ORIGIN)!;
    const payload = oEmbedFor(card, ORIGIN);
    expect(payload.type).toBe('link');
    expect(payload.html).toBeUndefined();
    expect(payload.thumbnail_url).toBe(card.image);
  });

  it('honors maxwidth and keeps 16:9', () => {
    const payload = oEmbedFor(shareCardFor(game(), 'S', 0, ORIGIN)!, ORIGIN, 480);
    expect(payload.width).toBe(480);
    expect(payload.height).toBe(270);
  });
});

describe('originFromRequest', () => {
  it('trusts the forwarded headers a tunnel sets', () => {
    expect(
      originFromRequest({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'arcade.example.com' }),
    ).toBe('https://arcade.example.com');
  });

  it('takes the first value of a forwarded chain', () => {
    expect(
      originFromRequest({ 'x-forwarded-proto': 'https,http', 'x-forwarded-host': 'a.com,b.com' }),
    ).toBe('https://a.com');
  });

  it('stays on http for localhost so dev links are clickable', () => {
    expect(originFromRequest({ host: 'localhost:5674' })).toBe('http://localhost:5674');
  });
});

describe('arcadeCard', () => {
  it('is what a private or unknown link unfurls as', () => {
    expect(arcadeCard(ORIGIN).title).toBe('Reflex Arcade — games built live by agents');
    expect(arcadeCard(ORIGIN).author).toBeNull();
  });
});

describe('isAppRoute', () => {
  it('answers the crawlers that do not ask for HTML', () => {
    // facebookexternalhit sends `Accept: */*`; gating on the header would
    // hand it an un-carded shell.
    expect(isAppRoute('GET', '/g/game_1')).toBe(true);
    expect(isAppRoute('GET', '/')).toBe(true);
    expect(isAppRoute('HEAD', '/g/game_1')).toBe(true);
  });

  it('leaves the API, the proxy, and real files alone', () => {
    for (const path of [
      '/api/games',
      '/reflex/game_1/api/agents/a',
      '/assets/index-abc.js',
      '/favicon.ico',
      '/@vite/client',
      '/src/main.tsx',
    ]) {
      expect(isAppRoute('GET', path)).toBe(false);
    }
  });

  it('ignores the query string when deciding', () => {
    expect(isAppRoute('GET', '/g/game_1?panel=chat')).toBe(true);
    expect(isAppRoute('POST', '/g/game_1')).toBe(false);
  });
});

describe('gameIdFromUrl', () => {
  it('reads our own game URLs', () => {
    expect(gameIdFromUrl(`${ORIGIN}/g/game_1`, ORIGIN)).toBe('game_1');
  });

  it('refuses another host, so we do not render cards for their links', () => {
    expect(gameIdFromUrl('https://evil.example.com/g/game_1', ORIGIN)).toBeNull();
  });

  it('refuses junk and non-game paths', () => {
    expect(gameIdFromUrl('not a url', ORIGIN)).toBeNull();
    expect(gameIdFromUrl(`${ORIGIN}/mine`, ORIGIN)).toBeNull();
    expect(gameIdFromUrl(undefined, ORIGIN)).toBeNull();
  });
});

describe('originFromRequest, untrusted input', () => {
  // The Host header is the caller's to set and it lands in a card a
  // crawler will fetch, so anything but `hostname[:port]` is discarded.
  it('discards a host that is not a plain hostname', () => {
    for (const host of ['evil.com/path', 'user@evil.com', 'a b', 'evil.com"']) {
      expect(originFromRequest({ host })).toBe('http://localhost');
    }
  });

  it('lets ARCADE_PUBLIC_ORIGIN pin the origin outright', () => {
    process.env.ARCADE_PUBLIC_ORIGIN = 'https://pinned.example.com/';
    try {
      expect(originFromRequest({ 'x-forwarded-host': 'evil.example.com' })).toBe(
        'https://pinned.example.com',
      );
    } finally {
      delete process.env.ARCADE_PUBLIC_ORIGIN;
    }
  });
});

describe('sanitizeSvg', () => {
  // Filters are where a few hundred bytes of agent-authored markup turns
  // into seconds of blocking CPU in the arcade's only process.
  it('strips filters, elements and attributes alike', () => {
    const svg = `<svg><defs><filter id="b"><feGaussianBlur stdDeviation="120"/></filter></defs><rect filter="url(#b)"/></svg>`;
    const clean = sanitizeSvg(svg);
    expect(clean).not.toContain('feGaussianBlur');
    expect(clean).not.toContain('filter=');
    expect(clean).toContain('<rect');
  });

  it('tolerates the loose closing tags a regex pass would miss', () => {
    const svg = `<svg><filter id="b"><feTurbulence numOctaves="8"/></filter ><rect/></svg>`;
    expect(sanitizeSvg(svg)).toBe('<svg><rect/></svg>');
  });

  // resvg resolves a non-data href as a path on THIS disk.
  it('strips references to anything on this machine', () => {
    const svg = `<svg><image href="/home/user/.data/secret.png"/><image xlink:href="/etc/x.png"/></svg>`;
    const clean = sanitizeSvg(svg);
    expect(clean).not.toContain('secret.png');
    expect(clean).not.toContain('/etc/x.png');
  });

  it('keeps inline data images, which are the legitimate case', () => {
    const svg = `<svg><image href="data:image/png;base64,AAAA"/></svg>`;
    expect(sanitizeSvg(svg)).toContain('data:image/png;base64,AAAA');
  });

  // The regexes do not have to be airtight because the result is checked:
  // anything still carrying a hazard is refused, not rendered.
  it('refuses a cover whose hazards survive stripping', () => {
    expect(sanitizeSvg('<svg><filter id="unterminated"><feGaussianBlur/></svg>')).toBeNull();
    expect(sanitizeSvg('<svg><image href=/etc/passwd /></svg>')).toBeNull();
    expect(sanitizeSvg('<svg><feTurbulence numOctaves="8"/></svg>')).toBeNull();
  });

  it('passes an ordinary cover through untouched', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    expect(sanitizeSvg(svg)).toBe(svg);
  });
});

describe('shareImageFor', () => {
  const base = { gameId: 'game_1', artVersion: 1, title: 'MMO Snake', author: 'Streamer' };
  const dataUrl = (type: string, body: string) =>
    `data:${type};base64,${Buffer.from(body).toString('base64')}`;

  it('passes a raster cover through untouched', () => {
    const png = Buffer.from('not really a png');
    const image = shareImageFor({
      ...base,
      previewArt: `data:image/png;base64,${png.toString('base64')}`,
    });
    expect(image.contentType).toBe('image/png');
    expect(image.body.equals(png)).toBe(true);
  });

  it('rasterizes an SVG cover', () => {
    const image = shareImageFor({
      ...base,
      gameId: 'game_svg',
      previewArt: dataUrl(
        'image/svg+xml',
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9" fill="#0f0"/></svg>',
      ),
    });
    expect(image.contentType).toBe('image/png');
    expect(image.body.subarray(1, 4).toString()).toBe('PNG');
  });

  it('falls back to the generated card when the cover is unusable', () => {
    const broken = shareImageFor({
      ...base,
      gameId: 'game_broken',
      previewArt: dataUrl('image/svg+xml', 'this is not svg at all'),
    });
    const none = shareImageFor({ ...base, gameId: 'game_none', previewArt: null });
    expect(broken.contentType).toBe('image/png');
    expect(broken.body.byteLength).toBe(none.body.byteLength);
  });

  it('declines to render a cover too big to trust', () => {
    const huge = `<svg xmlns="http://www.w3.org/2000/svg">${'<rect/>'.repeat(100_000)}</svg>`;
    expect(huge.length).toBeGreaterThan(MAX_SVG_BYTES);
    const image = shareImageFor({
      ...base,
      gameId: 'game_huge',
      previewArt: dataUrl('image/svg+xml', huge),
    });
    const none = shareImageFor({ ...base, gameId: 'game_none2', previewArt: null });
    expect(image.body.byteLength).toBe(none.body.byteLength);
  });
});

describe('the real app shell', () => {
  // The fixture above is hand-written; this is the file that actually
  // ships, formatted by Prettier across multiple lines per tag.
  const shell = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

  it('has its defaults stripped cleanly', () => {
    const stripped = stripShareTags(shell);
    for (const owned of ['og:', 'twitter:', 'name="description"', 'theme-color']) {
      expect(stripped).not.toContain(owned);
    }
  });

  it('takes a card without leaving a duplicate behind', () => {
    const injected = injectShareTags(
      shell,
      shareCardFor(game(), 'Streamer', 1, ORIGIN)!,
      `${ORIGIN}/api/oembed`,
    );
    expect(injected.match(/property="og:title"/g)).toHaveLength(1);
    expect(injected.match(/name="twitter:image"/g)).toHaveLength(1);
    expect(injected.match(/<title>/g)).toHaveLength(1);
    // The app must still boot: its script and viewport survive.
    expect(injected).toContain('src="/src/main.tsx"');
    expect(injected).toContain('viewport-fit=cover');
  });
});

describe('generated card art', () => {
  it('wraps a long title and caps the lines', () => {
    const lines = wrapTitle(
      'a very long game title that would run off the side of the card',
      20,
      3,
    );
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.length <= 20)).toBe(true);
  });

  it('keeps a short title on one line', () => {
    expect(wrapTitle('MMO Snake', 22, 3)).toEqual(['MMO Snake']);
  });

  // A word that cannot fit has to be cut, or it runs off the card.
  it('hard-slices a single word longer than the line', () => {
    const lines = wrapTitle('A'.repeat(60), 22, 3);
    expect(lines.every((line) => line.length <= 22)).toBe(true);
    expect(lines.join('').length).toBeLessThanOrEqual(66);
  });

  it('escapes a title into SVG text', () => {
    const svg = fallbackCardSvg('Snake </text><script>alert(1)</script>', 'Streamer');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
