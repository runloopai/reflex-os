/**
 * The same helpers `db.test.ts` exercises on PGLite, run against a real
 * Postgres server — the store a hosted arcade actually uses.
 *
 * PGLite is Postgres, but it is not the same client: node-postgres decodes
 * types, binds parameters, and pools connections itself, so "the query works
 * embedded" is not evidence it works deployed. This file is the evidence,
 * and it covers the shapes that could plausibly differ — schema application
 * as one multi-statement script, `returning *`, boolean/int/timestamp
 * round-trips, the guarded status transitions, and the aggregate joins.
 *
 * Opt-in, because it needs a server:
 *
 *   ARCADE_TEST_DATABASE_URL=postgres://postgres@localhost:5432/arcade_test \
 *     npm run test:unit
 *
 * Point it at a throwaway database: it drops and recreates the public schema
 * so each run starts clean.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { ArcadeDb } from '../server/db.ts';

const url = process.env['ARCADE_TEST_DATABASE_URL'];

describe.skipIf(!url)('ArcadeDb on a real Postgres', () => {
  let db: ArcadeDb;
  let ownerId: string;
  let fanId: string;
  let gameId: string;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query('drop schema public cascade; create schema public;');
    await admin.end();

    db = await ArcadeDb.open({ kind: 'postgres', url: url! });
    ownerId = (await db.createUser('Streamer', 'x')).id;
    fanId = (await db.createUser('Fan')).id;
    const key = await db.createReflexKey({
      userId: ownerId,
      name: 'test',
      apiKey: 'rfx_test_not_real',
      org: 'acme',
    });
    gameId = (
      await db.createGame({
        ownerId,
        keyId: key.id,
        title: 'Test game',
        prompt: 'test',
        agentId: 'agent_test',
        agentStreamId: 'stream_test',
        agentType: 'claude-code',
        model: null,
        isPublic: true,
        autoApprove: true,
      })
    ).id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it('applies the schema and answers a healthcheck ping', async () => {
    await expect(db.ping()).resolves.toBeUndefined();
  });

  it('round-trips a row through node-postgres decoding', async () => {
    const game = await db.gameById(gameId);
    expect(game).toMatchObject({ isPublic: true, autoApprove: true, plays: 0, artVersion: 0 });
    // timestamptz arrives as a Date from node-postgres and a string from
    // PGLite; the row shape is ISO text either way.
    expect(game?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('serves the public shelf with the owner joined in', async () => {
    const shelf = await db.listedGamesFor(null);
    expect(shelf).toHaveLength(1);
    expect(shelf[0]?.ownerName).toBe('Streamer');
  });

  it('counts hearts and orders the dispatch queue by them', async () => {
    const first = await db.createSuggestion({
      gameId,
      authorId: fanId,
      body: 'first',
      category: 'improvement',
      status: 'approved',
    });
    const second = await db.createSuggestion({
      gameId,
      authorId: fanId,
      body: 'second',
      category: 'feature',
      status: 'approved',
    });
    expect(await db.toggleHeart(second.id, ownerId)).toBe(true);

    const next = await db.nextApprovedSuggestion(gameId);
    expect(next?.id).toBe(second.id);
    expect(next?.hearts).toBe(1);
    expect((await db.suggestionsForGame(gameId, ownerId)).map((s) => s.heartedByMe)).toEqual([
      false,
      true,
    ]);

    // The guarded transition: only from the statuses named.
    expect(await db.setSuggestionStatus(first.id, 'working', ['approved'])).toMatchObject({
      status: 'working',
    });
    expect(await db.setSuggestionStatus(first.id, 'working', ['approved'])).toBeNull();
    expect(await db.countSuggestionDispatch(first.id)).toBe(1);

    await db.setSuggestionStatus(first.id, 'done');
    expect(await db.shippedCounts([gameId])).toEqual({ [gameId]: 1 });
  });

  it('stores art and chat, then deletes a game and its children', async () => {
    const art = await db.setGameArt(gameId, { iconArt: 'data:image/svg+xml,<svg/>' });
    expect(art).toMatchObject({ artVersion: 1, iconArt: 'data:image/svg+xml,<svg/>' });

    await db.createChatMessage(gameId, fanId, 'hello');
    expect((await db.recentChatMessages(gameId)).map((m) => m.body)).toEqual(['hello']);

    await db.deleteGame(gameId);
    expect(await db.gameById(gameId)).toBeNull();
    expect(await db.suggestionsForGame(gameId)).toEqual([]);
    expect(await db.recentChatMessages(gameId)).toEqual([]);
  });

  it('reports where players joined from', async () => {
    expect(await db.joinsBySource()).toEqual([{ source: 'x', joins: 1 }]);
  });
});
