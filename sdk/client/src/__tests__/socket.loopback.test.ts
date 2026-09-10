import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { configureReflex, resetReflexConfig } from '../http.js';
import { ReflexSocket, type ReflexSocketState, type ReflexStreamEvent } from '../socket.js';

// Real browser-spec client against a loopback server: no fake socket lifecycle or clocks.
describe('ReflexSocket real-loopback contract', () => {
  let server: WebSocketServer;
  let socket: ReflexSocket;
  let peers: ServerSocket[];

  beforeEach(async () => {
    peers = [];
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    server.on('connection', (peer) => peers.push(peer));
    await once(server, 'listening');
    configureReflex({
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      apiKey: 'loopback-only',
      organizationId: 'org-loopback',
    });
    socket = new ReflexSocket({ initialReconnectDelayMs: 100, reconnectRandom: () => 0.5 });
  });

  afterEach(async () => {
    socket?.close();
    for (const peer of server.clients) peer.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetReflexConfig();
  });

  function nextClosed(): Promise<void> {
    return new Promise((resolve) => {
      const off = socket.onStateChange((state) => {
        if (state === 'closed') {
          off();
          resolve();
        }
      });
    });
  }

  it('reconnects, replays only active subscriptions and delivers a subsequent live event', async () => {
    const subscriptions: string[][] = [];
    server.on('connection', (peer) => {
      const streams: string[] = [];
      subscriptions.push(streams);
      peer.on('message', (data) => {
        const message = JSON.parse(String(data)) as { type: string; streamId: string };
        if (message.type === 'subscribe') streams.push(message.streamId);
      });
    });
    const events: ReflexStreamEvent[] = [];
    const stopOld = socket.subscribe('old', () => {});
    socket.subscribe('kept', (event) => events.push(event));
    await vi.waitFor(() => expect(subscriptions[0]).toEqual(['old', 'kept']));
    const closed = nextClosed();
    peers[0].close();
    await closed;
    stopOld();
    socket.subscribe('added', () => {});
    expect(peers).toHaveLength(1);
    await vi.waitFor(() => expect(subscriptions[1]).toEqual(['kept', 'added']));
    const event: ReflexStreamEvent = {
      id: 'live-after-recovery',
      streamId: 'kept',
      type: 'message',
      payload: {},
      timestamp: 1,
    };
    peers[1].send(JSON.stringify({ type: 'event', event }));
    await vi.waitFor(() => expect(events).toEqual([event]));
    expect(peers).toHaveLength(2);
  });

  it.each(['inside closed observer', 'after close notification'])(
    'notifies remaining observers and stops retries when disposed %s',
    async (disposal) => {
      const states: ReflexSocketState[] = [];
      let handled = false;
      const closed = new Promise<void>((resolve) => {
        socket.onStateChange((state) => {
          if (state !== 'closed' || handled) return;
          handled = true;
          if (disposal === 'inside closed observer') socket.close();
          resolve();
        });
      });
      socket.onStateChange((state) => states.push(state));
      socket.connect();
      await vi.waitFor(() => expect(socket.state).toBe('open'));
      peers[0].close();
      await closed;
      // Either cancel the retry installed by onclose, or repeat observer disposal.
      socket.close();
      expect(states).toEqual(['connecting', 'open', 'closed']);
      // Beyond the controlled 50ms retry deadline, not a guessed production backoff.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(peers).toHaveLength(1);
      expect(socket.state).toBe('closed');
      expect(states).toEqual(['connecting', 'open', 'closed']);
    },
  );

  it.each([false, true])(
    'honors connecting observer disposal (replacement: %s)',
    async (replace) => {
      const states: ReflexSocketState[] = [];
      let handled = false;
      socket.onStateChange((state) => {
        if (state !== 'connecting' || handled) return;
        handled = true;
        socket.close();
        if (replace) socket.connect();
      });
      socket.onStateChange((state) => states.push(state));
      socket.connect();
      if (replace) {
        await vi.waitFor(() => expect(socket.state).toBe('open'));
        expect(peers).toHaveLength(1);
        expect(states).toEqual(['closed', 'connecting', 'open']);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(peers).toHaveLength(0);
        expect(states).toEqual(['closed']);
      }
    },
  );

  it('ignores the old asynchronous close after explicit close/connect replacement', async () => {
    socket.connect();
    await vi.waitFor(() => expect(socket.state).toBe('open'));
    socket.close();
    socket.connect();
    await vi.waitFor(() => {
      expect(peers).toHaveLength(2);
      expect(socket.state).toBe('open');
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(peers).toHaveLength(2);
    expect(socket.state).toBe('open');
  });
});
