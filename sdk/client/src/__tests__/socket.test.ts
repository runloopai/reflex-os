import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureReflex, resetReflexConfig } from '../http.js';
import { ReflexSocket } from '../socket.js';
import type {
  ReflexSocketOptions,
  ReflexSocketState,
  ReflexStreamEvent,
  WebSocketLike,
} from '../socket.js';

/** Minimal scriptable WebSocket standing in for the real one. */
class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  static get latest(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error('no FakeWebSocket constructed yet');
    return ws;
  }

  readyState = 0; // CONNECTING
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.onclose?.({});
  }

  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.({});
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** Server-side drop: close without the client asking for it. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  sentMessages(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw));
  }
}

function makeEvent(overrides: Partial<ReflexStreamEvent> = {}): ReflexStreamEvent {
  return {
    id: 'evt_1',
    streamId: 'stream_1',
    type: 'message',
    payload: { message: 'hello' },
    timestamp: 1700000000000,
    ...overrides,
  };
}

const sockets: ReflexSocket[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  configureReflex({
    baseUrl: 'https://r.example.com',
    apiKey: 'rfx_secret',
    organizationId: 'org_1',
  });
});

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  vi.useRealTimers();
  resetReflexConfig();
});

function makeSocket(options: ReflexSocketOptions = {}): ReflexSocket {
  const socket = new ReflexSocket({
    reconnectJitter: 'none',
    ...options,
    webSocket: FakeWebSocket as unknown as new (url: string) => WebSocketLike,
  });
  sockets.push(socket);
  return socket;
}

describe('ReflexSocket', () => {
  it('connects to /api/ws with token and organizationId query params', () => {
    const socket = makeSocket();
    socket.connect();
    expect(FakeWebSocket.latest.url).toBe(
      'wss://r.example.com/api/ws?token=rfx_secret&organizationId=org_1',
    );
  });

  it('sends subscribe on subscribe() and delivers matching events', () => {
    const socket = makeSocket();
    const received: ReflexStreamEvent[] = [];
    socket.subscribe('stream_1', (event) => received.push(event));

    const ws = FakeWebSocket.latest;
    ws.open();
    expect(ws.sentMessages()).toContainEqual({ type: 'subscribe', streamId: 'stream_1' });

    ws.receive({ type: 'event', event: makeEvent() });
    ws.receive({ type: 'event', event: makeEvent({ id: 'evt_2', streamId: 'other' }) });

    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe('evt_1');
  });

  it('sends unsubscribe when the last handler for a stream is removed', () => {
    const socket = makeSocket();
    const unsubA = socket.subscribe('stream_1', () => {});
    const ws = FakeWebSocket.latest;
    ws.open();
    const unsubB = socket.subscribe('stream_1', () => {});

    unsubA();
    expect(ws.sentMessages()).not.toContainEqual({ type: 'unsubscribe', streamId: 'stream_1' });
    unsubB();
    expect(ws.sentMessages()).toContainEqual({ type: 'unsubscribe', streamId: 'stream_1' });
  });

  it('reconnects with backoff and resubscribes active streams', () => {
    const socket = makeSocket();
    socket.subscribe('stream_1', () => {});
    const first = FakeWebSocket.latest;
    first.open();

    first.drop();
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    const second = FakeWebSocket.latest;
    second.open();
    expect(second.sentMessages()).toContainEqual({ type: 'subscribe', streamId: 'stream_1' });
  });

  it('does not reconnect after close()', () => {
    const socket = makeSocket();
    socket.subscribe('stream_1', () => {});
    FakeWebSocket.latest.open();

    socket.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.state).toBe('closed');
  });

  it('sends heartbeat pings while the connection is quiet', () => {
    const socket = makeSocket();
    socket.connect();
    const ws = FakeWebSocket.latest;
    ws.open();

    vi.advanceTimersByTime(25_000);
    expect(ws.sentMessages()).toContainEqual({ type: 'ping' });
    // A pong keeps the connection alive across heartbeats.
    ws.receive({ type: 'pong' });
    vi.advanceTimersByTime(25_000);
    expect(ws.sentMessages().filter((m) => (m as { type: string }).type === 'ping')).toHaveLength(
      2,
    );
  });

  it('rebuilds a stale connection that stops receiving messages', () => {
    const socket = makeSocket();
    socket.subscribe('stream_1', () => {});
    const first = FakeWebSocket.latest;
    first.open();

    // No server traffic for over three heartbeat intervals.
    vi.advanceTimersByTime(4 * 25_000);

    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.latest;
    second.open();
    expect(second.sentMessages()).toContainEqual({ type: 'subscribe', streamId: 'stream_1' });
  });

  it('notifies state change handlers', () => {
    const socket = makeSocket();
    const states: ReflexSocketState[] = [];
    socket.onStateChange((state) => states.push(state));

    socket.connect();
    FakeWebSocket.latest.open();
    socket.close();

    expect(states).toEqual(['connecting', 'open', 'closed']);
  });

  it('exposes raw server messages via onMessage', () => {
    const socket = makeSocket();
    const messages: unknown[] = [];
    socket.onMessage((message) => messages.push(message));
    socket.connect();
    const ws = FakeWebSocket.latest;
    ws.open();

    ws.receive({ type: 'subscribed', streamId: 'stream_1' });
    expect(messages).toContainEqual({ type: 'subscribed', streamId: 'stream_1' });
  });

  it('throws a helpful error when no WebSocket implementation exists', () => {
    const original = (globalThis as { WebSocket?: unknown }).WebSocket;
    delete (globalThis as { WebSocket?: unknown }).WebSocket;
    try {
      expect(() => new ReflexSocket()).toThrow(/WebSocket implementation/);
    } finally {
      if (original !== undefined) {
        (globalThis as { WebSocket?: unknown }).WebSocket = original;
      }
    }
  });
  it('samples default retries once and does not let lazy subscriptions bypass the wait', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
    try {
      const a = makeSocket({ reconnectJitter: undefined });
      const b = makeSocket({ reconnectJitter: undefined });
      a.connect();
      const first = FakeWebSocket.latest;
      b.connect();
      const second = FakeWebSocket.latest;
      first.open();
      second.open();
      first.drop();
      second.drop();
      first.drop(); // A stale duplicate cannot consume a second sample.
      const unsubscribe = a.subscribe('removed', () => {});
      unsubscribe();
      a.subscribe('new-stream', () => {});
      expect(random).toHaveBeenCalledTimes(2);
      expect(FakeWebSocket.instances).toHaveLength(2);
      vi.advanceTimersByTime(249);
      expect(FakeWebSocket.instances).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(3);
      FakeWebSocket.latest.open();
      expect(FakeWebSocket.latest.sentMessages()).toEqual([
        { type: 'subscribe', streamId: 'new-stream' },
      ]);
      vi.advanceTimersByTime(500);
      expect(FakeWebSocket.instances).toHaveLength(4);
    } finally {
      random.mockRestore();
    }
  });

  it('replaces an old retry when an explicit attempt fails, using current credentials', () => {
    const socket = makeSocket();
    socket.connect();
    FakeWebSocket.latest.drop();
    vi.advanceTimersByTime(400);
    configureReflex({
      baseUrl: 'https://new.example.com',
      apiKey: 'new-token',
      organizationId: 'org_2',
    });
    socket.connect();
    expect(FakeWebSocket.latest.url).toBe(
      'wss://new.example.com/api/ws?token=new-token&organizationId=org_2',
    );
    FakeWebSocket.latest.drop();
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('cancels a zero-delay retry and does not restart heartbeat after an open observer closes', () => {
    const socket = makeSocket({ reconnectJitter: 'full', reconnectRandom: () => 0 });
    socket.connect();
    FakeWebSocket.latest.drop();
    socket.close();
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    socket.onStateChange((state) => {
      if (state === 'open') socket.close();
    });
    socket.connect();
    FakeWebSocket.latest.open();
    expect(socket.state).toBe('closed');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('allows explicit recovery when the WebSocket constructor throws', () => {
    let fail = true;
    class RecoverableWebSocket extends FakeWebSocket {
      constructor(url: string) {
        if (fail) {
          fail = false;
          throw new Error('constructor failed');
        }
        super(url);
      }
    }
    const socket = new ReflexSocket({ webSocket: RecoverableWebSocket });
    sockets.push(socket);
    expect(() => socket.connect()).toThrow('constructor failed');
    expect(socket.state).toBe('closed');
    socket.connect();
    FakeWebSocket.latest.open();
    expect(socket.state).toBe('open');
  });
});
