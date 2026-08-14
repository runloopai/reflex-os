import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { PluginContext } from '@reflex/plugin-api';
import { createTestPluginContext, type TestPluginContextResult } from '@reflex/plugin-api/test';
import { WORKSTATION_STALE_THRESHOLD_MS } from '@runloop/reflex-workstation';
import { workstationPlugin } from '../index.js';
import { workstations } from '../server/schema.js';
import {
  WorkstationRegistryService,
  type WorkstationSocketLike,
} from '../server/workstation-registry.service.js';

/**
 * Multi-replica presence semantics against a real (PGLite) database shared
 * by two registry instances — the where-clause behaviour the fake-DB suite
 * in workstation-registry.test.ts cannot express.
 */

class FakeSocket implements WorkstationSocketLike {
  send(): void {}
  close(): void {}
}

function registerInput(name: string, socket: WorkstationSocketLike) {
  return {
    organizationId: 'org_aaaaaaaaaaaaaaaaaaaaaa',
    userId: 'usr_aaaaaaaaaaaaaaaaaaaaaa',
    name,
    hostname: `${name}.local`,
    platform: 'darwin',
    socket,
  };
}

describe('workstation presence at N>1', () => {
  let fixture: TestPluginContextResult;
  let registryA: WorkstationRegistryService;
  let registryB: WorkstationRegistryService;

  beforeEach(async () => {
    fixture = await createTestPluginContext({
      plugin: workstationPlugin,
      instanceId: 'pod-a#boot1',
    });
    registryA = new WorkstationRegistryService(fixture.ctx);
    registryB = new WorkstationRegistryService({
      ...fixture.ctx,
      instanceId: 'pod-b#boot1',
    } as PluginContext);
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  async function rowByName(name: string) {
    const rows = await fixture.db.select().from(workstations).where(eq(workstations.name, name));
    return rows[0]!;
  }

  it('resetPresence clears only rows this instance owns, never a peer replica row', async () => {
    const mine = await registryA.register(registerInput('a-machine', new FakeSocket()));
    const peers = await registryB.register(registerInput('b-machine', new FakeSocket()));
    // An unattributed row from before instance stamping existed.
    await fixture.db
      .update(workstations)
      .set({ connectedInstanceId: null })
      .where(eq(workstations.id, mine.id));

    await registryA.resetPresence();

    expect((await rowByName('a-machine')).status).toBe('offline');
    expect((await rowByName('b-machine')).status).toBe('online');
    expect((await rowByName('b-machine')).connectedInstanceId).toBe('pod-b#boot1');
    expect(peers.status).toBe('online');
  });

  it('stamps presence rows with the registering instance and clears the stamp on disconnect', async () => {
    const socket = new FakeSocket();
    const row = await registryA.register(registerInput('a-machine', socket));
    const stored = await rowByName('a-machine');
    expect(stored.connectedInstanceId).toBe('pod-a#boot1');
    // The stamp is server-internal and never leaves on the public shape.
    expect(row).not.toHaveProperty('connectedInstanceId');

    await registryA.disconnect(stored.id, socket);
    const after = await rowByName('a-machine');
    expect(after.status).toBe('offline');
    expect(after.connectedInstanceId).toBeNull();
  });

  it('ignores a stale disconnect from the previous owner after a peer replica takes over', async () => {
    const socketA = new FakeSocket();
    const row = await registryA.register(registerInput('a-machine', socketA));
    // The user reconnects and lands on pod B: last writer wins, B owns the row.
    await registryB.register(registerInput('a-machine', new FakeSocket()));
    expect((await rowByName('a-machine')).connectedInstanceId).toBe('pod-b#boot1');

    // Pod A's dying socket finally closes; its disconnect must not touch B's row.
    await registryA.disconnect(row.id, socketA);

    expect(registryB.isOnline(row.id)).toBe(true);
    const after = await rowByName('a-machine');
    expect(after.status).toBe('online');
    expect(after.connectedInstanceId).toBe('pod-b#boot1');
  });

  it('trusts a peer-stamped online row in list()/getById(), and sweeps it once the peer stops refreshing', async () => {
    const input = registerInput('b-machine', new FakeSocket());
    const row = await registryB.register(input);

    // Replica A holds no socket for it, but the row is a live peer's: report
    // it online instead of masking the peer's presence.
    const listed = await registryA.list(input.organizationId);
    expect(listed.find((w) => w.id === row.id)?.status).toBe('online');
    expect((await registryA.getById(row.id, input.organizationId))?.status).toBe('online');

    // A live peer refreshes lastSeenAt each tick, so a fresh sweep leaves it.
    await registryB.syncPresenceRows();
    await registryA.syncPresenceRows();
    expect((await rowByName('b-machine')).status).toBe('online');

    // Now the peer dies without disconnect writes: its rows go stale.
    await fixture.db
      .update(workstations)
      .set({ lastSeenAt: Date.now() - WORKSTATION_STALE_THRESHOLD_MS - 1 })
      .where(eq(workstations.id, row.id));
    await registryA.syncPresenceRows();
    const swept = await rowByName('b-machine');
    expect(swept.status).toBe('offline');
    expect(swept.connectedInstanceId).toBeNull();
    expect((await registryA.getById(row.id, input.organizationId))?.status).toBe('offline');
  });

  it('never sweeps its own locally connected rows even with a lagging lastSeenAt', async () => {
    const input = registerInput('a-machine', new FakeSocket());
    const row = await registryA.register(input);
    await fixture.db
      .update(workstations)
      .set({ lastSeenAt: Date.now() - WORKSTATION_STALE_THRESHOLD_MS - 1 })
      .where(eq(workstations.id, row.id));

    await registryA.syncPresenceRows();

    const after = await rowByName('a-machine');
    expect(after.status).toBe('online');
    // The tick also refreshed the row, so peers see it as live again.
    expect(after.lastSeenAt).toBeGreaterThan(Date.now() - WORKSTATION_STALE_THRESHOLD_MS);
  });
});
