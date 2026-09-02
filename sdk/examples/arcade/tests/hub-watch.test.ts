/**
 * Watch presence: through a deploy, and under a client that will not sit
 * still.
 *
 * Two behaviors keep a container swap from distorting the arcade: a
 * reconnect's re-announced watch carries `resume: true` so it is presence,
 * not a new play (a deploy reconnects every viewer at once, and each used to
 * count), and `closeAll` hands every socket an orderly 1001 close so
 * browsers reconnect immediately instead of timing out against a dying
 * process.
 *
 * And one keeps it from being a lever: the socket is the only surface with
 * no HTTP hook in front of it, while a watch change is the expensive frame —
 * it broadcasts a viewer count to every connected client and increments a
 * play in the database. A client alternating between two game ids is
 * therefore an amplifier, so what the hub does with a flood of them is
 * pinned here rather than left to the reviewer's imagination.
 */
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { EventHub, GOING_AWAY } from '../server/events.ts';

/** A ws stand-in that lets the test speak client frames and see closes. */
function fakeClient() {
  const handlers = new Map<string, (raw: string) => void>();
  const closes: unknown[][] = [];
  const socket = {
    OPEN: 1,
    readyState: 1,
    send: () => {},
    on(event: string, handler: (raw: string) => void) {
      handlers.set(event, handler);
      return socket;
    },
    close: (...args: unknown[]) => closes.push(args),
  };
  const say = (frame: Record<string, unknown>) => handlers.get('message')?.(JSON.stringify(frame));
  return {
    socket: socket as unknown as WebSocket,
    say,
    watch: (gameId: string | null) => say({ type: 'watch', gameId }),
    closes,
  };
}

/** Records what the hub asked the server to do about each watch change. */
function hubWithLog() {
  const calls: { prev: string | null; next: string | null; countPlay: boolean }[] = [];
  const hub = new EventHub();
  hub.setWatchListener((prev, next, countPlay) => calls.push({ prev, next, countPlay }));
  return { hub, calls };
}

describe('EventHub watch presence', () => {
  it('reports a fresh watch as a play, a resumed one as presence only', () => {
    const hub = new EventHub();
    const listener = vi.fn();
    hub.setWatchListener(listener);

    const viewer = fakeClient();
    hub.add(viewer.socket, 'usr_1');
    viewer.say({ type: 'watch', gameId: 'game_1' });
    expect(listener).toHaveBeenLastCalledWith(null, 'game_1', true);

    // The socket the deploy dropped comes back and re-announces. A brand-new
    // socket, so nothing it has counted before can rule this out — only the
    // client saying it is a resume.
    const comeback = fakeClient();
    hub.add(comeback.socket, 'usr_1');
    comeback.say({ type: 'watch', gameId: 'game_1', resume: true });
    expect(listener).toHaveBeenLastCalledWith(null, 'game_1', false);
  });

  it('closes every client with "going away" on closeAll', () => {
    const hub = new EventHub();
    const one = fakeClient();
    const two = fakeClient();
    hub.add(one.socket, 'usr_1');
    hub.add(two.socket, null);

    hub.closeAll();
    expect(one.closes).toEqual([[GOING_AWAY, 'arcade restarting']]);
    expect(two.closes).toEqual([[GOING_AWAY, 'arcade restarting']]);
  });
});

describe('watch frames from one socket', () => {
  it('counts a play the first time it opens a game, and not again', () => {
    const { hub, calls } = hubWithLog();
    const client = fakeClient();
    hub.add(client.socket, 'user_1');

    client.watch('game_a');
    client.watch('game_b');
    client.watch('game_a');

    expect(calls.map((call) => call.countPlay)).toEqual([true, true, false]);
  });

  // Still announced — the viewer count has to follow the player back — it is
  // only the counter that stops moving.
  it('still tells the server where the socket went', () => {
    const { hub, calls } = hubWithLog();
    const client = fakeClient();
    hub.add(client.socket, 'user_1');

    client.watch('game_a');
    client.watch('game_b');

    expect(calls[1]).toEqual({ prev: 'game_a', next: 'game_b', countPlay: true });
  });

  it('ignores a repeat of where the socket already is', () => {
    const { hub, calls } = hubWithLog();
    const client = fakeClient();
    hub.add(client.socket, 'user_1');

    client.watch('game_a');
    client.watch('game_a');

    expect(calls).toHaveLength(1);
  });

  it('stops announcing a socket that flips back and forth without pause', () => {
    const { hub, calls } = hubWithLog();
    const client = fakeClient();
    hub.add(client.socket, 'user_1');

    for (let i = 0; i < 500; i++) client.watch(i % 2 === 0 ? 'game_a' : 'game_b');

    // A person changing games does not come near the budget; a loop does.
    expect(calls.length).toBeLessThan(500);
    expect(calls.length).toBeGreaterThan(0);
    // And no amount of flipping keeps writing plays.
    expect(calls.filter((call) => call.countPlay)).toHaveLength(2);
  });

  it('keeps the hub honest about where the socket is, announced or not', () => {
    const { hub } = hubWithLog();
    const client = fakeClient();
    hub.add(client.socket, 'user_1');

    for (let i = 0; i < 500; i++) client.watch(i % 2 === 0 ? 'game_a' : 'game_b');
    // The last frame said game_b (i = 499 is odd), and the viewer count for
    // that game must reflect it even though the change went unannounced.
    expect(hub.viewerCount('game_b')).toBe(1);
    expect(hub.viewerCount('game_a')).toBe(0);
  });

  it('does not grow a set of counted games without bound', () => {
    const { hub, calls } = hubWithLog();
    const client = fakeClient();
    hub.add(client.socket, 'user_1');

    // Far more distinct ids than a session could ever hold, invented by a
    // caller rather than visited by a person.
    for (let i = 0; i < 5_000; i++) client.watch(`game_${i}`);

    expect(calls.length).toBeLessThan(5_000);
  });
});
