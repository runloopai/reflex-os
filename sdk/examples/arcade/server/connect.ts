/**
 * Pending "Connect with Reflex" flows.
 *
 * The arcade starts a device-authorization flow on Reflex for a player, then
 * polls it until they approve in Reflex's own UI. The device code that poll
 * needs is a bearer secret for a credential about to exist, so it stays on
 * the server: the browser gets an opaque connection id and the short user
 * code, and asks the arcade to poll on its behalf.
 *
 * State lives in the database, not in process memory: a deploy replaces the
 * container mid-flow, and a player who was mid-approval when one landed had
 * to start over. Entries carry the TTL Reflex granted the code and are
 * swept on the reads and writes that touch the table.
 */
import { randomBytes } from 'node:crypto';
import type { ArcadeDb, PendingConnectRow } from './db.ts';

/** One connection waiting on a player's approval in Reflex. */
export type PendingConnect = PendingConnectRow;

export interface StartPendingInput {
  userId: string;
  deviceCode: string;
  userCode: string;
  /** Seconds Reflex says the code is good for. */
  expiresIn: number;
}

/**
 * Live connections, keyed by the id the browser holds. Entries are dropped
 * on the first sweep after they expire, on the poll that resolves them, and
 * when the player abandons the flow.
 */
export class ConnectStore {
  constructor(private readonly db: ArcadeDb) {}

  /** Track a flow Reflex just handed us. */
  async start(input: StartPendingInput, now = Date.now()): Promise<PendingConnect> {
    await this.db.sweepPendingConnects(now);
    const entry: PendingConnect = {
      id: `con_${randomBytes(16).toString('hex')}`,
      userId: input.userId,
      deviceCode: input.deviceCode,
      userCode: input.userCode,
      expiresAt: now + input.expiresIn * 1000,
    };
    await this.db.insertPendingConnect(entry);
    return entry;
  }

  /**
   * The live flow with this id, if it belongs to this player. An expired or
   * foreign id reads as "no such connection" — a player must not be able to
   * poll another player's flow into a key on their own account.
   */
  async get(id: string, userId: string, now = Date.now()): Promise<PendingConnect | null> {
    await this.db.sweepPendingConnects(now);
    const entry = await this.db.pendingConnectById(id);
    if (!entry || entry.userId !== userId) return null;
    return entry;
  }

  /** Forget a flow once it has resolved or been abandoned. */
  async delete(id: string): Promise<void> {
    await this.db.deletePendingConnect(id);
  }

  /** Drop every entry Reflex would no longer honour. */
  async sweep(now = Date.now()): Promise<void> {
    await this.db.sweepPendingConnects(now);
  }

  /** Test seam: how many flows are being tracked. */
  count(): Promise<number> {
    return this.db.countPendingConnects();
  }
}
