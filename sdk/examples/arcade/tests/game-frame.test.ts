/** The identity the arcade hands a game through its frame URL. */
import { describe, expect, it } from 'vitest';
import { PLAYER_PARAMS, framePlayer, gameFrameUrl } from '../web/src/lib/game-frame.ts';
import type { Me } from '../web/src/lib/api.ts';

function makeMe(overrides: Partial<Me> = {}): Me {
  return {
    id: 'user_1',
    name: 'Alex',
    avatar: '',
    bio: '',
    activeKeyId: null,
    keys: [],
    ...overrides,
  };
}

describe('framePlayer', () => {
  it('gives the game an absolute avatar URL, not the profile data URL', () => {
    const player = framePlayer(
      makeMe({ avatar: 'data:image/png;base64,AAAA' }),
      'https://arcade.test',
      false,
    );
    expect(player?.avatarUrl).toMatch(/^https:\/\/arcade\.test\/api\/users\/user_1\/avatar\?v=/);
  });

  // The URL is immutable-cached, so a new picture has to publish a new one.
  it('changes the avatar URL when the profile changes', () => {
    const before = framePlayer(makeMe(), 'https://arcade.test', false)?.avatarUrl;
    const renamed = framePlayer(
      makeMe({ name: 'Alexandra' }),
      'https://arcade.test',
      false,
    )?.avatarUrl;
    const pictured = framePlayer(
      makeMe({ avatar: 'data:image/png;base64,AAAA' }),
      'https://arcade.test',
      false,
    )?.avatarUrl;
    expect(new Set([before, renamed, pictured]).size).toBe(3);
  });

  it('caps the name at the length the server caps profiles at', () => {
    const player = framePlayer(makeMe({ name: 'x'.repeat(80) }), 'https://arcade.test', false);
    expect(player?.name).toHaveLength(40);
  });

  it('marks the owner apart from everyone else watching', () => {
    expect(framePlayer(makeMe(), 'https://arcade.test', true)?.role).toBe('owner');
    expect(framePlayer(makeMe(), 'https://arcade.test', false)?.role).toBe('player');
  });

  it('has nothing to say about a signed-out visitor', () => {
    expect(framePlayer(null, 'https://arcade.test', false)).toBeNull();
  });
});

describe('gameFrameUrl', () => {
  const player = framePlayer(makeMe(), 'https://arcade.test', false)!;

  it('appends the player to an absolute daemon URL', () => {
    const url = new URL(gameFrameUrl('https://5173-abc.tunnel.runloop.ai/', player));
    expect(url.searchParams.get(PLAYER_PARAMS.id)).toBe('user_1');
    expect(url.searchParams.get(PLAYER_PARAMS.name)).toBe('Alex');
    expect(url.searchParams.get(PLAYER_PARAMS.role)).toBe('player');
    expect(url.searchParams.get(PLAYER_PARAMS.avatar)).toBe(player.avatarUrl);
  });

  it("keeps the game's own query and hash", () => {
    const url = new URL(gameFrameUrl('https://game.test/?level=3#start', player));
    expect(url.searchParams.get('level')).toBe('3');
    expect(url.hash).toBe('#start');
  });

  // The bundled mock serves games from a path on the arcade's own origin;
  // making that absolute would point the iframe at the wrong host.
  it('leaves a relative daemon URL relative', () => {
    const url = gameFrameUrl('/play/game_1', player);
    expect(url.startsWith('/play/game_1?')).toBe(true);
    expect(url).toContain(`${PLAYER_PARAMS.id}=user_1`);
  });

  // Deciding "was this relative?" by whether the sentinel base supplied the
  // origin, rather than by how the string looks, keeps the host on a
  // protocol-relative URL instead of collapsing it to a path.
  it('keeps the host of a protocol-relative daemon URL', () => {
    const url = gameFrameUrl('//5173-abc.tunnel.runloop.ai/play', player);
    expect(url).toContain('5173-abc.tunnel.runloop.ai/play');
    expect(url).toContain(`${PLAYER_PARAMS.role}=player`);
  });

  // A signed-out visitor gets the game's guest path, not blank parameters
  // it would have to tell apart from a real player.
  it('passes the URL through untouched with no player', () => {
    expect(gameFrameUrl('https://game.test/play', null)).toBe('https://game.test/play');
  });

  it('passes through a URL it cannot parse rather than dropping the game', () => {
    expect(gameFrameUrl('http://[not a url', player)).toBe('http://[not a url');
  });
});
