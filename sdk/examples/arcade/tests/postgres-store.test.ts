/**
 * A driver conformance check: does `ArcadeDb` behave the same on the store a
 * hosted arcade uses as it does on the PGLite one every other suite runs?
 *
 * PGLite is Postgres, but it is not the same client — node-postgres binds
 * parameters, decodes types, and pools connections itself — so this covers
 * exactly what the two clients could disagree about, and leaves the queue
 * semantics to `db.test.ts`, which is their spec:
 *
 *   - the schema applied as one multi-statement script through `exec`
 *   - `returning *` and the row decoding built on it (booleans, `::int`
 *     aggregates, timestamptz, which node-postgres hands back as a `Date`)
 *   - a guarded UPDATE, where the guard values are bound parameters
 *   - the joins and subselects the shelf and suggestion reads are made of
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
import { seedArcade } from './seed.ts';

const url = process.env['ARCADE_TEST_DATABASE_URL'];

describe.skipIf(!url)('ArcadeDb on a real Postgres', () => {
  let db: ArcadeDb;
  let ownerId: string;
  let fan1: string;
  let gameId: string;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query('drop schema public cascade; create schema public;');
    await admin.end();

    // Opening applies SCHEMA — the multi-statement script — through the
    // driver's `exec`, so a failure here is the first thing this file checks.
    db = await ArcadeDb.open({ kind: 'postgres', url: url! });
    ({ ownerId, fan1, gameId } = await seedArcade(db));
  });

  afterAll(async () => {
    await db?.close();
  });

  it('answers a healthcheck ping', async () => {
    await expect(db.ping()).resolves.toBeUndefined();
  });

  it('decodes a row the same way PGLite does', async () => {
    const game = await db.gameById(gameId);
    expect(game).toMatchObject({ isPublic: true, autoApprove: true, plays: 0, artVersion: 0 });
    // node-postgres returns timestamptz as a Date and PGLite as a string;
    // the row shape is ISO text either way.
    expect(game?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('joins the owner onto the public shelf', async () => {
    const shelf = await db.listedGamesFor(null);
    expect(shelf).toHaveLength(1);
    expect(shelf[0]?.ownerName).toBe('Streamer');
  });

  it('counts hearts through its subselects', async () => {
    const suggestion = await db.createSuggestion({
      gameId,
      authorId: fan1,
      body: 'add a boss',
      category: 'feature',
      status: 'approved',
    });
    expect(await db.toggleHeart(suggestion.id, ownerId)).toBe(true);

    const read = await db.suggestionById(suggestion.id);
    expect(read).toMatchObject({ hearts: 1, authorName: 'Fan one' });
    const forOwner = await db.suggestionsForGame(gameId, ownerId);
    expect(forOwner[0]?.heartedByMe).toBe(true);
    expect(await db.shippedCounts([gameId])).toEqual({});
  });

  it('binds the guard values on a guarded transition', async () => {
    const suggestion = await db.createSuggestion({
      gameId,
      authorId: fan1,
      body: 'claim me',
      category: 'bug',
      status: 'approved',
    });
    expect(await db.setSuggestionStatus(suggestion.id, 'working', ['approved'])).toMatchObject({
      status: 'working',
    });
    expect(await db.setSuggestionStatus(suggestion.id, 'working', ['approved'])).toBeNull();
    expect(await db.countSuggestionDispatch(suggestion.id)).toBe(1);
  });

  it('stores art and chat, then deletes a game and its children', async () => {
    const art = await db.setGameArt(gameId, { iconArt: 'data:image/svg+xml,<svg/>' });
    expect(art).toMatchObject({ artVersion: 1, iconArt: 'data:image/svg+xml,<svg/>' });

    await db.createChatMessage(gameId, fan1, 'hello');
    expect((await db.recentChatMessages(gameId)).map((m) => m.body)).toEqual(['hello']);

    await db.deleteGame(gameId);
    expect(await db.gameById(gameId)).toBeNull();
    expect(await db.suggestionsForGame(gameId)).toEqual([]);
    expect(await db.recentChatMessages(gameId)).toEqual([]);
  });
});
