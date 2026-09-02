import { describe, expect, it } from 'vitest';
import { sortGames } from '../web/src/lib/useGames.ts';
import { makeGame } from './fixtures.ts';

const games = [
  makeGame({ id: 'a', plays: 5, createdAt: '2026-07-15T00:00:00.000Z' }),
  makeGame({ id: 'b', plays: 20, createdAt: '2026-07-17T00:00:00.000Z' }),
  makeGame({ id: 'c', plays: 0, createdAt: '2026-07-16T00:00:00.000Z' }),
];

describe('sortGames', () => {
  it('defaults to newest first', () => {
    expect(sortGames(games, 'newest').map((g) => g.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by plays descending', () => {
    expect(sortGames(games, 'plays-desc').map((g) => g.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by plays ascending', () => {
    expect(sortGames(games, 'plays-asc').map((g) => g.id)).toEqual(['c', 'a', 'b']);
  });

  // The shelf's whole offer is "something is being built right now", so a
  // live game outranks a newer or more-played finished one under every sort.
  it('puts live games ahead of everything else, under every sort', () => {
    const mixed = [
      makeGame({
        id: 'stopped-new',
        status: 'stopped',
        plays: 99,
        createdAt: '2026-07-20T00:00:00.000Z',
      }),
      makeGame({ id: 'live-old', status: 'live', plays: 1, createdAt: '2026-07-01T00:00:00.000Z' }),
    ];
    for (const sort of ['newest', 'plays-desc', 'plays-asc'] as const) {
      expect(sortGames(mixed, sort)[0]?.id, sort).toBe('live-old');
    }
  });

  it('orders by the chosen sort within the live group', () => {
    const live = [
      makeGame({ id: 'quiet', status: 'live', plays: 2, createdAt: '2026-07-19T00:00:00.000Z' }),
      makeGame({ id: 'busy', status: 'live', plays: 40, createdAt: '2026-07-10T00:00:00.000Z' }),
      makeGame({
        id: 'over',
        status: 'stopped',
        plays: 900,
        createdAt: '2026-07-20T00:00:00.000Z',
      }),
    ];
    expect(sortGames(live, 'plays-desc').map((g) => g.id)).toEqual(['busy', 'quiet', 'over']);
  });

  it('does not mutate its input', () => {
    const before = games.map((g) => g.id);
    sortGames(games, 'plays-desc');
    expect(games.map((g) => g.id)).toEqual(before);
  });
});
