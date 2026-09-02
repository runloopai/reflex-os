/**
 * Watch presence through a deploy. Two behaviors keep a container swap from
 * distorting the arcade: a reconnect's re-announced watch carries
 * `resume: true` so it is presence, not a new play (a deploy reconnects
 * every viewer at once, and each used to count), and `closeAll` hands every
 * socket an orderly 1001 close so browsers reconnect immediately instead of
 * timing out against a dying process.
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
  return {
    socket: socket as unknown as WebSocket,
    say: (frame: Record<string, unknown>) => handlers.get('message')?.(JSON.stringify(frame)),
    closes,
  };
}

describe('EventHub watch presence', () => {
  it('reports a fresh watch as a play, a resumed one as presence only', () => {
    const hub = new EventHub();
    const listener = vi.fn();
    hub.setWatchListener(listener);

    const viewer = fakeClient();
    hub.add(viewer.socket, 'usr_1');
    viewer.say({ type: 'watch', gameId: 'game_1' });
    expect(listener).toHaveBeenLastCalledWith(null, 'game_1', false);

    // The socket the deploy dropped comes back and re-announces.
    const comeback = fakeClient();
    hub.add(comeback.socket, 'usr_1');
    comeback.say({ type: 'watch', gameId: 'game_1', resume: true });
    expect(listener).toHaveBeenLastCalledWith(null, 'game_1', true);
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
