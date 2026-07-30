/**
 * The merge rules behind the timeline view: the agent's stream says what
 * was actually sent and when, the arcade's suggestion rows say who asked
 * and what became of it, and the two have to line up.
 */
import { describe, expect, it } from 'vitest';
import { buildGameTimeline, type TimelineEvent } from '../web/src/lib/game-timeline.ts';
import { makeSuggestion } from './fixtures.ts';

const base = {
  gamePrompt: 'Build a neon snake game',
  gameCreatedAt: '2026-07-20T10:00:00.000Z',
  ownerName: 'Alex',
  ownerId: 'user_owner',
};

/** The prompt shape `suggestionPrompt` builds on the server. */
function dispatchPrompt(author: string, body: string, note?: string): string {
  return [
    `Player suggestion from ${author} (top of the room's queue):`,
    '',
    body,
    ...(note ? ['', `Note from the game owner: ${note}`] : []),
    '',
    'Implement this suggestion now, then verify it before ending your turn:',
  ].join('\n');
}

const userEvent = (at: number, message: string): TimelineEvent => ({
  type: 'message',
  timestamp: at,
  origin: 'USER_EVENT',
  payload: { message },
});

describe('buildGameTimeline', () => {
  it('reads the first thing sent as the opening ask, the rest as owner prompts', () => {
    const entries = buildGameTimeline({
      ...base,
      suggestions: [],
      events: [userEvent(1_000, 'Build a neon snake game'), userEvent(2_000, 'Make it faster')],
    });
    expect(entries.map((e) => [e.kind, e.text])).toEqual([
      ['ask', 'Build a neon snake game'],
      ['owner', 'Make it faster'],
    ]);
    expect(entries[0]?.authorName).toBe('Alex');
  });

  it('shows the owner’s brief as the ask, not the launch prompt built around it', () => {
    // What reaches the agent is the brief wrapped in scaffold instructions,
    // the art contract, and Vite flags — machine detail, not the ask.
    const launchPrompt = [
      'Build a small browser game called "Neon Snake".',
      '',
      'Game idea: Build a neon snake game',
      '',
      'Set up the project, get the dev-server daemon registered...',
    ].join('\n');
    const entries = buildGameTimeline({
      ...base,
      suggestions: [],
      events: [userEvent(1_000, launchPrompt), userEvent(2_000, 'Make it faster')],
    });
    expect(entries[0]).toMatchObject({
      kind: 'ask',
      text: 'Build a neon snake game',
      at: 1_000,
    });
    // Later prompts are shown verbatim — they are what the owner typed.
    expect(entries[1]?.text).toBe('Make it faster');
  });

  it('recognises a dispatched suggestion and joins it to its row', () => {
    const row = makeSuggestion({
      id: 'sug_1',
      body: 'add powerups',
      authorName: 'Fan',
      authorId: 'user_fan',
      status: 'done',
      hearts: 3,
    });
    const entries = buildGameTimeline({
      ...base,
      suggestions: [row],
      events: [
        userEvent(1_000, 'Build a neon snake game'),
        userEvent(2_000, dispatchPrompt('Fan', 'add powerups')),
      ],
    });
    const suggestion = entries.find((e) => e.kind === 'suggestion');
    // The prompt gives the text and the time; the row gives everything the
    // stream cannot know.
    expect(suggestion).toMatchObject({
      text: 'add powerups',
      authorId: 'user_fan',
      status: 'done',
      hearts: 3,
      dispatched: true,
      at: 2_000,
    });
    // Joined, not duplicated: the row must not also appear as "not sent".
    expect(entries.filter((e) => e.kind === 'suggestion')).toHaveLength(1);
  });

  it('still shows a dispatch whose row is gone, using the prompt itself', () => {
    const entries = buildGameTimeline({
      ...base,
      suggestions: [],
      events: [userEvent(2_000, dispatchPrompt('Ghost', 'add a boss', 'keep it short'))],
    });
    expect(entries[0]).toMatchObject({
      kind: 'suggestion',
      text: 'add a boss',
      authorName: 'Ghost',
      ownerNote: 'keep it short',
      dispatched: true,
    });
  });

  it('includes suggestions the agent never received, marked as such', () => {
    const queued = makeSuggestion({
      id: 'sug_2',
      body: 'add sound',
      status: 'approved',
      createdAt: '2026-07-20T10:05:00.000Z',
    });
    const entries = buildGameTimeline({ ...base, suggestions: [queued], events: [] });
    expect(entries.find((e) => e.id === 'sug_2')).toMatchObject({
      kind: 'suggestion',
      dispatched: false,
      status: 'approved',
    });
  });

  it('keeps the brief when the stream has nothing yet', () => {
    // A devbox that never woke, or an agent still starting: the arcade
    // stored the brief at launch, so the story is not empty.
    const entries = buildGameTimeline({ ...base, suggestions: [], events: [] });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'ask', text: 'Build a neon snake game' });
  });

  it('files the watcher’s host-fix nudge as housekeeping, not an owner prompt', () => {
    const nudge = 'Hosting problem — players currently see an error instead of your game.\nFix it.';
    const entries = buildGameTimeline({
      ...base,
      suggestions: [],
      events: [userEvent(1_000, 'Build a neon snake game'), userEvent(2_000, nudge)],
    });
    expect(entries.map((e) => e.kind)).toEqual(['ask', 'housekeeping']);
  });

  it('marks shipped turns and orders everything by time', () => {
    const entries = buildGameTimeline({
      ...base,
      suggestions: [],
      events: [
        userEvent(3_000, 'Make it faster'),
        { type: 'turn.completed', timestamp: 4_000, payload: { turn: 2 } },
        userEvent(1_000, 'Build a neon snake game'),
        { type: 'turn.completed', timestamp: 2_000, payload: { turn: 1 } },
      ],
    });
    expect(entries.map((e) => [e.kind, e.at])).toEqual([
      ['ask', 1_000],
      ['shipped', 2_000],
      ['owner', 3_000],
      ['shipped', 4_000],
    ]);
    expect(entries[3]?.turn).toBe(2);
  });

  it('reads a native Codex stream: turn/start prompts and turn/completed ships', () => {
    // Codex games stream JSON-RPC frames instead of flat `message` events —
    // the prompt text lives under `params.input`, so a timeline that only
    // knew the flat shape showed a Codex game as empty.
    const codexPrompt = (at: number, text: string): TimelineEvent => ({
      type: 'turn/start',
      timestamp: at,
      origin: 'USER_EVENT',
      payload: {
        jsonrpc: '2.0',
        method: 'turn/start',
        params: { input: [{ type: 'text', text }] },
      },
    });
    const entries = buildGameTimeline({
      ...base,
      suggestions: [],
      events: [
        codexPrompt(1_000, 'Build a neon snake game'),
        {
          type: 'item/agentMessage/delta',
          timestamp: 1_500,
          payload: { method: 'item/agentMessage/delta', params: { itemId: 'm1', delta: 'On it' } },
        },
        {
          type: 'turn/completed',
          timestamp: 2_000,
          payload: { method: 'turn/completed', params: { turn: { status: 'completed' } } },
        },
        codexPrompt(3_000, 'Make it faster'),
      ],
    });
    expect(entries.map((e) => [e.kind, e.at])).toEqual([
      ['ask', 1_000],
      ['shipped', 2_000],
      ['owner', 3_000],
    ]);
  });

  it('ignores agent chatter — the timeline is what humans asked for', () => {
    const entries = buildGameTimeline({
      ...base,
      suggestions: [],
      events: [
        userEvent(1_000, 'Build a neon snake game'),
        { type: 'assistant', timestamp: 1_500, payload: { message: 'On it!' } },
        { type: 'tool_call', timestamp: 1_600, payload: { name: 'Write' } },
      ],
    });
    expect(entries.map((e) => e.kind)).toEqual(['ask']);
  });
});
