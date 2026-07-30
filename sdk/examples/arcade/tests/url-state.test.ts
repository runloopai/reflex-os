/**
 * Which panel you are reading, whether the phone's room sheet is over the
 * game, and how a shelf is sorted are part of where you ARE, so they live in
 * the query string. This covers the two pure halves: a missing, stale, or
 * hand-edited value must degrade to the default rather than render a screen
 * with nothing on it, and a patch must move every param it names at once.
 */
import { describe, expect, it } from 'vitest';
import { applyUrlPatch, parseUrlValue, urlParam } from '../web/src/lib/useUrlState.ts';
import { GAME_SORTS } from '../web/src/lib/useGames.ts';
import { DEFAULT_PANEL, DEFAULT_ROOM, PANEL_KEYS, ROOM_MODES } from '../web/src/lib/panels.ts';

describe('parseUrlValue', () => {
  it('keeps a value the surface knows', () => {
    expect(parseUrlValue('suggestions', PANEL_KEYS, DEFAULT_PANEL)).toBe('suggestions');
  });

  it('falls back when the param is absent', () => {
    expect(parseUrlValue(null, PANEL_KEYS, DEFAULT_PANEL)).toBe('chat');
  });

  it('falls back on a value this surface does not know', () => {
    // A link from a future version, or a typo in a hand-edited URL.
    expect(parseUrlValue('timeline', PANEL_KEYS, DEFAULT_PANEL)).toBe('chat');
    expect(parseUrlValue('', PANEL_KEYS, DEFAULT_PANEL)).toBe('chat');
  });

  it('works for the room sheet and the shelf sorts too', () => {
    expect(parseUrlValue('open', ROOM_MODES, DEFAULT_ROOM)).toBe('open');
    expect(parseUrlValue('ajar', ROOM_MODES, DEFAULT_ROOM)).toBe('closed');
    expect(parseUrlValue('plays-desc', GAME_SORTS, 'newest')).toBe('plays-desc');
    expect(parseUrlValue('by-vibes', GAME_SORTS, 'newest')).toBe('newest');
  });
});

describe('urlParam', () => {
  it('drops the default and keeps everything else', () => {
    expect(urlParam('suggestions', DEFAULT_PANEL)).toBe('suggestions');
    expect(urlParam('chat', DEFAULT_PANEL)).toBeNull();
  });
});

describe('applyUrlPatch', () => {
  it('moves the panel and the room in one write', () => {
    // The phone dock does both at once; as two navigations the second would
    // write on top of the URL the first one just replaced.
    const next = applyUrlPatch(new URLSearchParams(''), { tab: 'suggestions', room: 'open' });
    expect(next.get('tab')).toBe('suggestions');
    expect(next.get('room')).toBe('open');
  });

  it('removes a param set back to its default, so links stay clean', () => {
    const next = applyUrlPatch(new URLSearchParams('tab=agent&room=open'), {
      tab: null,
      room: null,
    });
    expect(next.toString()).toBe('');
  });

  it('leaves params it does not name alone', () => {
    const next = applyUrlPatch(new URLSearchParams('sort=plays-desc'), { room: 'open' });
    expect(next.get('sort')).toBe('plays-desc');
  });
});
