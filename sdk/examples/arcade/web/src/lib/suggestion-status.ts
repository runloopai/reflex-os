/**
 * One vocabulary for a suggestion's status, shared by the panel and the
 * timeline.
 *
 * Both views render the same rows, so a suggestion that reads "shipped" in
 * the sidebar must not read "done" on the timeline — the reader has no way
 * to know those are the same word. The colour goes with the label for the
 * same reason.
 */
import type { SuggestionStatus } from './api.ts';

export interface SuggestionStatusMeta {
  /** What a reader is shown. Never the raw enum. */
  label: string;
  /** Chip background + text. */
  className: string;
  /** The stripe down a card's left edge. */
  accent: string;
}

export const SUGGESTION_STATUS: Record<SuggestionStatus, SuggestionStatusMeta> = {
  pending: {
    label: 'pending review',
    className: 'bg-amber-500/15 text-amber-300',
    accent: 'bg-amber-400/70',
  },
  approved: {
    label: 'queued',
    className: 'bg-sky-500/15 text-sky-300',
    accent: 'bg-sky-400/70',
  },
  working: {
    label: 'agent working',
    className: 'bg-violet-500/20 text-violet-300 animate-pulse',
    accent: 'bg-violet-400',
  },
  done: {
    label: 'shipped',
    className: 'bg-emerald-500/15 text-emerald-300',
    accent: 'bg-emerald-400/70',
  },
  rejected: {
    label: 'rejected',
    className: 'bg-zinc-500/15 text-zinc-400',
    accent: 'bg-zinc-600',
  },
};

/**
 * Whether the agent demonstrably received this suggestion, judged from the
 * row alone. The timeline infers dispatch by matching prompt text in the
 * agent's stream, which a sleeping devbox or an expired stream cannot
 * supply — but a row the server moved to `working` or `done` was worked, so
 * "not sent" would be a lie on it.
 */
export function statusProvesDispatch(status: SuggestionStatus): boolean {
  return status === 'working' || status === 'done';
}
