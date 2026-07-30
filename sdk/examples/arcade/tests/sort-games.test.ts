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

  it('does not mutate its input', () => {
    const before = games.map((g) => g.id);
    sortGames(games, 'plays-desc');
    expect(games.map((g) => g.id)).toEqual(before);
  });
});
