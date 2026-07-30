/**
 * Edit your player profile: display name, a short bio (shown in chat hover
 * cards), an avatar image (stored as a small data URL), and your player
 * key — the localStorage token that IS the account, copyable from here to
 * sign in on another browser.
 */
import { useRef, useState } from 'react';
import { Check, Copy, KeyRound, X } from 'lucide-react';
import { arcade, getToken } from '../lib/api.ts';
import { useSession } from '../lib/session.ts';
import { Avatar } from './Avatar.tsx';

const AVATAR_LIMIT_BYTES = 64 * 1024;

function maskToken(token: string): string {
  return token.length > 12 ? `${token.slice(0, 8)}…${token.slice(-4)}` : token;
}

function PlayerKeyRow() {
  const [copied, setCopied] = useState(false);
  const token = getToken();
  if (!token) return null;
  return (
    <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <KeyRound size={13} aria-hidden className="text-violet-400" /> Player key
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-zinc-900 px-2 py-1.5 text-xs text-zinc-400">
          {maskToken(token)}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(token).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800"
        >
          {copied ? (
            <>
              <Check size={12} aria-hidden className="text-emerald-400" /> Copied
            </>
          ) : (
            <>
              <Copy size={12} aria-hidden /> Copy
            </>
          )}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-600">
        This key is the only way into your account — paste it on the sign-in screen to play from
        another browser, and keep it to yourself.
      </p>
    </div>
  );
}

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { me, refresh } = useSession();
  const [name, setName] = useState(me.name);
  const [bio, setBio] = useState(me.bio);
  const [avatar, setAvatar] = useState(me.avatar);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pickAvatar = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Avatars must be an image.');
      return;
    }
    if (file.size > AVATAR_LIMIT_BYTES) {
      setError('Keep the avatar under 64KB (a small square image works best).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatar(String(reader.result));
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await arcade.updateProfile({ name: name.trim(), bio: bio.trim(), avatar });
      await refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving failed.');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Edit profile"
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Your profile</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Your avatar and bio show up next to your messages in game chat.
        </p>

        <div className="mt-5 flex items-center gap-4">
          <Avatar userId={me.id} name={name || me.name} avatar={avatar} size={56} />
          <div className="flex flex-col gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                pickAvatar(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800"
            >
              Upload avatar
            </button>
            {avatar ? (
              <button
                type="button"
                onClick={() => setAvatar('')}
                className="text-left text-xs text-zinc-500 hover:text-zinc-300"
              >
                Remove avatar
              </button>
            ) : null}
          </div>
        </div>

        <label className="mt-5 block text-sm font-medium">
          Name
          {/* autoFocus also pulls focus off the avatar trigger, whose
              focus-within tooltip would otherwise stay pinned open. */}
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500"
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Bio
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={200}
            rows={3}
            placeholder="Tell the arcade who you are"
            className="mt-1 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500"
          />
        </label>
        <p className="mt-1 text-right text-[11px] text-zinc-600">{bio.length}/200</p>

        <PlayerKeyRow />

        {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void save()}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold hover:bg-violet-500 disabled:opacity-50"
          >
            {busy ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </div>
    </div>
  );
}
