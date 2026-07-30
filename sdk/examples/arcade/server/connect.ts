/**
 * Pending "Connect with Reflex" flows.
 *
 * The arcade starts a device-authorization flow on Reflex for a player, then
 * polls it until they approve in Reflex's own UI. The device code that poll
 * needs is a bearer secret for a credential about to exist, so it stays in
 * this process: the browser gets an opaque connection id and the short user
 * code, and asks the arcade to poll on its behalf.
 *
 * State is a module-scope map with a TTL, like Reflex's own device store —
 * a connection in flight is worth less than the 10 minutes it lives for, so
 * losing the map on restart just means starting the flow again.
 */
import { randomBytes } from 'node:crypto';

/** One connection waiting on a player's approval in Reflex. */
export interface PendingConnect {
  /** Opaque id the browser polls with. */
  id: string;
  /** Arcade player this flow belongs to; nobody else may poll it. */
  userId: string;
  /** Reflex's poll secret. Never sent to a browser. */
  deviceCode: string;
  /** Short code shown on both ends so the player can match them up. */
  userCode: string;
  /** Epoch ms after which Reflex would reject the code anyway. */
  expiresAt: number;
}

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
  private readonly pending = new Map<string, PendingConnect>();

  /** Track a flow Reflex just handed us. */
  start(input: StartPendingInput, now = Date.now()): PendingConnect {
    this.sweep(now);
    const entry: PendingConnect = {
      id: `con_${randomBytes(16).toString('hex')}`,
      userId: input.userId,
      deviceCode: input.deviceCode,
      userCode: input.userCode,
      expiresAt: now + input.expiresIn * 1000,
    };
    this.pending.set(entry.id, entry);
    return entry;
  }

  /**
   * The live flow with this id, if it belongs to this player. An expired or
   * foreign id reads as "no such connection" — a player must not be able to
   * poll another player's flow into a key on their own account.
   */
  get(id: string, userId: string, now = Date.now()): PendingConnect | null {
    this.sweep(now);
    const entry = this.pending.get(id);
    if (!entry || entry.userId !== userId) return null;
    return entry;
  }

  /** Forget a flow once it has resolved or been abandoned. */
  delete(id: string): void {
    this.pending.delete(id);
  }

  /** Drop every entry Reflex would no longer honour. */
  sweep(now = Date.now()): void {
    for (const [id, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(id);
    }
  }

  /** Test seam: how many flows are being tracked. */
  get size(): number {
    return this.pending.size;
  }
}
