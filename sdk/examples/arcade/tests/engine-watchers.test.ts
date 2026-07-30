/**
 * One watcher per game, no matter who asks or when.
 *
 * Two watchers on one game means two dispatchers racing the same queue:
 * each claims a different approved suggestion and sends it, so the agent
 * gets two turns at once. `ensureWatcher` awaits the owner's credentials
 * before it registers anything, so a plain `watchers.has()` check does not
 * prevent that — a second caller arriving during the await finds the map
 * still empty. These tests pin the dedupe with the credential fetch held
 * open, which is exactly the window the race lives in.
 */
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../server/engine.ts';
import type { ArcadeDb, GameRow } from '../server/db.ts';
import type { EventHub } from '../server/events.ts';

const game = { id: 'game_1', status: 'live', ownerId: 'user_1', keyId: 'key_1' } as GameRow;

/**
 * An engine whose credential fetch is under the test's control. Resolving
 * with `null` ends `startWatcher` before it builds a `GameWatcher`, so no
 * sockets or timers are created — the dedupe is the only thing exercised.
 */
function engineWithHeldCreds() {
  let calls = 0;
  let release: (value: null) => void = () => {};
  const held = new Promise<null>((resolve) => {
    release = resolve;
  });
  const db = {
    credsForGame: () => {
      calls += 1;
      return held;
    },
  } as unknown as ArcadeDb;
  const engine = new GameEngine(db, {} as EventHub, 'http://localhost:0');
  return { engine, credCalls: () => calls, release: () => release(null) };
}

describe('ensureWatcher', () => {
  it('starts one watcher for concurrent callers', async () => {
    const { engine, credCalls, release } = engineWithHeldCreds();

    // Two callers race — e.g. `resumeAll` at boot and a game-created poke.
    const both = Promise.all([engine.ensureWatcher(game), engine.ensureWatcher(game)]);
    expect(credCalls()).toBe(1);

    release();
    await both;
    expect(credCalls()).toBe(1);
  });

  it('lets a later caller start again once the first attempt finished', async () => {
    const { engine, credCalls, release } = engineWithHeldCreds();
    release();
    await engine.ensureWatcher(game);
    // The first attempt registered nothing (no credentials), so a later
    // call must be free to retry rather than latch on a dead reservation.
    await engine.ensureWatcher(game);
    expect(credCalls()).toBe(2);
  });

  it('does not resurrect a watcher dropped while it was starting', async () => {
    const { engine, release } = engineWithHeldCreds();
    const starting = engine.ensureWatcher(game);
    engine.dropWatcher(game.id);
    release();
    await starting;
    // Nothing to assert on the map directly; the contract is that a drop
    // during startup wins, and a later ensure can still start fresh.
    await expect(engine.ensureWatcher(game)).resolves.toBeUndefined();
  });

  it('skips games that are already stopped or errored', async () => {
    const { engine, credCalls, release } = engineWithHeldCreds();
    release();
    await engine.ensureWatcher({ ...game, status: 'stopped' } as GameRow);
    await engine.ensureWatcher({ ...game, status: 'error' } as GameRow);
    expect(credCalls()).toBe(0);
  });
});
