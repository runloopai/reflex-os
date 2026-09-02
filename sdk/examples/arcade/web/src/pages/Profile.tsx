/**
 * A player's public profile: avatar, name, bio, what they have to show for
 * themselves, and their public games.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Gamepad2 } from 'lucide-react';
import { arcade, type Game, type PublicProfile } from '../lib/api.ts';
import { useGames } from '../lib/useGames.ts';
import { useSession } from '../lib/session.ts';
import { Avatar } from '../components/Avatar.tsx';
import { GameCard } from '../components/GameCard.tsx';
import { EmptyShelf, GameCardSkeletons } from '../components/ShelfStates.tsx';

/**
 * What a player has to show. Counted from the games already on screen, so
 * the numbers can never disagree with the tiles under them — and a game
 * whose `shippedCount` has not arrived yet contributes nothing rather than
 * a zero that later jumps.
 */
function ProfileStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xl font-bold text-zinc-100 tabular-nums">{value}</span>
      <span className="text-[11px] font-medium tracking-widest text-zinc-500 uppercase">
        {label}
      </span>
    </div>
  );
}

export function Profile() {
  const { userId } = useParams<{ userId: string }>();
  const { me } = useSession();
  const games = useGames();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    arcade
      .getProfile(userId)
      .then(({ user }) => setProfile(user))
      .catch(() => setError('This player does not exist.'));
  }, [userId]);

  if (error) {
    return <main className="flex-1 p-8 text-sm text-zinc-500">{error}</main>;
  }
  if (!profile || !userId) {
    return <main className="flex-1 p-8 text-sm text-zinc-500">Loading profile...</main>;
  }

  const isMe = me.id === userId;
  const theirs = (games ?? []).filter((g) => g.ownerId === userId && (g.isPublic || isMe));
  const total = (pick: (game: Game) => number) => theirs.reduce((sum, g) => sum + pick(g), 0);

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10">
      <div className="flex flex-wrap items-center gap-5">
        <Avatar userId={profile.id} name={profile.name} avatar={profile.avatar} size={72} />
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-extrabold tracking-tight">{profile.name}</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-400">{profile.bio || 'No bio yet.'}</p>
        </div>
        {theirs.length > 0 ? (
          <div className="flex gap-8 sm:ml-auto">
            <ProfileStat value={theirs.length} label="games" />
            <ProfileStat value={total((g) => g.shippedCount ?? 0)} label="shipped" />
            <ProfileStat value={total((g) => g.plays)} label="plays" />
          </div>
        ) : null}
      </div>

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-semibold tracking-widest text-zinc-400 uppercase">
          {isMe ? 'Your games' : 'Their games'}
        </h2>
        {games === null ? (
          <GameCardSkeletons count={3} />
        ) : theirs.length === 0 ? (
          <EmptyShelf
            icon={<Gamepad2 size={22} aria-hidden />}
            title="No public games yet"
            body={
              isMe
                ? 'Games you make public show up here for anyone who opens your profile.'
                : 'When this player makes a game public, it appears here.'
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {theirs.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
