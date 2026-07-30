/**
 * An inline user reference — avatar + name — that opens a profile card on
 * hover/click (portal-positioned, so it works inside chat rows, suggestion
 * cards, game tiles, and headers alike). The card lazy-loads the full
 * profile and links to the user's profile page.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown } from 'lucide-react';
import { arcade, type PublicProfile } from '../lib/api.ts';
import { Avatar } from './Avatar.tsx';
import { Popcard } from './Popcard.tsx';

const profileCache = new Map<string, Promise<PublicProfile>>();

function fetchProfile(userId: string): Promise<PublicProfile> {
  let cached = profileCache.get(userId);
  if (!cached) {
    cached = arcade.getProfile(userId).then(({ user }) => user);
    cached.catch(() => profileCache.delete(userId));
    profileCache.set(userId, cached);
  }
  return cached;
}

export function ProfileCardContent({
  userId,
  fallbackName,
  isOwner,
}: {
  userId: string;
  fallbackName: string;
  isOwner?: boolean;
}) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  useEffect(() => {
    let alive = true;
    fetchProfile(userId).then((user) => {
      if (alive) setProfile(user);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  const name = profile?.name ?? fallbackName;
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <Avatar userId={userId} name={name} avatar={profile?.avatar} size={40} />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-zinc-100">
            {name}
            {isOwner ? <Crown size={12} className="shrink-0 text-amber-300" aria-hidden /> : null}
          </p>
          {isOwner ? <p className="text-[11px] text-amber-300/80">Game owner</p> : null}
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">
        {profile ? profile.bio || 'No bio yet.' : 'Loading…'}
      </p>
      <button
        type="button"
        onClick={() => navigate(`/u/${userId}`)}
        className="mt-3 w-full rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
      >
        View profile
      </button>
    </div>
  );
}

export function UserRef({
  userId,
  name,
  avatar,
  isOwner = false,
  showAvatar = true,
  avatarSize = 16,
  className,
}: {
  userId: string;
  name: string;
  /** Avatar when the caller already has it; the card fetches the rest. */
  avatar?: string;
  /** Adds the crown + "Game owner" line to the card. */
  isOwner?: boolean;
  /** Hide the inline avatar where one is already rendered next door. */
  showAvatar?: boolean;
  avatarSize?: number;
  className?: string;
}) {
  return (
    <Popcard
      className={className}
      content={<ProfileCardContent userId={userId} fallbackName={name} isOwner={isOwner} />}
    >
      <button
        type="button"
        // Negative margin against the padding: the hit area grows to a
        // thumb-friendly height on touch without moving a single pixel of
        // the text it sits inside.
        className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-inherit hover:underline pointer-coarse:-my-2 pointer-coarse:py-2"
      >
        {showAvatar ? (
          <Avatar userId={userId} name={name} avatar={avatar} size={avatarSize} />
        ) : null}
        <span className="truncate">{name}</span>
      </button>
    </Popcard>
  );
}
