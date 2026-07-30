/**
 * Owner-only settings for one game: visibility, suggestion queue behavior,
 * and the danger zone. Deleting stops the agent (best-effort), removes the
 * game with its suggestions and chat, and tells every client live.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Globe, Trash2, Zap } from 'lucide-react';
import { arcade, gameArtUrl, type Game } from '../lib/api.ts';

function SettingRow({
  icon: Icon,
  title,
  body,
  checked,
  onChange,
}: {
  icon: typeof Globe;
  title: string;
  body: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-white/10 bg-zinc-900/50 p-5 transition-colors hover:border-white/20">
      <span className="flex min-w-0 gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/25 text-violet-300">
          <Icon size={16} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold">{title}</span>
          <span className="mt-0.5 block text-sm text-zinc-500">{body}</span>
        </span>
      </span>
      {/* Switch: a styled checkbox, no library. */}
      <span className="relative mt-1 inline-flex shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="h-6 w-10 rounded-full bg-zinc-700 transition-colors peer-checked:bg-violet-600" />
        <span className="absolute top-1 left-1 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

function DeleteModal({
  game,
  onClose,
  onDeleted,
}: {
  game: Game;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destroy = async () => {
    setBusy(true);
    setError(null);
    try {
      await arcade.deleteGame(game.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deleting failed.');
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
        aria-label={`Delete ${game.title}`}
        className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-zinc-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold">Delete “{game.title}”?</h2>
        <p className="mt-2 text-sm text-zinc-400">
          This ends the stream for good: the agent is shut down and its devbox reclaimed, and the
          game, its suggestion queue, and its chat history are removed for everyone. There is no
          undo.
        </p>
        {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
          >
            Keep the game
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void destroy()}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold hover:bg-rose-500 disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete game'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function GameSettings() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    arcade
      .getGame(gameId)
      .then(({ game, role }) => {
        if (role !== 'owner') {
          navigate(`/g/${gameId}`, { replace: true });
          return;
        }
        setGame(game);
      })
      .catch(() => setError('Could not load this game.'));
  }, [gameId, navigate]);

  if (error) return <main className="flex-1 p-8 text-sm text-zinc-500">{error}</main>;
  if (!game || !gameId) {
    return <main className="flex-1 p-8 text-sm text-zinc-500">Loading settings...</main>;
  }

  const patch = (change: { isPublic?: boolean; autoApprove?: boolean }) => {
    void arcade.patchGame(gameId, change).then(({ game }) => setGame(game));
  };
  const icon = gameArtUrl(game, 'icon');

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <Link
        to={`/g/${gameId}`}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200"
      >
        <ArrowLeft size={14} aria-hidden /> Back to the stream
      </Link>
      <div className="mt-4 flex items-center gap-3">
        {icon ? <img src={icon} alt="" className="h-9 w-9 rounded-lg object-cover" /> : null}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{game.title}</h1>
          <p className="text-sm text-zinc-500">Game settings</p>
        </div>
      </div>

      <section className="mt-8 space-y-3">
        <SettingRow
          icon={Globe}
          title="Public"
          body="Anyone can watch the stream, chat, and file suggestions. Off means only you can see it."
          checked={game.isPublic}
          onChange={(next) => patch({ isPublic: next })}
        />
        <SettingRow
          icon={Zap}
          title="Auto-approve suggestions"
          body="Skip the review queue: every suggestion goes straight to the agent, most-hearted first."
          checked={game.autoApprove}
          onChange={(next) => patch({ autoApprove: next })}
        />
      </section>

      <section className="mt-10 rounded-2xl border border-rose-500/25 bg-rose-500/[0.04] p-5">
        <h2 className="flex items-center gap-2 font-semibold text-rose-300">
          <Trash2 size={15} aria-hidden /> Danger zone
        </h2>
        <p className="mt-1.5 text-sm text-zinc-500">
          Deleting stops the agent and removes the game, its suggestions, and its chat — for
          everyone, permanently.
        </p>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 rounded-lg border border-rose-500/50 px-4 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-500/10"
        >
          Delete game
        </button>
      </section>

      {confirming ? (
        <DeleteModal
          game={game}
          onClose={() => setConfirming(false)}
          onDeleted={() => navigate('/mine')}
        />
      ) : null}
    </main>
  );
}
