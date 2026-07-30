import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureReflex, resetReflexConfig } from '../http.js';
import { ReflexSocket } from '../socket.js';
import type { ReflexSocketState, ReflexStreamEvent, WebSocketLike } from '../socket.js';

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
  vi.useRealTimers();
  resetReflexConfig();
});

function makeSocket(): ReflexSocket {
  return new ReflexSocket({
    webSocket: FakeWebSocket as unknown as new (url: string) => WebSocketLike,
  });
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
});
