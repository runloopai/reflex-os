/**
 * The story of a game, in order.
 *
 * Two sources, joined on time. The agent's own event stream is the record
 * of what was actually *sent* to it — the opening brief, every owner
 * prompt, every dispatched suggestion — and the arcade's suggestion rows
 * carry what the stream cannot know: who asked, how many hearts it had,
 * the owner's note, and what became of it. Suggestions that never reached
 * the agent (still queued, or rejected) have no event at all and are
 * placed by their own timestamps.
 *
 * Pure so the merge rules are testable without a browser or a devbox.
 */
import { userEventText } from './reflex/event-utils.ts';
import type { Suggestion, SuggestionStatus } from './api.ts';

/** The dispatch prompt the server builds in `suggestionPrompt`. */
const SUGGESTION_PROMPT_RE =
  /^Player suggestion from (.+?) \(top of the room's queue\):\n\n([\s\S]*?)(?:\n\nNote from the game owner: ([\s\S]*?))?\n\nImplement this suggestion now/;

/** The nudge the watcher sends when a daemon rejects the tunnel host
 * (`hostFixPrompt`). Machine upkeep, not something a person asked for. */
const HOST_FIX_RE = /^Hosting problem — players currently see an error instead of your game\./;

/** The slice of a stream event this module reads. */
export interface TimelineEvent {
  type: string;
  timestamp?: number;
  origin?: string;
  payload?: unknown;
}

export type TimelineEntryKind = 'ask' | 'owner' | 'suggestion' | 'housekeeping' | 'shipped';

export interface TimelineEntry {
  id: string;
  kind: TimelineEntryKind;
  /** Milliseconds since the epoch; entries are sorted by this. */
  at: number;
  /** The text that went to the agent, or the suggestion body. */
  text: string;
  /** Who asked for it: the owner for prompts, the author for suggestions. */
  authorName?: string;
  authorId?: string;
  /** Suggestion-only extras, carried from the arcade's own record. */
  status?: SuggestionStatus;
  hearts?: number;
  ownerNote?: string | null;
  category?: Suggestion['category'];
  /** Whether this suggestion actually reached the agent. */
  dispatched?: boolean;
  /** `shipped` entries: which turn of the agent finished. */
  turn?: number;
}

/** Turn terminals that mean the agent shipped: the dotted and native forms. */
const TURN_COMPLETED_TYPES = new Set(['turn.completed', 'turn/completed']);

/**
 * Merge the agent's stream with the arcade's suggestion rows into one
 * ordered story of the game.
 *
 * The first user event is the opening brief — it is what created the agent
 * — so it is reported as the `ask` even though the stream cannot tell it
 * apart from any other prompt. Dispatched suggestions are recognised by
 * the prompt the server builds for them and joined back to their row by
 * body text, which is what carries the author and hearts; a dispatch whose
 * row has since been deleted still appears, with what the prompt itself
 * says. Everything else a human sent is an owner prompt.
 */
export function buildGameTimeline(input: {
  events: TimelineEvent[];
  suggestions: Suggestion[];
  /** Fallback opening brief when the stream has no user events yet. */
  gamePrompt: string;
  gameCreatedAt: string;
  ownerName: string;
  ownerId: string;
}): TimelineEntry[] {
  const { events, suggestions, gamePrompt, gameCreatedAt, ownerName, ownerId } = input;
  const entries: TimelineEntry[] = [];
  const dispatchedBodies = new Set<string>();
  const byBody = new Map<string, Suggestion>();
  for (const suggestion of suggestions) byBody.set(suggestion.body.trim(), suggestion);

  // Sorted, not as delivered: the opening ask is the EARLIEST thing a human
  // sent, and reconnects replay history in whatever order the stream cache
  // hands it over. Picking by array position made a late prompt the ask.
  // `userEventText` is the chat kit's own extractor: it knows the prompt
  // shape of every dialect Reflex streams — flat `message`, ACP
  // `session/prompt`, native Claude `query`, native Codex `turn/start` and
  // `turn/steer` — so a Codex game gets the same story as a Claude one.
  const userEvents = events
    .map((event, index) => ({ event, index, text: (userEventText(event) ?? '').trim() }))
    .filter(({ text }) => text.length > 0)
    .sort((a, b) => (a.event.timestamp ?? 0) - (b.event.timestamp ?? 0) || a.index - b.index);
  let seenAsk = false;

  for (const [index, { event, text }] of userEvents.entries()) {
    const at = typeof event.timestamp === 'number' ? event.timestamp : 0;
    const match = SUGGESTION_PROMPT_RE.exec(text);
    if (match) {
      const body = (match[2] ?? '').trim();
      const row = byBody.get(body);
      if (row) dispatchedBodies.add(body);
      entries.push({
        id: `dispatch-${index}`,
        kind: 'suggestion',
        at,
        text: body,
        authorName: row?.authorName ?? match[1],
        ...(row ? { authorId: row.authorId } : {}),
        ...(row ? { status: row.status, hearts: row.hearts, category: row.category } : {}),
        ownerNote: row?.ownerNote ?? match[3] ?? null,
        dispatched: true,
      });
      continue;
    }
    if (HOST_FIX_RE.test(text)) {
      entries.push({ id: `fix-${index}`, kind: 'housekeeping', at, text });
      continue;
    }
    // The opening brief is simply the first thing anyone sent. What went to
    // the agent was the launch prompt the server wraps around it — scaffold
    // instructions, art contract, Vite flags — which is machine detail, not
    // the ask. Show what the owner actually typed, kept by the arcade, and
    // keep the stream's timestamp for when it was sent.
    const kind: TimelineEntryKind = seenAsk ? 'owner' : 'ask';
    const brief = gamePrompt.trim();
    seenAsk = true;
    entries.push({
      id: `prompt-${index}`,
      kind,
      at,
      text: kind === 'ask' && brief ? brief : text,
      authorName: ownerName,
      authorId: ownerId,
    });
  }

  // No stream yet (a devbox that never woke, an agent still starting): the
  // brief still belongs on the timeline — the arcade stored it at launch.
  if (!seenAsk && gamePrompt.trim()) {
    entries.push({
      id: 'ask-fallback',
      kind: 'ask',
      at: Date.parse(gameCreatedAt) || 0,
      text: gamePrompt.trim(),
      authorName: ownerName,
      authorId: ownerId,
    });
  }

  // Suggestions the agent never received: still queued, or rejected. They
  // are part of the story too — placed where they were written.
  for (const suggestion of suggestions) {
    if (dispatchedBodies.has(suggestion.body.trim())) continue;
    entries.push({
      id: suggestion.id,
      kind: 'suggestion',
      at: Date.parse(suggestion.createdAt) || 0,
      text: suggestion.body,
      authorName: suggestion.authorName,
      authorId: suggestion.authorId,
      status: suggestion.status,
      hearts: suggestion.hearts,
      ownerNote: suggestion.ownerNote,
      category: suggestion.category,
      dispatched: false,
    });
  }

  for (const [index, event] of events.entries()) {
    if (!TURN_COMPLETED_TYPES.has(event.type)) continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const turn = typeof payload['turn'] === 'number' ? payload['turn'] : undefined;
    entries.push({
      id: `turn-${index}`,
      kind: 'shipped',
      at: typeof event.timestamp === 'number' ? event.timestamp : 0,
      text: '',
      ...(turn === undefined ? {} : { turn }),
    });
  }

  return entries.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
