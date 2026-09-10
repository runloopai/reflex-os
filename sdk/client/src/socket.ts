/**
 * WebSocket stream client for the Reflex SDK.
 *
 * Speaks the same protocol as the Reflex web app's socket manager
 * (`web/src/lib/socketManager.ts`) against the server's `/api/ws` endpoint
 * (`server/src/routes/ws.routes.ts`):
 *
 * - Connect to `<base>/api/ws?token=<apiKey>&organizationId=<org>` (WS
 *   handshakes cannot carry custom headers, so auth and org travel as query
 *   params; the server accepts an org id or slug).
 * - Client → server: `{ type: 'subscribe' | 'unsubscribe', streamId }` and
 *   app-level `{ type: 'ping' }` heartbeats (the server answers
 *   `{ type: 'pong' }`).
 * - Server → client: `{ type: 'event', event }` for stream events, plus
 *   `subscribed` / `unsubscribed` acks and `{ type: 'error', message }`.
 * - On subscribe the server replays the stream's cached events, so a fresh
 *   subscription receives history followed by live events.
 *
 * Dependency-free: uses the global `WebSocket` (browsers, Node >= 22) and
 * accepts an injectable constructor for other runtimes. Reconnects with
 * full-jitter exponential backoff and replays every active subscription.
 */

import { createReconnectBackoff, type ReconnectOptions } from './reconnect.js';
import { getReflexConfig, resolveReflexOrganizationId, resolveReflexToken } from './http.js';

/**
 * One event on an agent's stream. Minimal structural copy of Reflex's
 * `AxonEvent` (source of truth: `shared/src/event.types.ts` /
 * the generated `AxonEvent` model) so the socket module stays free of
 * private workspace dependencies. `type` is intentionally `string`: the
 * server adds event types over time and the SDK must not reject them.
 */
export interface ReflexStreamEvent {
  id: string;
  sequence?: number;
  streamId: string;
  type: string;
  payload: unknown;
  timestamp: number;
  origin?: string;
  source?: string;
}

/** Any message the server pushes over the socket. */
export interface ReflexSocketMessage {
  type: string;
  event?: ReflexStreamEvent;
  streamId?: string;
  message?: string;
  [key: string]: unknown;
}

export type ReflexSocketState = 'connecting' | 'open' | 'closed';
export type ReflexEventHandler = (event: ReflexStreamEvent) => void;
export type ReflexStateHandler = (state: ReflexSocketState) => void;
export type ReflexMessageHandler = (message: ReflexSocketMessage) => void;

/**
 * Structural subset of the standard WebSocket interface the socket needs.
 * Lets Node users inject `ws` (or any compatible implementation) without a
 * type dependency on DOM lib or `@types/ws`.
 */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

/** readyState value for an open WebSocket (WebSocket.OPEN). */
const WS_OPEN = 1;
/** readyState value for a connecting WebSocket (WebSocket.CONNECTING). */
const WS_CONNECTING = 0;

/**
 * Cadence of app-level `{ type: 'ping' }` probes. Each ping earns a
 * `{ type: 'pong' }`, so a healthy connection always has app-visible traffic
 * at least once per interval even when no events are flowing.
 */
const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * How long the connection may go without ANY server message before it is
 * declared half-open and rebuilt. Three missed heartbeats, matching the
 * Reflex web client's watchdog.
 */
const STALE_CONNECTION_THRESHOLD_MS = 3 * HEARTBEAT_INTERVAL_MS;

export interface ReflexSocketOptions {
  /** WebSocket implementation. Defaults to the global `WebSocket`. */
  webSocket?: WebSocketConstructor;
  /** Override the heartbeat cadence (mostly for tests). */
  heartbeatIntervalMs?: number;
  /** Override the initial reconnect backoff (mostly for tests). */
  initialReconnectDelayMs?: ReconnectOptions['initialReconnectDelayMs'];
  /** Full jitter by default; `none` is a deterministic compatibility override. */
  reconnectJitter?: ReconnectOptions['reconnectJitter'];
  /** Trusted RNG injection for tests. See ReconnectOptions. */
  reconnectRandom?: ReconnectOptions['reconnectRandom'];
}

/**
 * Live event stream connection. Create one per app, call
 * {@link ReflexSocket.subscribe} per agent stream, and dispose handlers with
 * the returned unsubscribe function. `configureReflex(...)` must be called
 * before {@link ReflexSocket.connect}.
 */
export class ReflexSocket {
  private ws: WebSocketLike | null = null;
  private readonly WebSocketImpl: WebSocketConstructor;
  private readonly heartbeatIntervalMs: number;
  private readonly reconnectBackoff: ReturnType<typeof createReconnectBackoff>;

  private readonly streamHandlers = new Map<string, Set<ReflexEventHandler>>();
  private readonly stateHandlers = new Set<ReflexStateHandler>();
  private readonly messageHandlers = new Set<ReflexMessageHandler>();

  // Invalidates work across reentrant state observers, even before a socket exists.
  private connectionGeneration = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionallyClosed = false;
  private lastServerActivity = 0;
  private _state: ReflexSocketState = 'closed';
  // State transitions, unlike connection disposal, supersede observer notifications.
  private stateRevision = 0;

  constructor(options: ReflexSocketOptions = {}) {
    const impl =
      options.webSocket ?? (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
    if (!impl) {
      throw new Error(
        'No WebSocket implementation available. Pass one via new ReflexSocket({ webSocket }) ' +
          '(e.g. the "ws" package on older Node versions).',
      );
    }
    this.WebSocketImpl = impl;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.reconnectBackoff = createReconnectBackoff(options);
  }

  get state(): ReflexSocketState {
    return this._state;
  }

  /**
   * Open the connection. Safe to call repeatedly; no-ops while a connection
   * is open or connecting. The URL is rebuilt from `getReflexConfig()` on
   * every attempt, so reconnects pick up config changes.
   */
  connect(): void {
    if (!this.ws && this._state === 'connecting') return;
    if (this.ws && (this.ws.readyState === WS_OPEN || this.ws.readyState === WS_CONNECTING)) {
      return;
    }

    const config = getReflexConfig();
    const wsBase = config.baseUrl.replace(/^http/, 'ws');
    const token = resolveReflexToken(config);
    const organizationId = resolveReflexOrganizationId(config);
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    if (organizationId) params.set('organizationId', organizationId);
    const url = `${wsBase}/api/ws?${params.toString()}`;

    this.clearReconnectTimer();
    const generation = ++this.connectionGeneration;
    this.intentionallyClosed = false;
    this.setState('connecting');
    if (this.connectionGeneration !== generation) return;

    // Every handler is guarded by a `this.ws === socket` identity check so a
    // superseded socket (manual close/reconnect) cannot mutate manager state
    // while its close event is still in flight.
    let socket: WebSocketLike;
    try {
      socket = new this.WebSocketImpl(url);
    } catch (error) {
      // A malformed URL or injected constructor can fail before onclose exists.
      // Leave explicit connect retryable rather than stuck in the setup guard.
      if (this.connectionGeneration === generation) this.setState('closed');
      throw error;
    }
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.reconnectBackoff.reset();
      this.lastServerActivity = Date.now();
      this.setState('open');
      if (this.connectionGeneration !== generation || this.ws !== socket) return;
      this.startHeartbeat();
      for (const streamId of this.streamHandlers.keys()) {
        this.send({ type: 'subscribe', streamId });
      }
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      this.lastServerActivity = Date.now();
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      this.dispatch(parsed as ReflexSocketMessage);
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.stopHeartbeat();
      this.setState('closed');
      if (this.connectionGeneration === generation && !this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    };

    socket.onerror = () => {
      // onclose fires after onerror and owns reconnection.
    };
  }

  /** Close the connection and stop reconnecting. Subscriptions are kept and replayed on the next `connect()`. */
  close(): void {
    ++this.connectionGeneration;
    this.intentionallyClosed = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    const socket = this.ws;
    this.ws = null;
    socket?.close();
    this.setState('closed');
  }

  /**
   * Subscribe to an agent's stream. Events (replayed history first, then
   * live) are delivered to `onEvent`. Returns an unsubscribe function; the
   * server-side subscription is dropped when the last handler for the
   * stream unsubscribes. Connects lazily on first subscription.
   */
  subscribe(streamId: string, onEvent: ReflexEventHandler): () => void {
    let handlers = this.streamHandlers.get(streamId);
    const isNewStream = !handlers;
    if (!handlers) {
      handlers = new Set();
      this.streamHandlers.set(streamId, handlers);
    }
    handlers.add(onEvent);

    if (!this.ws && !this.intentionallyClosed && this.reconnectTimer === null) this.connect();
    if (isNewStream) this.send({ type: 'subscribe', streamId });

    return () => {
      const set = this.streamHandlers.get(streamId);
      if (!set) return;
      set.delete(onEvent);
      if (set.size === 0) {
        this.streamHandlers.delete(streamId);
        this.send({ type: 'unsubscribe', streamId });
      }
    };
  }

  /**
   * Observe state transitions synchronously; registration does not emit the current state.
   * Same-state updates are ignored. A nested transition supersedes remaining
   * notifications for the older transition. Returns an unregister function.
   */
  onStateChange(handler: ReflexStateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  /**
   * Observe every server message (agent updates, acks, errors, ...) in
   * addition to per-stream event delivery. Returns an unregister function.
   */
  onMessage(handler: ReflexMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  private dispatch(message: ReflexSocketMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch {
        // A throwing observer must not break event delivery.
      }
    }
    if (message.type === 'event' && message.event) {
      const handlers = this.streamHandlers.get(message.event.streamId);
      if (!handlers) return;
      for (const handler of handlers) {
        try {
          handler(message.event);
        } catch {
          // A throwing handler must not break sibling handlers.
        }
      }
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Liveness loop: rebuild the connection when nothing has arrived for
   * three heartbeats (half-open socket), otherwise send an app-level ping
   * so the server's pong keeps the connection observably alive.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WS_OPEN) return;
      if (Date.now() - this.lastServerActivity > STALE_CONNECTION_THRESHOLD_MS) {
        this.rebuild();
        return;
      }
      this.send({ type: 'ping' });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Tear down the current socket and reconnect immediately (stale connection). */
  private rebuild(): void {
    const generation = ++this.connectionGeneration;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    const socket = this.ws;
    this.ws = null;
    socket?.close();
    this.reconnectBackoff.reset();
    this.setState('closed');
    if (this.connectionGeneration === generation) this.connect();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.intentionallyClosed || this.ws) return;
    const generation = this.connectionGeneration;
    this.reconnectTimer = setTimeout(() => {
      if (this.connectionGeneration !== generation || this.intentionallyClosed) return;
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectBackoff.nextDelayMs());
  }

  private setState(state: ReflexSocketState): void {
    if (this._state === state) return;
    this._state = state;
    const revision = ++this.stateRevision;
    for (const handler of this.stateHandlers) {
      if (this.stateRevision !== revision) break;
      try {
        handler(state);
      } catch {
        // Observers must not break state propagation.
      }
    }
  }
}
