/**
 * The arcade's live-update socket (`/api/ws`), shared app-wide through
 * context. Pages subscribe to typed frames (chat messages, suggestion and
 * game changes) pushed by the server; see `server/events.ts`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getToken } from './api.ts';
import type { ChatMessage, Game, Suggestion } from './api.ts';

export type ArcadeFrame =
  | { type: 'chat.message'; message: ChatMessage }
  | { type: 'suggestion'; suggestion: Suggestion }
  | { type: 'game'; game: Game }
  | { type: 'game.removed'; gameId: string }
  | { type: 'viewers'; gameId: string; count: number };

type FrameHandler = (frame: ArcadeFrame) => void;

interface ArcadeSocketValue {
  subscribe: (handler: FrameHandler) => () => void;
  /** Report which game view this client has open (null = none). */
  setWatching: (gameId: string | null) => void;
  /** How many times the socket has come back up. See {@link useArcadeReconnect}. */
  reconnects: number;
}

const ArcadeSocketContext = createContext<ArcadeSocketValue | null>(null);

const RECONNECT_DELAY_MS = 2_000;
const PING_INTERVAL_MS = 25_000;
/** The server closed with "going away": it is restarting for a deploy and its replacement is already serving, so reconnect without the usual delay. */
const GOING_AWAY = 1001;

export function ArcadeSocketProvider({ children }: { children: ReactNode }) {
  const handlers = useRef(new Set<FrameHandler>());
  const socketRef = useRef<WebSocket | null>(null);
  const watchingRef = useRef<string | null>(null);
  const connectedBeforeRef = useRef(false);
  // Bumped on every reconnect (not the first connect). Frames are fire and
  // forget — anything the server pushed while the socket was down is gone,
  // so views must re-read their state instead of trusting what they hold.
  const [reconnects, setReconnects] = useState(0);

  useEffect(() => {
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      // No token is a signed-out visitor on the landing page: the hub sends
      // it public frames only, so the shelf stays live before joining.
      const token = getToken();
      const query = token ? `?token=${encodeURIComponent(token)}` : '';
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${proto}://${location.host}/api/ws${query}`);
      socketRef.current = socket;
      socket.onopen = () => {
        // Re-announce presence after reconnects so viewer counts stay right.
        // `resume` tells the server this is the same viewer coming back, not
        // a new play — otherwise every deploy inflates the play counts.
        if (watchingRef.current) {
          socket.send(
            JSON.stringify({
              type: 'watch',
              gameId: watchingRef.current,
              resume: connectedBeforeRef.current,
            }),
          );
        }
        if (connectedBeforeRef.current) setReconnects((n) => n + 1);
        connectedBeforeRef.current = true;
      };
      socket.onmessage = (event) => {
        let frame: ArcadeFrame & { type: string };
        try {
          frame = JSON.parse(String(event.data)) as typeof frame;
        } catch {
          return;
        }
        if (
          frame.type === 'chat.message' ||
          frame.type === 'suggestion' ||
          frame.type === 'game' ||
          // Omitting this dropped every removal frame on the floor, so
          // viewers of a deleted game sat on a dead page.
          frame.type === 'game.removed' ||
          frame.type === 'viewers'
        ) {
          for (const handler of handlers.current) handler(frame);
        }
      };
      socket.onclose = (event?: CloseEvent) => {
        if (socketRef.current === socket) socketRef.current = null;
        if (closed) return;
        const delay = event?.code === GOING_AWAY ? 0 : RECONNECT_DELAY_MS;
        reconnectTimer = setTimeout(connect, delay);
      };
    };
    connect();

    const ping = setInterval(() => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, PING_INTERVAL_MS);

    return () => {
      closed = true;
      clearInterval(ping);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, []);

  const subscribe = useCallback((handler: FrameHandler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  const setWatching = useCallback((gameId: string | null) => {
    watchingRef.current = gameId;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'watch', gameId }));
    }
  }, []);

  const value = useMemo(
    () => ({ subscribe, setWatching, reconnects }),
    [subscribe, setWatching, reconnects],
  );
  return <ArcadeSocketContext.Provider value={value}>{children}</ArcadeSocketContext.Provider>;
}

/** Subscribe to live arcade frames for the lifetime of the component. */
export function useArcadeFrames(handler: FrameHandler): void {
  const ctx = useContext(ArcadeSocketContext);
  if (!ctx) throw new Error('useArcadeFrames must be used inside ArcadeSocketProvider.');
  // Latest-ref pattern: the subscription survives re-renders while frames
  // always reach the newest handler. The ref write happens in an effect —
  // frames are async, so a post-paint update is soon enough.
  const stable = useRef(handler);
  useEffect(() => {
    stable.current = handler;
  });
  useEffect(() => ctx.subscribe((frame) => stable.current(frame)), [ctx]);
}

/**
 * Run `onReconnect` each time the socket comes back after a drop — the
 * moment a view's state may silently be out of date, because frames pushed
 * during the gap were never delivered and are never replayed. Views pass
 * their initial fetch here so they re-read instead of trusting stale state
 * (a dispatched suggestion still sitting in "Up next", an agent stuck on
 * "idle"). This is a resync on a real connection event, not polling.
 *
 * Not fired for the first connect: the mount fetch already covers it.
 */
export function useArcadeReconnect(onReconnect: () => void): void {
  const ctx = useContext(ArcadeSocketContext);
  if (!ctx) throw new Error('useArcadeReconnect must be used inside ArcadeSocketProvider.');
  const stable = useRef(onReconnect);
  useEffect(() => {
    stable.current = onReconnect;
  });
  const { reconnects } = ctx;
  useEffect(() => {
    if (reconnects === 0) return;
    stable.current();
  }, [reconnects]);
}

/** Report game-view presence while the component is mounted. */
export function useWatchGame(gameId: string | null): void {
  const ctx = useContext(ArcadeSocketContext);
  if (!ctx) throw new Error('useWatchGame must be used inside ArcadeSocketProvider.');
  useEffect(() => {
    ctx.setWatching(gameId);
    return () => ctx.setWatching(null);
  }, [ctx, gameId]);
}
