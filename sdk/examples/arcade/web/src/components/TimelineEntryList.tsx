/**
 * The rendered story of a game: one card per thing a human asked for, with
 * shipped markers between them. Presentational — {@link buildGameTimeline}
 * decides what the entries are, this decides how they read.
 */
import { Crown, Heart, Lightbulb, PackageCheck, Sparkles, Wrench } from 'lucide-react';
import type { TimelineEntry } from '../lib/game-timeline.ts';
import { SUGGESTION_STATUS, statusProvesDispatch } from '../lib/suggestion-status.ts';
import { UserRef } from './UserRef.tsx';
import { Tip } from './Tip.tsx';

const KIND_META: Record<
  TimelineEntry['kind'],
  { label: string; icon: typeof Crown; dot: string; chip: string }
> = {
  ask: {
    label: 'The ask',
    icon: Sparkles,
    dot: 'bg-violet-400',
    chip: 'bg-violet-500/15 text-violet-300',
  },
  owner: {
    label: 'Owner prompt',
    icon: Crown,
    dot: 'bg-amber-400',
    chip: 'bg-amber-500/15 text-amber-300',
  },
  suggestion: {
    label: 'Suggestion',
    icon: Lightbulb,
    dot: 'bg-sky-400',
    chip: 'bg-sky-500/15 text-sky-300',
  },
  housekeeping: {
    label: 'Automatic fix',
    icon: Wrench,
    dot: 'bg-zinc-600',
    chip: 'bg-zinc-700/40 text-zinc-400',
  },
  shipped: {
    label: 'Shipped',
    icon: PackageCheck,
    dot: 'bg-emerald-400',
    chip: 'bg-emerald-500/15 text-emerald-300',
  },
};

function when(at: number): string {
  if (!at) return '';
  return new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function EntryCard({ entry }: { entry: TimelineEntry }) {
  const meta = KIND_META[entry.kind];
  const Icon = meta.icon;

  // A shipped turn is a punctuation mark between asks, not a card.
  if (entry.kind === 'shipped') {
    return (
      <p className="flex items-center gap-2 py-1 text-xs text-emerald-300/80">
        <PackageCheck size={13} aria-hidden />
        <span>Shipped{entry.turn ? ` — turn ${entry.turn}` : ''}</span>
        <span className="text-zinc-600">{when(entry.at)}</span>
      </p>
    );
  }

  return (
    <article className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4 backdrop-blur-sm">
      <header className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}
        >
          <Icon size={11} aria-hidden /> {meta.label}
        </span>
        {/* `dispatched` is inferred by matching prompt text in the agent's
            stream, which a sleeping devbox cannot supply — so a row the
            server already moved to working/done overrules it. Otherwise a
            shipped suggestion sat here wearing "not sent". */}
        {entry.kind === 'suggestion' &&
        entry.dispatched === false &&
        !(entry.status && statusProvesDispatch(entry.status)) ? (
          <Tip label="Never reached the agent">
            <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-500">
              not sent
            </span>
          </Tip>
        ) : null}
        {/* The panel's words and colours, not the raw enum: the same row
            must not read "shipped" in the sidebar and "done" here. */}
        {entry.status ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SUGGESTION_STATUS[entry.status].className}`}
          >
            {SUGGESTION_STATUS[entry.status].label}
          </span>
        ) : null}
        {typeof entry.hearts === 'number' && entry.hearts > 0 ? (
          <span className="flex items-center gap-1 text-[11px] text-rose-300">
            <Heart size={11} fill="currentColor" aria-hidden />
            {entry.hearts}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-[11px] text-zinc-600">{when(entry.at)}</span>
      </header>
      <p className="mt-2 text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap text-zinc-200">
        {entry.text}
      </p>
      {entry.ownerNote ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-400/10 px-2 py-1.5 text-xs text-amber-100/90">
          <Crown size={11} strokeWidth={2.5} aria-hidden className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{entry.ownerNote}</span>
        </p>
      ) : null}
      {entry.authorName ? (
        <p className="mt-2 text-xs text-zinc-500">
          {entry.authorId ? (
            <UserRef userId={entry.authorId} name={entry.authorName} avatarSize={14} />
          ) : (
            entry.authorName
          )}
        </p>
      ) : null}
    </article>
  );
}

export function TimelineEntryList({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="mt-10 text-sm text-zinc-500">
        Nothing has happened yet — the agent has not been given anything to build.
      </p>
    );
  }
  return (
    <ol className="mt-8 space-y-4 border-l border-white/10 pl-6">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span
            aria-hidden
            className={`absolute top-4 -left-[1.7rem] h-2 w-2 rounded-full ${KIND_META[entry.kind].dot}`}
          />
          <EntryCard entry={entry} />
        </li>
      ))}
    </ol>
  );
}
