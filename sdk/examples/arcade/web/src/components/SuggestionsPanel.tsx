/**
 * Suggestion queue for one game. Everyone with access can suggest (typed as
 * a bug fix, improvement, or feature request) and heart suggestions; the
 * owner approves or rejects (unless the game auto-approves), optionally
 * with a reason, and can leave a public note on any suggestion — shown on
 * the card and, for queued suggestions, sent to the agent with the
 * dispatch. The agent always works the most-hearted approved suggestion
 * first, so hearts are the audience's steering wheel. Status flows pending
 * -> approved -> working -> done (or back to approved when a turn is
 * interrupted), pushed live over the hub socket; the header banner mirrors
 * the dispatcher: what the agent is doing now and which suggestion is
 * staged next.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronsUp,
  Crown,
  Heart,
  Inbox,
  Lightbulb,
  ListOrdered,
  Loader2,
  MessageSquareText,
  PackageCheck,
  Pencil,
  Rocket,
  StickyNote,
  Wrench,
} from 'lucide-react';
import {
  arcade,
  type Suggestion,
  type SuggestionCategory,
  type SuggestionStatus,
} from '../lib/api.ts';
import { agentChip } from '../lib/agent-status.ts';
import { useArcadeFrames, useArcadeReconnect } from '../lib/socket.tsx';
import { useSession } from '../lib/session.ts';
import { PanelHeader } from './PanelHeader.tsx';
import { Tip } from './Tip.tsx';
import { Popcard } from './Popcard.tsx';
import { UserRef } from './UserRef.tsx';
import { ShareButton } from './ShareButton.tsx';
import { shippedShareText } from '../lib/share.ts';

/**
 * Dispatch order: most hearts first, then oldest approval — the same
 * ordering the server uses to pick the next suggestion.
 */
function queueOrder(suggestions: Suggestion[]): Suggestion[] {
  return suggestions
    .filter((s) => s.status === 'approved')
    .sort(
      (a, b) =>
        b.hearts - a.hearts ||
        (a.approvedAt ?? a.createdAt).localeCompare(b.approvedAt ?? b.createdAt) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function durationBetween(fromIso: string, toIso: string): string {
  const seconds = Math.max(0, (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000);
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function SectionHead({
  icon: Icon,
  label,
  count,
  className,
}: {
  icon: typeof Bug;
  label: string;
  count?: number;
  className: string;
}) {
  return (
    <p
      className={`flex items-center gap-1.5 text-[11px] font-semibold tracking-widest uppercase ${className}`}
    >
      <Icon size={12} aria-hidden /> <span>{label}</span>
      {count !== undefined ? <span className="font-normal opacity-70">{count}</span> : null}
      {/* A rule to the edge: five stacked cards need the sections to read as
          bands, not as five more chips down the left margin. */}
      <span aria-hidden className="ml-1 h-px flex-1 bg-current opacity-20" />
    </p>
  );
}

function AgentBanner({
  agentStatus,
  working,
  task,
  taskKind,
}: {
  agentStatus: string | null;
  working: Suggestion | undefined;
  task: string | null;
  taskKind: 'suggestion' | 'prompt' | null;
}) {
  const agent = agentChip(agentStatus);
  if (!agent) return null;
  const busy = agent.label === 'working' || agent.pulse;
  const activeTask = working?.body ?? (busy ? task : null);
  const text = activeTask
    ? `Working on: ${activeTask}`
    : agent.label === 'idle'
      ? 'Agent idle — the next suggestion is sent automatically.'
      : agent.label === 'asleep'
        ? 'Agent asleep — the next suggestion wakes it.'
        : `Agent ${agent.label}.`;
  const banner = (
    <p
      className={`mt-2 flex items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1.5 text-xs ${agent.className} ${activeTask ? 'cursor-pointer hover:bg-white/10' : ''}`}
    >
      {activeTask && taskKind === 'prompt' && !working ? (
        <MessageSquareText size={13} aria-hidden className="shrink-0" />
      ) : (
        <Bot size={13} aria-hidden className={`shrink-0 ${agent.pulse ? 'animate-pulse' : ''}`} />
      )}
      <span className="line-clamp-2">{text}</span>
    </p>
  );
  if (!activeTask) return banner;
  return (
    <Popcard
      className="block w-full"
      content={
        <div>
          <p className="text-[11px] font-semibold tracking-widest text-zinc-500 uppercase">
            {working ? 'Current suggestion' : 'Prompt from the owner'}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed break-words whitespace-pre-wrap text-zinc-200">
            {activeTask}
          </p>
        </div>
      }
    >
      {banner}
    </Popcard>
  );
}

const STATUS_CHIP: Record<SuggestionStatus, { label: string; className: string }> = {
  pending: { label: 'pending review', className: 'bg-amber-500/15 text-amber-300' },
  approved: { label: 'queued', className: 'bg-sky-500/15 text-sky-300' },
  working: { label: 'agent working', className: 'bg-violet-500/20 text-violet-300 animate-pulse' },
  done: { label: 'shipped', className: 'bg-emerald-500/15 text-emerald-300' },
  rejected: { label: 'rejected', className: 'bg-zinc-500/15 text-zinc-400' },
};

/**
 * The stripe down a card's left edge. Status is the one thing worth
 * scanning a stacked queue for, and a colour bar answers it before any of
 * the chips are read.
 */
const STATUS_ACCENT: Record<SuggestionStatus, string> = {
  pending: 'bg-amber-400/70',
  approved: 'bg-sky-400/70',
  working: 'bg-violet-400',
  done: 'bg-emerald-400/70',
  rejected: 'bg-zinc-600',
};

/** Shared shape for the small round icon actions in a card's footer. */
const ICON_ACTION =
  'flex items-center justify-center rounded-full p-1.5 transition pointer-coarse:min-h-10 pointer-coarse:min-w-10';

const CATEGORY_META: Record<
  SuggestionCategory,
  { label: string; icon: typeof Bug; chip: string; active: string }
> = {
  bug: {
    label: 'Bug fix',
    icon: Bug,
    chip: 'bg-rose-500/15 text-rose-300',
    active: 'border-rose-500/60 bg-rose-500/15 text-rose-200',
  },
  improvement: {
    label: 'Improvement',
    icon: Wrench,
    chip: 'bg-sky-500/15 text-sky-300',
    active: 'border-sky-500/60 bg-sky-500/15 text-sky-200',
  },
  feature: {
    label: 'Feature',
    icon: Rocket,
    chip: 'bg-violet-500/15 text-violet-300',
    active: 'border-violet-500/60 bg-violet-500/15 text-violet-200',
  },
};

function CategoryChip({ category }: { category: SuggestionCategory }) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}
    >
      <Icon size={11} aria-hidden /> {meta.label}
    </span>
  );
}

export function SuggestionsPanel({
  gameId,
  isOwner,
  autoApprove,
  agentStatus = null,
  currentTask = null,
  currentTaskKind = null,
  gameTitle = null,
  shareable = false,
}: {
  gameId: string;
  isOwner: boolean;
  autoApprove: boolean;
  agentStatus?: string | null;
  currentTask?: string | null;
  currentTaskKind?: 'suggestion' | 'prompt' | null;
  /** Title of the game, for the words on a shipped suggestion's share. */
  gameTitle?: string | null;
  /** Whether the game is public; a private game has nothing to share. */
  shareable?: boolean;
}) {
  const { me } = useSession();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [myHearts, setMyHearts] = useState<Set<string>>(new Set());
  // Relative times ("shipped 2m ago", "working for 40s") tick along.
  const [, setClock] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setClock((n) => n + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const working = suggestions.filter((s) => s.status === 'working');
  const queue = queueOrder(suggestions);
  const review = suggestions
    .filter((s) => s.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const shipped = suggestions
    .filter((s) => s.status === 'done')
    .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
  const rejected = suggestions
    .filter((s) => s.status === 'rejected')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Rejected cards are noise by default, but the owner's rejection reasons
  // live on them — so they reveal on demand instead of vanishing.
  const [showRejected, setShowRejected] = useState(false);
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState<SuggestionCategory>('improvement');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Inline owner editor: a rejection reason or a note on one suggestion. */
  const [editor, setEditor] = useState<{
    id: string;
    kind: 'reject' | 'note' | 'edit';
    text: string;
  } | null>(null);

  const load = useCallback(
    (onFailure: () => void) => {
      arcade
        .listSuggestions(gameId)
        .then(({ suggestions }) => {
          setSuggestions(suggestions);
          setMyHearts(new Set(suggestions.filter((s) => s.heartedByMe).map((s) => s.id)));
        })
        .catch(onFailure);
    },
    [gameId],
  );

  useEffect(() => load(() => setSuggestions([])), [load]);

  // Status changes ride on hub frames, which are dropped (never replayed)
  // while the socket is down — so a suggestion dispatched during the gap
  // would sit in "Up next" forever. Re-read the queue on every reconnect,
  // keeping what we have if the refetch itself fails.
  useArcadeReconnect(() => load(() => {}));

  useArcadeFrames((frame) => {
    if (frame.type !== 'suggestion' || frame.suggestion.gameId !== gameId) return;
    setSuggestions((old) => {
      const rest = old.filter((s) => s.id !== frame.suggestion.id);
      return [...rest, frame.suggestion].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  });

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const { suggestion } = await arcade.addSuggestion(gameId, body, category);
      setSuggestions((old) =>
        old.some((s) => s.id === suggestion.id) ? old : [...old, suggestion],
      );
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sending the suggestion failed.');
    } finally {
      setBusy(false);
    }
  };

  const heart = async (id: string) => {
    try {
      const { suggestion, hearted } = await arcade.toggleHeart(gameId, id);
      setSuggestions((old) => old.map((s) => (s.id === suggestion.id ? suggestion : s)));
      setMyHearts((old) => {
        const next = new Set(old);
        if (hearted) next.add(id);
        else next.delete(id);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    }
  };

  const renderCard = (suggestion: Suggestion, queueIndex?: number) => {
    const chip = STATUS_CHIP[suggestion.status];
    const hearted = myHearts.has(suggestion.id);
    const mine = suggestion.authorId === me.id;
    const isShipped = suggestion.status === 'done';
    const openEditor = editor?.id === suggestion.id ? editor : null;
    return (
      <article
        key={suggestion.id}
        className={`relative overflow-hidden rounded-2xl p-3 pl-4 shadow-lg shadow-black/40 backdrop-blur-sm transition-colors ${
          isShipped
            ? 'bg-emerald-500/[0.07]'
            : suggestion.status === 'working'
              ? 'bg-violet-500/[0.1]'
              : 'bg-zinc-900/60 hover:bg-zinc-900/80'
        }`}
      >
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-[3px] ${STATUS_ACCENT[suggestion.status]}`}
        />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {queueIndex === 0 ? (
            <Tip label="Top of the queue — sent to the agent when it goes idle">
              <span className="flex items-center gap-1 rounded-full border border-violet-500/50 px-2 py-0.5 text-[11px] font-medium text-violet-300">
                <ChevronsUp size={11} aria-hidden /> next up
              </span>
            </Tip>
          ) : queueIndex !== undefined ? (
            <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] font-medium text-zinc-500 tabular-nums">
              #{queueIndex + 1}
            </span>
          ) : null}
          <CategoryChip category={suggestion.category} />
          {/* Outlined, not filled: "yours" is a bookmark, and a third solid
              chip on the row competes with the two that carry meaning. */}
          {mine ? (
            <span className="rounded-full border border-fuchsia-500/40 px-2 py-0.5 text-[11px] font-medium text-fuchsia-300/90">
              yours
            </span>
          ) : null}
          {isShipped ? (
            suggestion.completedAt ? (
              <Tip
                label={`From suggestion to shipped in ${durationBetween(suggestion.createdAt, suggestion.completedAt)}`}
                className="ml-auto"
              >
                <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-300">
                  <CheckCircle2 size={12} aria-hidden /> shipped {timeAgo(suggestion.completedAt)}
                </span>
              </Tip>
            ) : (
              <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-emerald-300">
                <CheckCircle2 size={12} aria-hidden /> shipped
              </span>
            )
          ) : suggestion.status === 'working' ? (
            <span
              className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.className}`}
            >
              {chip.label}
              {suggestion.startedAt
                ? ` · ${durationBetween(suggestion.startedAt, new Date().toISOString())}`
                : ''}
            </span>
          ) : suggestion.status === 'pending' || suggestion.status === 'rejected' ? (
            <span
              className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.className}`}
            >
              {chip.label}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-100">{suggestion.body}</p>
        {suggestion.ownerNote ? (
          <p
            aria-label="Note from the owner"
            className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-xs text-amber-100/90"
          >
            <Crown
              size={12}
              strokeWidth={2.5}
              aria-hidden
              className="mt-0.5 shrink-0 text-amber-300"
            />
            <span className="min-w-0 break-words">{suggestion.ownerNote}</span>
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <span className="flex min-w-0 items-center text-xs text-zinc-500">
            <UserRef userId={suggestion.authorId} name={suggestion.authorName} avatarSize={14} />
          </span>
          {suggestion.editedAt ? (
            <Tip label={`Edited ${timeAgo(suggestion.editedAt)}`}>
              <span className="shrink-0 text-[11px] text-zinc-600">edited</span>
            </Tip>
          ) : null}
          <Tip
            label={
              hearted ? 'Remove your heart' : 'Heart it — the agent works the most-hearted first'
            }
            className="ml-auto"
          >
            {/* Hearts are the room's steering wheel, so the heart is the one
                control on the card that always looks like a button. */}
            <button
              type="button"
              aria-label={hearted ? 'Unheart suggestion' : 'Heart suggestion'}
              onClick={() => void heart(suggestion.id)}
              className={`flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums transition pointer-coarse:min-h-10 pointer-coarse:min-w-12 ${
                hearted
                  ? 'border-rose-500/50 bg-rose-500/20 text-rose-300'
                  : 'border-white/10 text-zinc-400 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300'
              }`}
            >
              <Heart size={13} fill={hearted ? 'currentColor' : 'none'} aria-hidden />
              {suggestion.hearts}
            </button>
          </Tip>
          {/* A shipped suggestion is the moment worth posting: someone asked
              for it, an agent built it, and the link plays. Public games
              only — a private one has no card to unfurl. */}
          {isShipped && shareable && gameTitle ? (
            <ShareButton
              url={`${location.origin}/g/${gameId}`}
              title={gameTitle}
              text={shippedShareText(gameTitle, suggestion.body)}
              label="Share what the agent shipped"
            />
          ) : null}
          {isOwner ? (
            <Tip label={suggestion.ownerNote ? 'Edit your note' : 'Leave a note'}>
              <button
                type="button"
                aria-label={suggestion.ownerNote ? 'Edit the owner note' : 'Add owner note'}
                onClick={() => toggleEditor(suggestion, 'note')}
                className={`${ICON_ACTION} ${
                  openEditor?.kind === 'note'
                    ? 'bg-amber-400/20 text-amber-300'
                    : 'text-zinc-500 hover:bg-amber-400/10 hover:text-amber-300'
                }`}
              >
                <StickyNote size={13} aria-hidden />
              </button>
            </Tip>
          ) : null}
          {mine && (suggestion.status === 'pending' || suggestion.status === 'approved') ? (
            <Tip label="Edit your suggestion — until the agent picks it up">
              <button
                type="button"
                aria-label="Edit suggestion"
                onClick={() => toggleEditor(suggestion, 'edit')}
                className={`${ICON_ACTION} ${
                  openEditor?.kind === 'edit'
                    ? 'bg-sky-400/20 text-sky-300'
                    : 'text-zinc-500 hover:bg-sky-400/10 hover:text-sky-300'
                }`}
              >
                <Pencil size={13} aria-hidden />
              </button>
            </Tip>
          ) : null}
        </div>
        {/* The owner's verdict gets a row of its own. Sharing the footer with
            the author, the heart and two icon actions left it as four
            elbowing targets on a phone. */}
        {/* The reject editor carries its own confirm, so the row that opened
            it stands down; a note or an edit is unrelated and leaves it. */}
        {isOwner &&
        openEditor?.kind !== 'reject' &&
        (suggestion.status === 'pending' || suggestion.status === 'approved') ? (
          <div className="mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => toggleEditor(suggestion, 'reject')}
              className="rounded-xl border border-white/10 px-3.5 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300 pointer-coarse:min-h-10 pointer-coarse:px-4"
            >
              Reject
            </button>
            {suggestion.status === 'pending' ? (
              <button
                type="button"
                onClick={() => void approve(suggestion.id)}
                className="rounded-xl bg-emerald-600/90 px-3.5 py-1.5 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-500 pointer-coarse:min-h-10 pointer-coarse:px-4"
              >
                Approve
              </button>
            ) : null}
          </div>
        ) : null}
        {openEditor ? (
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void confirmEditor();
            }}
          >
            <input
              autoFocus
              value={openEditor.text}
              onChange={(e) => setEditor({ ...openEditor, text: e.target.value })}
              placeholder={
                openEditor.kind === 'reject'
                  ? 'Add a reason (optional)'
                  : openEditor.kind === 'edit'
                    ? 'Reword your suggestion'
                    : 'Add a note (empty clears it)'
              }
              maxLength={500}
              className="min-w-0 flex-1 rounded-xl border border-transparent bg-zinc-950/80 px-2.5 py-1.5 text-xs shadow-md shadow-black/30 outline-none focus:border-violet-500"
            />
            <button
              type="submit"
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                openEditor.kind === 'reject'
                  ? 'bg-rose-600/80 hover:bg-rose-500'
                  : 'bg-violet-600 hover:bg-violet-500'
              }`}
            >
              {openEditor.kind === 'reject' ? 'Reject' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditor(null)}
              className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs hover:bg-zinc-800"
            >
              Cancel
            </button>
          </form>
        ) : null}
      </article>
    );
  };

  const approve = async (id: string) => {
    try {
      const { suggestion } = await arcade.approveSuggestion(gameId, id);
      setSuggestions((old) => old.map((s) => (s.id === suggestion.id ? suggestion : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    }
  };

  /**
   * Open (or close) the inline editor. Notes start from the saved note and
   * an edit from the suggestion's current text, so both are a correction
   * rather than a retype.
   */
  const toggleEditor = (suggestion: Suggestion, kind: 'reject' | 'note' | 'edit') => {
    setEditor((old) =>
      old?.id === suggestion.id && old.kind === kind
        ? null
        : {
            id: suggestion.id,
            kind,
            text:
              kind === 'note'
                ? (suggestion.ownerNote ?? '')
                : kind === 'edit'
                  ? suggestion.body
                  : '',
          },
    );
  };

  const confirmEditor = async () => {
    if (!editor) return;
    const text = editor.text.trim();
    if (editor.kind === 'edit' && !text) return;
    try {
      const { suggestion } =
        editor.kind === 'reject'
          ? await arcade.rejectSuggestion(gameId, editor.id, text || undefined)
          : editor.kind === 'edit'
            ? await arcade.editSuggestion(
                gameId,
                editor.id,
                text,
                suggestions.find((s) => s.id === editor.id)?.category ?? 'improvement',
              )
            : await arcade.setSuggestionNote(gameId, editor.id, text);
      setSuggestions((old) => old.map((s) => (s.id === suggestion.id ? suggestion : s)));
      setEditor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PanelHeader
        title="Suggestions"
        icon={<Lightbulb size={15} aria-hidden />}
        right={
          shipped.length > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
              <PackageCheck size={11} aria-hidden /> {shipped.length} shipped
            </span>
          ) : null
        }
      >
        {/* Wraps rather than truncates: an ellipsised half-sentence is the
            one thing worse than no explainer at all. */}
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          {autoApprove
            ? 'Auto-approve is on — most-hearted suggestions go to the agent first.'
            : 'The owner reviews suggestions; the agent works the most-hearted first.'}
        </p>
        <AgentBanner
          agentStatus={agentStatus}
          working={suggestions.find((s) => s.status === 'working')}
          task={currentTask}
          taskKind={currentTaskKind}
        />
      </PanelHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {suggestions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/15 text-violet-300"
            >
              <Lightbulb size={18} />
            </span>
            <p className="text-sm font-medium text-zinc-300">No suggestions yet</p>
            <p className="max-w-[32ch] text-xs leading-relaxed text-zinc-500">
              Tell the agent what the game needs — the room&rsquo;s hearts decide what it builds
              next.
            </p>
          </div>
        ) : (
          <>
            {working.length > 0 ? (
              <section className="space-y-2">
                <SectionHead
                  icon={Loader2}
                  label="In progress"
                  className="text-violet-300 [&_svg]:animate-spin"
                />
                {working.map((s) => renderCard(s))}
              </section>
            ) : null}

            {queue.length > 0 ? (
              <section className="space-y-2">
                <SectionHead
                  icon={ListOrdered}
                  label="Up next"
                  count={queue.length}
                  className="text-sky-300"
                />
                {queue.map((s, i) => renderCard(s, i))}
              </section>
            ) : null}

            {review.length > 0 ? (
              <section className="space-y-2">
                <SectionHead
                  icon={Inbox}
                  label="Needs review"
                  count={review.length}
                  className="text-amber-300"
                />
                {review.map((s) => renderCard(s))}
              </section>
            ) : null}

            {shipped.length > 0 ? (
              <section className="space-y-2">
                <SectionHead
                  icon={CheckCircle2}
                  label="Shipped"
                  count={shipped.length}
                  className="text-emerald-300"
                />
                {shipped.map((s) => renderCard(s))}
              </section>
            ) : null}

            {rejected.length > 0 ? (
              <section className="space-y-2">
                <button
                  type="button"
                  aria-expanded={showRejected}
                  onClick={() => setShowRejected((old) => !old)}
                  className="mx-auto flex w-fit items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-[11px] text-zinc-500 transition hover:border-white/20 hover:text-zinc-300 pointer-coarse:min-h-10"
                >
                  <ChevronDown
                    size={12}
                    aria-hidden
                    className={`transition-transform ${showRejected ? 'rotate-180' : ''}`}
                  />
                  {showRejected
                    ? 'Hide rejected suggestions'
                    : `${rejected.length} rejected suggestion${rejected.length === 1 ? '' : 's'} hidden — show`}
                </button>
                {showRejected ? rejected.map((s) => renderCard(s)) : null}
              </section>
            ) : null}
          </>
        )}
      </div>
      <form
        className="p-1 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error ? <p className="mb-2 text-xs text-rose-400">{error}</p> : null}
        {/* Type and text are one control, so they live in one card — the
            same object the agent chat's composer is. */}
        <div className="rounded-2xl border border-transparent bg-zinc-900/80 p-2 shadow-xl shadow-black/50 backdrop-blur-xl focus-within:border-violet-500">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(Object.keys(CATEGORY_META) as SuggestionCategory[]).map((key) => {
              const meta = CATEGORY_META[key];
              const Icon = meta.icon;
              const active = category === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategory(key)}
                  className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition pointer-coarse:min-h-10 pointer-coarse:px-3 pointer-coarse:text-xs ${
                    active ? meta.active : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'
                  }`}
                >
                  <Icon size={11} aria-hidden /> {meta.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Suggest a feature or fix"
              maxLength={500}
              // text-base on phones: iOS Safari zooms the page when a focused
              // input is under 16px, which strands the composer off-screen.
              className="min-w-0 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-zinc-500 pointer-coarse:py-1 pointer-coarse:text-base"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="shrink-0 rounded-xl bg-violet-600 px-3.5 py-1.5 text-sm font-semibold transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-10"
            >
              Send
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
