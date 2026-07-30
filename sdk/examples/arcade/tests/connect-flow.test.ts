/**
 * The browser half of "Connect with Reflex": open Reflex's approval page,
 * then poll the arcade until the player answers. The interesting behavior is
 * what the loop does when things go sideways — a blipping poll must not
 * throw away a key the player is in the middle of approving, and a player
 * who walks away must not leave the loop spinning.
 */
import { describe, expect, it, vi } from 'vitest';
import { connectWithReflex, type ConnectDeps } from '../web/src/lib/connect.ts';
import type { ConnectPoll, ConnectStarted, Me } from '../web/src/lib/api.ts';

const STARTED: ConnectStarted = {
  connectionId: 'con_1',
  userCode: 'WXYZ-1234',
  approveUrl: 'https://reflex.test/connect?code=WXYZ-1234',
  interval: 2,
  expiresIn: 600,
};

const ME: Me = {
  id: 'usr_1',
  name: 'Alex',
  avatar: '',
  bio: '',
  activeKeyId: 'key_1',
  keys: [{ id: 'key_1', name: 'Acme', org: 'org_1', preview: 'rfx_...abcd' }],
};

/**
 * Deps whose clock only moves when the loop sleeps, so "the code expired"
 * is a function of polls taken rather than of how long the test ran.
 */
function makeDeps(polls: (ConnectPoll | Error)[], overrides: Partial<ConnectDeps> = {}) {
  let clock = 0;
  const queue = [...polls];
  const deps: ConnectDeps = {
    start: vi.fn().mockResolvedValue(STARTED),
    poll: vi.fn(async () => {
      const next = queue.shift() ?? { status: 'pending' as const };
      if (next instanceof Error) throw next;
      return next;
    }),
    cancel: vi.fn().mockResolvedValue({ ok: true }),
    open: vi.fn(),
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    now: () => clock,
    ...overrides,
  };
  return deps;
}

describe('connectWithReflex', () => {
  it('shows the code and opens the approval page before polling', async () => {
    const deps = makeDeps([{ status: 'approved', keyId: 'key_1', user: ME }]);
    const waiting = vi.fn();
    const outcome = await connectWithReflex(deps, waiting);

    expect(waiting).toHaveBeenCalledWith({
      connectionId: 'con_1',
      userCode: 'WXYZ-1234',
      approveUrl: STARTED.approveUrl,
    });
    expect(deps.open).toHaveBeenCalledWith(STARTED.approveUrl);
    expect(outcome).toEqual({ status: 'approved', user: ME });
  });

  it('keeps polling while the player is still approving', async () => {
    const deps = makeDeps([
      { status: 'pending' },
      { status: 'pending' },
      { status: 'approved', keyId: 'key_1', user: ME },
    ]);
    const outcome = await connectWithReflex(deps, vi.fn());
    expect(deps.poll).toHaveBeenCalledTimes(3);
    expect(outcome.status).toBe('approved');
    // Polls wait the interval Reflex asked for, not a hardcoded one.
    expect(deps.sleep).toHaveBeenCalledWith(2000);
  });

  it('reports a refusal as an answer, not an error', async () => {
    const deps = makeDeps([{ status: 'denied', message: 'You turned it down in Reflex.' }]);
    const outcome = await connectWithReflex(deps, vi.fn());
    expect(outcome).toEqual({ status: 'denied', message: 'You turned it down in Reflex.' });
  });

  it('rides out a failing poll instead of dropping the flow', async () => {
    const deps = makeDeps([
      new Error('Could not reach Reflex. Trying again shortly.'),
      { status: 'approved', keyId: 'key_1', user: ME },
    ]);
    const outcome = await connectWithReflex(deps, vi.fn());
    expect(outcome.status).toBe('approved');
  });

  it('gives up once the code has outlived its expiry', async () => {
    // Nothing but pending answers: the loop must end itself at the deadline.
    const deps = makeDeps([]);
    const outcome = await connectWithReflex(deps, vi.fn());
    expect(outcome.status).toBe('expired');
    expect(deps.poll).toHaveBeenCalledTimes(STARTED.expiresIn / STARTED.interval);
  });

  it('surfaces the last poll failure when the deadline passes mid-outage', async () => {
    const deps = makeDeps(Array.from({ length: 400 }, () => new Error('Server is down.')));
    const outcome = await connectWithReflex(deps, vi.fn());
    expect(outcome).toEqual({ status: 'error', message: 'Server is down.' });
  });

  it('does not blame a recovered outage for a later expiry', async () => {
    // One failed poll, then a healthy server that simply never sees an
    // approval. The player timed out; nothing was down when it happened.
    const deps = makeDeps([new Error('Server is down.')]);
    const outcome = await connectWithReflex(deps, vi.fn());
    expect(outcome).toEqual({
      status: 'expired',
      message: 'This connection expired. Start it again.',
    });
  });

  it('drops the pending flow on the server when the player cancels', async () => {
    const controller = new AbortController();
    const deps = makeDeps([], {
      sleep: vi.fn(async () => {
        controller.abort();
      }),
    });
    const outcome = await connectWithReflex(deps, vi.fn(), controller.signal);
    expect(outcome).toEqual({ status: 'cancelled' });
    expect(deps.cancel).toHaveBeenCalledWith('con_1');
    expect(deps.poll).not.toHaveBeenCalled();
  });

  it('reports a start that never got off the ground', async () => {
    const deps = makeDeps([], {
      start: vi.fn().mockRejectedValue(new Error('Could not reach Reflex.')),
    });
    const outcome = await connectWithReflex(deps, vi.fn());
    expect(outcome).toEqual({ status: 'error', message: 'Could not reach Reflex.' });
    expect(deps.open).not.toHaveBeenCalled();
  });
});
