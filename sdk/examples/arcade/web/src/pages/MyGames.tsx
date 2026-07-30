/**
 * My games: everything you own — public or private — with the same live
 * tiles and sorting as the public list.
 */
import { Link } from 'react-router-dom';
import { Button } from 'performative-ui';
import { Gamepad2 } from 'lucide-react';
import { useUrlState } from '../lib/useUrlState.ts';
import { sortGames, useGames, type GameSort, GAME_SORTS } from '../lib/useGames.ts';
import { useSession } from '../lib/session.ts';
import { GameCard } from '../components/GameCard.tsx';

export function MyGames() {
  const { me } = useSession();
  const games = useGames();
  // Sorting is where you are, not a preference: keep it in the URL so a
  // refresh or a shared link opens the same shelf order.
  const [sort, setSort] = useUrlState<GameSort>('sort', GAME_SORTS, 'newest');

  const mine = sortGames(
    (games ?? []).filter((g) => g.ownerId === me.id),
    sort,
  );

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My games</h1>
          <p className="mt-1 text-sm text-zinc-400">Everything you own, public and private.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as GameSort)}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-violet-500"
          >
            <option value="newest">Newest</option>
            <option value="plays-desc">Most played</option>
            <option value="plays-asc">Least played</option>
          </select>
        </label>
      </div>

      {games === null ? (
        <p className="text-sm text-zinc-500">Loading games...</p>
      ) : mine.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/15 bg-zinc-900/30 px-8 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/25 text-violet-300">
            <Gamepad2 size={22} aria-hidden />
          </span>
          <p className="font-semibold">No games yet</p>
          <p className="max-w-sm text-sm text-zinc-500">
            Describe a game and a Reflex agent starts building it live — you watch, the room
            suggests, hearts steer.
          </p>
          <Button as={Link} to="/games/new" variant="glow" sparkle className="mt-2">
            Create a game
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mine.map((game) => (
            <GameCard key={game.id} game={game} showVisibility showSettings />
          ))}
        </div>
      )}
    </main>
  );
}
