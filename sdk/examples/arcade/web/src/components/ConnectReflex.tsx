/**
 * "Connect with Reflex": the button, and what it turns into while the player
 * is approving in the other tab.
 *
 * Two sizes, because the same control is doing two jobs. Before the first
 * connection this is the whole point of the screen — nothing else on the
 * form works until it is done — so it is a filled button with the
 * explanation under it. Afterwards it is just "connect another account",
 * which sits next to the accounts already listed and should not shout over
 * them.
 *
 * Purely presentational — the caller runs the flow (see `lib/connect.ts`)
 * and hands the phase down. While waiting we show the same short code
 * Reflex shows, so the player can tell the two pages are about each other,
 * plus a plain link in case the new tab was blocked.
 */
import { ArrowUpRight, Loader2, Plug } from 'lucide-react';
import type { ConnectWaiting } from '../lib/connect.ts';

export type ConnectPhase =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'waiting'; waiting: ConnectWaiting }
  | { phase: 'error'; message: string };

export function ConnectReflex({
  state,
  onConnect,
  onCancel,
  /** `true` once at least one account is connected: quiet, one-line form. */
  compact = false,
}: {
  state: ConnectPhase;
  onConnect: () => void;
  onCancel: () => void;
  compact?: boolean;
}) {
  if (state.phase === 'waiting') {
    return (
      <div
        className="mt-3 rounded-lg border border-violet-600/40 bg-violet-600/10 p-4"
        data-testid="connect-waiting"
      >
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Loader2 size={14} aria-hidden className="animate-spin" />
          Waiting for you to approve in Reflex
        </p>
        <p className="mt-2 text-xs text-zinc-400">
          Reflex should have opened in a new tab. Check that it shows this code, then pick the
          organization your games run in.
        </p>
        <p
          className="mt-3 font-mono text-2xl font-bold tracking-[0.3em] text-violet-300"
          data-testid="connect-code"
        >
          {state.waiting.userCode}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a
            href={state.waiting.approveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-violet-400 hover:text-violet-300"
          >
            Open the approval page
            <ArrowUpRight size={12} aria-hidden />
          </a>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const starting = state.phase === 'starting';
  const error =
    state.phase === 'error' ? (
      <p className="mt-2 text-xs text-rose-400" data-testid="connect-error">
        {state.message}
      </p>
    ) : null;

  if (compact) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={onConnect}
          disabled={starting}
          data-testid="connect-button"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 hover:text-violet-300 disabled:opacity-50"
        >
          {starting ? (
            <Loader2 size={12} aria-hidden className="animate-spin" />
          ) : (
            <Plug size={12} aria-hidden />
          )}
          {starting ? 'Starting...' : 'Connect another account'}
        </button>
        {error}
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onConnect}
        disabled={starting}
        data-testid="connect-button"
        className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold hover:bg-violet-500 disabled:opacity-50"
      >
        {starting ? (
          <Loader2 size={14} aria-hidden className="animate-spin" />
        ) : (
          <Plug size={14} aria-hidden />
        )}
        {starting ? 'Starting...' : 'Connect with Reflex'}
      </button>
      <p className="mt-2 text-xs text-zinc-500">
        Reflex asks you to approve the arcade and pick an organization, then hands back a key of its
        own. The arcade never sees your Reflex password.
      </p>
      {error}
    </div>
  );
}
