import type { GameStatus } from '../lib/api.ts';

const STYLES: Record<GameStatus, { label: string; className: string }> = {
  creating: { label: 'building', className: 'bg-amber-500/15 text-amber-300' },
  live: { label: 'live', className: 'bg-emerald-500/15 text-emerald-300' },
  error: { label: 'error', className: 'bg-rose-500/15 text-rose-300' },
  stopped: { label: 'stopped', className: 'bg-zinc-500/15 text-zinc-400' },
};

export function StatusPill({ status }: { status: GameStatus }) {
  const style = STYLES[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
    >
      {status === 'live' ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />
      ) : null}
      {style.label}
    </span>
  );
}
