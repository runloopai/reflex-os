/**
 * Live games list: fetched once, then kept fresh by `game` frames (status,
 * plays, visibility) and `viewers` frames from the hub.
 */
import { useEffect, useState } from 'react';
import { arcade, type Game } from './api.ts';
import { useArcadeFrames } from './socket.tsx';

/** Every sort the shelves offer, and the source of truth for URL parsing. */
export const GAME_SORTS = ['newest', 'plays-desc', 'plays-asc'] as const;

export type GameSort = (typeof GAME_SORTS)[number];

export function sortGames(games: Game[], sort: GameSort): Game[] {
  const sorted = [...games];
  switch (sort) {
    case 'plays-desc':
      sorted.sort((a, b) => b.plays - a.plays);
      break;
    case 'plays-asc':
      sorted.sort((a, b) => a.plays - b.plays);
      break;
    default:
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return sorted;
}

export function useGames(): Game[] | null {
  const [games, setGames] = useState<Game[] | null>(null);

  useEffect(() => {
    arcade
      .listGames()
      .then(({ games }) => setGames(games))
      .catch(() => setGames([]));
  }, []);

  useArcadeFrames((frame) => {
    if (frame.type === 'game') {
      setGames((old) => {
        if (!old) return old;
        const prev = old.find((g) => g.id === frame.game.id);
        const rest = old.filter((g) => g.id !== frame.game.id);
        // Live frames carry shippedCount: null — keep the fetched value.
        const merged = {
          ...frame.game,
          shippedCount: frame.game.shippedCount ?? prev?.shippedCount ?? null,
        };
        return [...rest, merged];
      });
    }
    if (frame.type === 'game.removed') {
      setGames((old) => (old ? old.filter((g) => g.id !== frame.gameId) : old));
    }
    if (frame.type === 'viewers') {
      setGames((old) =>
        old ? old.map((g) => (g.id === frame.gameId ? { ...g, viewers: frame.count } : g)) : old,
      );
    }
  });

  return games;
}
