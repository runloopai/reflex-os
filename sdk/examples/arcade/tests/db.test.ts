/**
 * ArcadeDb against an in-memory PGLite. The dispatch-ordering tests are the
 * spec for "the agent works the most-hearted suggestion first".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArcadeDb } from '../server/db.ts';
import { seedArcade } from './seed.ts';

let db: ArcadeDb;
let fan1: string;
let fan2: string;
let gameId: string;

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

async function addApproved(body: string) {
  const suggestion = await db.createSuggestion({
    gameId,
    authorId: fan1,
    body,
    category: 'improvement',
    status: 'approved',
  });
  await tick(); // distinct approved_at timestamps for deterministic FIFO
  return suggestion;
}

beforeAll(async () => {
  db = await ArcadeDb.open({ kind: 'pglite', dataDir: 'memory://' });
  ({ fan1, fan2, gameId } = await seedArcade(db));
});

afterAll(async () => {
  await db.close();
});

describe('suggestion dispatch order', () => {
  it('is FIFO by approval time when hearts are equal', async () => {
    const first = await addApproved('first in');
    await addApproved('second in');
    const next = await db.nextApprovedSuggestion(gameId);
    expect(next?.id).toBe(first.id);
  });

  it('puts the most-hearted suggestion first', async () => {
    const latest = await addApproved('late but loved');
    await db.toggleHeart(latest.id, fan1);
    await db.toggleHeart(latest.id, fan2);
    const next = await db.nextApprovedSuggestion(gameId);
    expect(next?.id).toBe(latest.id);
    expect(next?.hearts).toBe(2);
  });

  it('falls back to FIFO when hearts are removed', async () => {
    const suggestions = await db.suggestionsForGame(gameId);
    const loved = suggestions.find((s) => s.body === 'late but loved')!;
    await db.toggleHeart(loved.id, fan1);
    await db.toggleHeart(loved.id, fan2);
    const next = await db.nextApprovedSuggestion(gameId);
    expect(next?.body).toBe('first in');
  });

  it('ignores pending suggestions', async () => {
    await db.createSuggestion({
      gameId,
      authorId: fan1,
      body: 'not approved yet',
      category: 'bug',
      status: 'pending',
    });
    const next = await db.nextApprovedSuggestion(gameId);
    expect(next?.body).toBe('first in');
  });
});

describe('editSuggestion', () => {
  it('rewrites a suggestion that has not reached the agent', async () => {
    const created = await db.createSuggestion({
      gameId,
      authorId: fan1,
      body: 'add powerups',
      category: 'improvement',
      status: 'pending',
    });
    expect(created.editedAt).toBeNull();

    const edited = await db.editSuggestion(
      created.id,
      { body: 'add powerups that expire', category: 'feature' },
      ['pending', 'approved'],
    );
    expect(edited?.body).toBe('add powerups that expire');
    expect(edited?.category).toBe('feature');
    expect(edited?.editedAt).not.toBeNull();
    // Editing is not approving: the queue position is untouched.
    expect(edited?.status).toBe('pending');
  });

  it('refuses once the suggestion is with the agent', async () => {
    // The dispatcher claims `approved -> working` atomically before it reads
    // the body, so an edit that loses that race must not rewrite text the
    // agent has already been sent.
    const created = await db.createSuggestion({
      gameId,
      authorId: fan1,
      body: 'add a boss',
      category: 'feature',
      status: 'approved',
    });
    const claimed = await db.setSuggestionStatus(created.id, 'working', ['approved']);
    expect(claimed?.status).toBe('working');

    const edited = await db.editSuggestion(
      created.id,
      { body: 'actually, add two bosses', category: 'feature' },
      ['pending', 'approved'],
    );
    expect(edited).toBeNull();
    expect((await db.suggestionById(created.id))?.body).toBe('add a boss');
  });

  it('refuses on finished and rejected suggestions', async () => {
    for (const status of ['done', 'rejected'] as const) {
      const created = await db.createSuggestion({
        gameId,
        authorId: fan1,
        body: `history ${status}`,
        category: 'bug',
        status: 'pending',
      });
      await db.setSuggestionStatus(created.id, status);
      const edited = await db.editSuggestion(created.id, { body: 'rewritten', category: 'bug' }, [
        'pending',
        'approved',
      ]);
      expect(edited).toBeNull();
    }
  });
});

describe('dispatch counter', () => {
  it('counts every send and survives a reopen, until it is reset', async () => {
    // The re-queue safety valve reads this. Held in memory it reset with the
    // watcher, so a suggestion the agent never finished was re-sent from
    // zero on every restart — the same work, over and over.
    const suggestion = await addApproved('add a boss');
    expect(suggestion.dispatches).toBe(0);
    expect(await db.countSuggestionDispatch(suggestion.id)).toBe(1);
    expect(await db.countSuggestionDispatch(suggestion.id)).toBe(2);
    expect((await db.suggestionById(suggestion.id))?.dispatches).toBe(2);
    await db.resetSuggestionDispatches(suggestion.id);
    expect((await db.suggestionById(suggestion.id))?.dispatches).toBe(0);
  });
});

describe('join attribution', () => {
  it('records the shared link a player arrived through, and counts by source', async () => {
    // Without this the utm tags on every shared link are decorative: the
    // arcade could not tell which post actually returned anyone.
    const direct = await db.createUser('Walked in');
    expect(direct.joinedVia).toBeNull();
    await db.createUser('From a post', 'x');
    await db.createUser('Also from a post', 'x');
    await db.createUser('From a skeet', 'bluesky');

    expect(await db.joinsBySource()).toEqual([
      { source: 'x', joins: 2 },
      { source: 'bluesky', joins: 1 },
    ]);
  });
});

describe('hearts', () => {
  it('toggles per user and counts distinct users', async () => {
    const suggestion = await addApproved('heart me');
    expect(await db.toggleHeart(suggestion.id, fan1)).toBe(true);
    expect(await db.toggleHeart(suggestion.id, fan2)).toBe(true);
    expect((await db.suggestionById(suggestion.id))?.hearts).toBe(2);
    expect(await db.toggleHeart(suggestion.id, fan1)).toBe(false);
    expect((await db.suggestionById(suggestion.id))?.hearts).toBe(1);
  });

  it('reports heartedByMe for the asking user only', async () => {
    const suggestion = await addApproved('whose heart');
    await db.toggleHeart(suggestion.id, fan2);
    const forFan2 = await db.suggestionsForGame(gameId, fan2);
    const forFan1 = await db.suggestionsForGame(gameId, fan1);
    expect(forFan2.find((s) => s.id === suggestion.id)?.heartedByMe).toBe(true);
    expect(forFan1.find((s) => s.id === suggestion.id)?.heartedByMe).toBe(false);
  });
});

describe('game art', () => {
  it('stores art and bumps the version each time', async () => {
    const game = await db.gameById(gameId);
    expect(game?.artVersion).toBe(0);
    const one = await db.setGameArt(gameId, { iconArt: 'data:image/svg+xml;base64,AA==' });
    expect(one?.iconArt).toBe('data:image/svg+xml;base64,AA==');
    expect(one?.previewArt).toBeNull();
    expect(one?.artVersion).toBe(1);
    const two = await db.setGameArt(gameId, { previewArt: 'data:image/png;base64,BB==' });
    expect(two?.artVersion).toBe(2);
    expect(two?.iconArt).toBe('data:image/svg+xml;base64,AA==');
  });
});

// A game records the rules version its agent was launched with, so the
// dispatcher can tell which games still owe a catch-up brief.
describe('brief version', () => {
  it('starts at zero when the creator did not say, and can be moved up', async () => {
    const game = await db.gameById(gameId);
    expect(game?.briefVersion).toBe(0);
    const updated = await db.updateGame(gameId, { briefVersion: 2 });
    expect(updated?.briefVersion).toBe(2);
    expect((await db.gameById(gameId))?.briefVersion).toBe(2);
  });
});

describe('owner notes', () => {
  it('stores, edits, and clears the note', async () => {
    const suggestion = await addApproved('note me');
    expect(suggestion.ownerNote).toBeNull();
    const noted = await db.setSuggestionNote(suggestion.id, 'love this one, do it next');
    expect(noted?.ownerNote).toBe('love this one, do it next');
    const cleared = await db.setSuggestionNote(suggestion.id, null);
    expect(cleared?.ownerNote).toBeNull();
  });

  it('keeps the note through status changes (rejection reasons)', async () => {
    const suggestion = await addApproved('cancel me');
    await db.setSuggestionNote(suggestion.id, 'out of scope for this game');
    const rejected = await db.setSuggestionStatus(suggestion.id, 'rejected');
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.ownerNote).toBe('out of scope for this game');
  });
});

describe('categories', () => {
  it('stores the category on the suggestion', async () => {
    const suggestion = await db.createSuggestion({
      gameId,
      authorId: fan1,
      body: 'squash this',
      category: 'bug',
      status: 'approved',
    });
    expect((await db.suggestionById(suggestion.id))?.category).toBe('bug');
  });
});

describe('guarded status transitions (dispatch claims)', () => {
  it('claims approved -> working only while still approved', async () => {
    const suggestion = await addApproved('claim me');
    const claimed = await db.setSuggestionStatus(suggestion.id, 'working', ['approved']);
    expect(claimed?.status).toBe('working');
    expect(claimed?.startedAt).not.toBeNull();
    // A second claim (a would-be double dispatch) finds nothing to claim.
    expect(await db.setSuggestionStatus(suggestion.id, 'working', ['approved'])).toBeNull();
  });

  it('never claims a rejected suggestion, never rejects a claimed one', async () => {
    const suggestion = await addApproved('race me');
    const rejected = await db.setSuggestionStatus(suggestion.id, 'rejected', [
      'pending',
      'approved',
    ]);
    expect(rejected?.status).toBe('rejected');
    // The dispatcher lost the race: the claim must not resurrect it.
    expect(await db.setSuggestionStatus(suggestion.id, 'working', ['approved'])).toBeNull();
    expect((await db.suggestionById(suggestion.id))?.status).toBe('rejected');
    // And the other way round: a claimed suggestion cannot be rejected.
    const other = await addApproved('claimed first');
    await db.setSuggestionStatus(other.id, 'working', ['approved']);
    expect(await db.setSuggestionStatus(other.id, 'rejected', ['pending', 'approved'])).toBeNull();
    expect((await db.suggestionById(other.id))?.status).toBe('working');
  });

  it('unguarded transitions still apply (settleWorking)', async () => {
    const suggestion = await addApproved('finish me');
    await db.setSuggestionStatus(suggestion.id, 'working', ['approved']);
    const done = await db.setSuggestionStatus(suggestion.id, 'done');
    expect(done?.status).toBe('done');
    expect(done?.completedAt).not.toBeNull();
  });
});
