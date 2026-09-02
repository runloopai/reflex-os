/**
 * The pending-connection store behind "Connect with Reflex". Two rules carry
 * the security of the flow: a device code is only ever polled by the player
 * who started it, and a code Reflex would no longer honour is forgotten
 * rather than retried. The store is database-backed so a flow survives the
 * container being replaced by a deploy mid-approval.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArcadeDb } from '../server/db.ts';
import { ConnectStore } from '../server/connect.ts';

const NOW = 1_900_000_000_000;

let db: ArcadeDb;
let store: ConnectStore;
let usr1: string;
let usr2: string;

beforeAll(async () => {
  db = await ArcadeDb.open({ kind: 'pglite', dataDir: 'memory://' });
  store = new ConnectStore(db);
  usr1 = (await db.createUser('Player one')).id;
  usr2 = (await db.createUser('Player two')).id;
});

afterAll(async () => {
  await db.close();
});

function start(userId: string, now = NOW) {
  return store.start(
    { userId, deviceCode: `dev_${userId}`, userCode: 'WXYZ-1234', expiresIn: 600 },
    now,
  );
}

describe('ConnectStore', () => {
  it('hands back an opaque id and keeps the device code server-side', async () => {
    const entry = await start(usr1);
    expect(entry.id).toMatch(/^con_[0-9a-f]{32}$/);
    expect(entry.deviceCode).toBe(`dev_${usr1}`);
    expect(entry.expiresAt).toBe(NOW + 600_000);
  });

  it('mints a distinct id per flow', async () => {
    expect((await start(usr1)).id).not.toBe((await start(usr1)).id);
  });

  it('resolves a live flow for the player who started it', async () => {
    const entry = await start(usr1);
    const found = await store.get(entry.id, usr1, NOW + 1_000);
    expect(found?.deviceCode).toBe(`dev_${usr1}`);
    expect(found?.expiresAt).toBe(NOW + 600_000);
  });

  it('survives the process being replaced mid-flow', async () => {
    // A deploy swaps the container while the player is on Reflex's approval
    // page. The browser still holds the connection id, so a fresh store over
    // the same database must resolve it — that durability is the reason the
    // store is not a Map.
    const entry = await start(usr1);
    const afterDeploy = new ConnectStore(db);
    const found = await afterDeploy.get(entry.id, usr1, NOW + 1_000);
    expect(found?.deviceCode).toBe(`dev_${usr1}`);
  });

  it('hides a flow from every other player', async () => {
    const entry = await start(usr1);
    // Otherwise a player who learned an id could poll someone else's
    // approval into a key saved on their own account.
    expect(await store.get(entry.id, usr2, NOW + 1_000)).toBeNull();
  });

  it('drops a flow once its code has expired', async () => {
    const entry = await start(usr1);
    expect(await store.get(entry.id, usr1, NOW + 600_000)).toBeNull();
    expect(await store.count()).toBe(0);
  });

  it('sweeps expired flows without touching live ones', async () => {
    const old = await start(usr1);
    const fresh = await start(usr2, NOW + 300_000);
    await store.sweep(NOW + 600_001);
    expect(await store.get(old.id, usr1, NOW + 600_001)).toBeNull();
    expect((await store.get(fresh.id, usr2, NOW + 600_001))?.userId).toBe(usr2);
  });

  it('forgets a flow the player abandoned', async () => {
    const entry = await start(usr1, NOW + 300_000);
    await store.delete(entry.id);
    expect(await store.get(entry.id, usr1, NOW + 300_001)).toBeNull();
  });
});
