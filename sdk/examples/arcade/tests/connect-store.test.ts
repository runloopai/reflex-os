/**
 * The pending-connection store behind "Connect with Reflex". Two rules carry
 * the security of the flow: a device code is only ever polled by the player
 * who started it, and a code Reflex would no longer honour is forgotten
 * rather than retried.
 */
import { describe, expect, it } from 'vitest';
import { ConnectStore } from '../server/connect.ts';

const NOW = 1_800_000_000_000;

function start(store: ConnectStore, userId: string, now = NOW) {
  return store.start(
    { userId, deviceCode: `dev_${userId}`, userCode: 'WXYZ-1234', expiresIn: 600 },
    now,
  );
}

describe('ConnectStore', () => {
  it('hands back an opaque id and keeps the device code server-side', () => {
    const store = new ConnectStore();
    const entry = start(store, 'usr_1');
    expect(entry.id).toMatch(/^con_[0-9a-f]{32}$/);
    expect(entry.deviceCode).toBe('dev_usr_1');
    expect(entry.expiresAt).toBe(NOW + 600_000);
  });

  it('mints a distinct id per flow', () => {
    const store = new ConnectStore();
    expect(start(store, 'usr_1').id).not.toBe(start(store, 'usr_1').id);
  });

  it('resolves a live flow for the player who started it', () => {
    const store = new ConnectStore();
    const entry = start(store, 'usr_1');
    expect(store.get(entry.id, 'usr_1', NOW + 1_000)?.deviceCode).toBe('dev_usr_1');
  });

  it('hides a flow from every other player', () => {
    const store = new ConnectStore();
    const entry = start(store, 'usr_1');
    // Otherwise a player who learned an id could poll someone else's
    // approval into a key saved on their own account.
    expect(store.get(entry.id, 'usr_2')).toBeNull();
  });

  it('drops a flow once its code has expired', () => {
    const store = new ConnectStore();
    const entry = start(store, 'usr_1');
    expect(store.get(entry.id, 'usr_1', NOW + 600_000)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('sweeps expired flows without touching live ones', () => {
    const store = new ConnectStore();
    const old = start(store, 'usr_1');
    const fresh = start(store, 'usr_2', NOW + 300_000);
    store.sweep(NOW + 600_001);
    expect(store.get(old.id, 'usr_1', NOW + 600_001)).toBeNull();
    expect(store.get(fresh.id, 'usr_2', NOW + 600_001)?.userId).toBe('usr_2');
  });

  it('forgets a flow the player abandoned', () => {
    const store = new ConnectStore();
    const entry = start(store, 'usr_1');
    store.delete(entry.id);
    expect(store.get(entry.id, 'usr_1')).toBeNull();
  });
});
