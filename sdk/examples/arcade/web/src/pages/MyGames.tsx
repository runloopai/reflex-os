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
import { SortSelect } from '../components/SortSelect.tsx';
import { EmptyShelf, GameCardSkeletons } from '../components/ShelfStates.tsx';

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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My games</h1>
          <p className="mt-1 text-sm text-zinc-400">Everything you own, public and private.</p>
        </div>
        <SortSelect value={sort} onChange={setSort} />
      </div>

      {games === null ? (
        <GameCardSkeletons count={3} />
      ) : mine.length === 0 ? (
        <EmptyShelf
          icon={<Gamepad2 size={22} aria-hidden />}
          title="No games yet"
          body="Describe a game and a Reflex agent starts building it live — you watch, the room suggests, hearts steer."
          action={
            <Button as={Link} to="/games/new" variant="glow" sparkle className="mt-2">
              Create a game
            </Button>
          }
        />
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
