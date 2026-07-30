/**
 * A player's public profile: avatar, name, bio, and their public games.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { arcade, type PublicProfile } from '../lib/api.ts';
import { useGames } from '../lib/useGames.ts';
import { useSession } from '../lib/session.ts';
import { Avatar } from '../components/Avatar.tsx';
import { GameCard } from '../components/GameCard.tsx';

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

  const theirs = (games ?? []).filter(
    (g) => g.ownerId === userId && (g.isPublic || me.id === userId),
  );

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10">
      <div className="flex items-center gap-5">
        <Avatar userId={profile.id} name={profile.name} avatar={profile.avatar} size={72} />
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-extrabold tracking-tight">{profile.name}</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-400">{profile.bio || 'No bio yet.'}</p>
        </div>
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-widest text-zinc-400 uppercase">
          {me.id === userId ? 'Your games' : 'Their games'}
        </h2>
        {games === null ? (
          <p className="mt-4 text-sm text-zinc-500">Loading games...</p>
        ) : theirs.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No public games yet.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {theirs.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
