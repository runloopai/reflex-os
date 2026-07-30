/**
 * "Connect with Reflex" — the browser half.
 *
 * The arcade server starts a device-authorization flow on Reflex and holds
 * the poll secret; this drives it: open Reflex's approval page, then ask the
 * arcade to poll until the player approves, denies, or lets the code expire.
 *
 * The whole loop is one async function with its effects injected (start,
 * poll, cancel, open, sleep, clock) so it can be tested without a browser or
 * a running server. The component owns only the rendering.
 */
import type { ConnectPoll, ConnectStarted, Me } from './api.ts';

/** Effects the loop needs, injected so tests can drive it synchronously. */
export interface ConnectDeps {
  start: () => Promise<ConnectStarted>;
  poll: (connectionId: string) => Promise<ConnectPoll>;
  cancel: (connectionId: string) => Promise<unknown>;
  /** Open Reflex's approval page. Blocked popups are fine: the UI links it too. */
  open: (url: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** What the player should see while the flow is in flight. */
export interface ConnectWaiting {
  connectionId: string;
  userCode: string;
  approveUrl: string;
}

export type ConnectOutcome =
  | { status: 'approved'; user: Me }
  | { status: 'denied'; message: string }
  | { status: 'expired'; message: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Run one connect flow to its end.
 *
 * `onWaiting` fires once, as soon as Reflex hands back an approval URL, so
 * the UI can show the code and the link even if the new tab was blocked.
 * Aborting (the player hit cancel) drops the pending flow on the server.
 *
 * Polls are best-effort: a failed poll is retried on the next tick rather
 * than ending the flow, because the player may already be approving in the
 * other tab and a blip here would throw away a key Reflex is about to mint.
 * The code's own expiry bounds the retries.
 */
export async function connectWithReflex(
  deps: ConnectDeps,
  onWaiting: (waiting: ConnectWaiting) => void,
  signal?: AbortSignal,
): Promise<ConnectOutcome> {
  let started: ConnectStarted;
  try {
    started = await deps.start();
  } catch (err) {
    return { status: 'error', message: messageOf(err, 'Could not start the connection.') };
  }

  onWaiting({
    connectionId: started.connectionId,
    userCode: started.userCode,
    approveUrl: started.approveUrl,
  });
  deps.open(started.approveUrl);

  const giveUpAt = deps.now() + started.expiresIn * 1000;
  const intervalMs = Math.max(1, started.interval) * 1000;

  for (;;) {
    await deps.sleep(intervalMs);
    if (signal?.aborted) {
      void deps.cancel(started.connectionId).catch(() => {});
      return { status: 'cancelled' };
    }

    let result: ConnectPoll;
    try {
      result = await deps.poll(started.connectionId);
    } catch (err) {
      // Only an outage that lasts to the deadline is worth reporting as one.
      const message = messageOf(err, 'Could not reach the arcade server.');
      if (deps.now() >= giveUpAt) return { status: 'error', message };
      continue;
    }

    if (result.status === 'approved') return { status: 'approved', user: result.user };
    if (result.status === 'denied') return { status: 'denied', message: result.message };
    if (result.status === 'expired') return { status: 'expired', message: result.message };

    if (deps.now() >= giveUpAt) {
      return { status: 'expired', message: 'This connection expired. Start it again.' };
    }
  }
}

/** The real effects, for the app. */
export function browserConnectDeps(
  api: Pick<ConnectDeps, 'start' | 'poll' | 'cancel'>,
): ConnectDeps {
  return {
    ...api,
    open: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}
