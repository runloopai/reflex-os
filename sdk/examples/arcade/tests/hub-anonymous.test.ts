/**
 * Hub fan-out to signed-out browsers. The landing page connects to
 * `/api/ws` without a token so its shelf stays live, which makes "a client
 * with no user id never receives an owner-only frame" a privacy rule, not
 * an implementation detail — private games and their rooms must stay dark.
 */
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { EventHub, publicGame } from '../server/events.ts';
import type { ChatMessageRow, GameRow, SuggestionRow } from '../server/db.ts';

/** Minimal stand-in for a ws socket: records what the hub sends it. */
function fakeSocket() {
  const sent: Record<string, unknown>[] = [];
  const socket = {
    OPEN: 1,
    readyState: 1,
    send: (raw: string) => sent.push(JSON.parse(raw) as Record<string, unknown>),
    on: () => socket,
  };
  return { sent, socket: socket as unknown as WebSocket };
}

const OWNER_ID = 'user_owner';

function game(isPublic: boolean): GameRow {
  return {
    id: isPublic ? 'game_public' : 'game_private',
    ownerId: OWNER_ID,
    keyId: 'key_1',
    title: isPublic ? 'Public game' : 'Private game',
    prompt: 'test',
    agentId: 'agent_1',
    agentStreamId: 'stream_1',
    agentType: 'claude-code',
    model: null,
    status: 'live',
    agentStatus: 'idle',
    isPublic,
    autoApprove: false,
    daemonUrl: null,
    daemonName: null,
    currentTask: null,
    currentTaskKind: null,
    plays: 0,
    previewArt: null,
    previewAnimArt: null,
    iconArt: null,
    artVersion: 0,
    createdAt: new Date(0).toISOString(),
  } as GameRow;
}

function types(frames: Record<string, unknown>[]) {
  return frames.map((frame) => frame.type);
}

describe('EventHub with a signed-out client', () => {
  it('sends public game frames to everyone', () => {
    const hub = new EventHub();
    const anon = fakeSocket();
    hub.add(anon.socket, null);
    hub.gameChanged(publicGame(game(true), 'Streamer'));
    expect(types(anon.sent)).toEqual(['game']);
  });

  it('withholds private game frames', () => {
    const hub = new EventHub();
    const anon = fakeSocket();
    const owner = fakeSocket();
    hub.add(anon.socket, null);
    hub.add(owner.socket, OWNER_ID);
    hub.gameChanged(publicGame(game(false), 'Streamer'));
    expect(types(anon.sent)).toEqual([]);
    expect(types(owner.sent)).toEqual(['game']);
  });

  it('sends chat, suggestions, and viewer counts for a public game', () => {
    const hub = new EventHub();
    const anon = fakeSocket();
    hub.add(anon.socket, null);
    const open = game(true);
    hub.chatMessage({ id: 'msg_1', gameId: open.id } as ChatMessageRow, open);
    hub.suggestionChanged({ id: 'sug_1', gameId: open.id } as SuggestionRow, open);
    hub.broadcastViewers(open);
    expect(types(anon.sent)).toEqual(['chat.message', 'suggestion', 'viewers']);
  });

  // The positive case above is what keeps this one honest: making these
  // frames owner-only across the board would pass here and fail there.
  it('withholds chat and suggestions from a private game', () => {
    const hub = new EventHub();
    const anon = fakeSocket();
    hub.add(anon.socket, null);
    const priv = game(false);
    hub.chatMessage({ id: 'msg_1', gameId: priv.id } as ChatMessageRow, priv);
    hub.suggestionChanged({ id: 'sug_1', gameId: priv.id } as SuggestionRow, priv);
    hub.broadcastViewers(priv);
    expect(types(anon.sent)).toEqual([]);
  });

  it('still delivers removals, which carry only an id', () => {
    const hub = new EventHub();
    const anon = fakeSocket();
    hub.add(anon.socket, null);
    hub.gameRemoved('game_public');
    expect(anon.sent).toEqual([{ type: 'game.removed', gameId: 'game_public' }]);
  });
});
