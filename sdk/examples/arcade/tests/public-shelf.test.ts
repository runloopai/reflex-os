/**
 * The signed-out shelf. The landing page is the arcade's shop window, so
 * `GET /api/games` answers without a token — and this is the spec for what
 * that answer may contain: public games only, never a private one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArcadeDb } from '../server/db.ts';

let db: ArcadeDb;
let ownerId: string;
let strangerId: string;
let publicGameId: string;
let privateGameId: string;

beforeAll(async () => {
  db = await ArcadeDb.open('memory://');
  const owner = await db.createUser('Streamer');
  ownerId = owner.id;
  strangerId = (await db.createUser('Passer by')).id;
  const key = await db.createReflexKey({
    userId: ownerId,
    name: 'test',
    apiKey: 'rfx_test_not_real',
    org: null,
  });
  const game = (isPublic: boolean, title: string) =>
    db.createGame({
      ownerId,
      keyId: key.id,
      title,
      prompt: 'test',
      agentId: `agent_${title}`,
      agentStreamId: `stream_${title}`,
      agentType: 'claude-code',
      model: null,
      isPublic,
      autoApprove: true,
    });
  publicGameId = (await game(true, 'public')).id;
  privateGameId = (await game(false, 'private')).id;
});

afterAll(async () => {
  await db.close();
});

describe('listedGamesFor', () => {
  it('gives a signed-out visitor the public games only', async () => {
    const listed = await db.listedGamesFor(null);
    expect(listed.map(({ game }) => game.id)).toEqual([publicGameId]);
  });

  it('names the owner so tiles read the same signed out', async () => {
    const listed = await db.listedGamesFor(null);
    expect(listed[0]?.ownerName).toBe('Streamer');
  });

  it('still hides a private game from a signed-in stranger', async () => {
    const listed = await db.listedGamesFor(strangerId);
    expect(listed.map(({ game }) => game.id)).toEqual([publicGameId]);
  });

  it('adds the owner their own private game', async () => {
    const listed = await db.listedGamesFor(ownerId);
    expect(listed.map(({ game }) => game.id).sort()).toEqual([publicGameId, privateGameId].sort());
  });
});
