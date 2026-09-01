/**
 * The seed every database-backed test starts from: an owner with a saved
 * Reflex key, a public game of theirs, and two fans to heart things.
 *
 * It lives here rather than in each `beforeAll` so that a change to
 * `createGame`/`createReflexKey` is one edit, and so two suites that claim to
 * exercise the same helpers cannot quietly diverge on what they set up.
 */
import type { ArcadeDb } from '../server/db.ts';

export interface SeededArcade {
  ownerId: string;
  fan1: string;
  fan2: string;
  gameId: string;
  keyId: string;
}

export async function seedArcade(db: ArcadeDb): Promise<SeededArcade> {
  const owner = await db.createUser('Streamer');
  const fan1 = await db.createUser('Fan one');
  const fan2 = await db.createUser('Fan two');
  const key = await db.createReflexKey({
    userId: owner.id,
    name: 'test',
    apiKey: 'rfx_test_not_real',
    org: null,
  });
  await db.setActiveKey(owner.id, key.id);
  const game = await db.createGame({
    ownerId: owner.id,
    keyId: key.id,
    title: 'Test game',
    prompt: 'test',
    agentId: 'agent_test',
    agentStreamId: 'stream_test',
    agentType: 'claude-code',
    model: null,
    isPublic: true,
    autoApprove: true,
  });
  return { ownerId: owner.id, fan1: fan1.id, fan2: fan2.id, gameId: game.id, keyId: key.id };
}
