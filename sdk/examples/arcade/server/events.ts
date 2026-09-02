/**
 * The arcade's own live-update hub (distinct from the Reflex stream relay).
 *
 * Browsers connect to `/api/ws?token=...` — the token is optional, since
 * the landing page browses signed out — and receive JSON frames:
 *
 * - `{ type: 'chat.message', message }` — general chat
 * - `{ type: 'suggestion', suggestion }` — a suggestion changed
 * - `{ type: 'game', game }` — a game changed (status, daemon, visibility)
 *
 * Game and suggestion frames for private games go only to the owner's
 * sockets; everything else fans out to all connected users.
 */
import type { WebSocket } from 'ws';
import type { ChatMessageRow, GameRow, SuggestionRow } from './db.ts';

interface ArcadeClient {
  socket: WebSocket;
  /** null for a signed-out browser on the landing page. */
  userId: string | null;
  /** The game view this socket currently has open, for viewer counts. */
  watching: string | null;
  /** Games this socket has already been counted as playing; see below. */
  counted: Set<string>;
  /** Remaining watch changes this socket may announce in the current window. */
  watchBudget: number;
  watchWindowEndsAt: number;
}

/**
 * A socket may change which game it is watching this often before the
 * arcade stops listening to it.
 *
 * Nothing else on this socket is expensive, but a watch change is: it
 * broadcasts a viewer count to every connected client and touches the
 * database. The socket is also the one surface with no HTTP hook in front
 * of it, so a client alternating between two game ids is an unmetered
 * amplifier — one frame in, a write and a fan-out to the whole site out.
 * A person opening game after game does not come close to this.
 */
const WATCH_CHANGES_PER_WINDOW = 30;
const WATCH_WINDOW_MS = 10_000;

/**
 * How many distinct games one socket can be counted as playing. A real
 * session does not reach it; a script inventing ids would otherwise grow
 * this set for as long as it stayed connected.
 */
const MAX_COUNTED_GAMES = 200;

export interface PublicGame {
  id: string;
  ownerId: string;
  ownerName: string;
  /** Live sockets currently on this game's view. */
  viewers: number;
  /** Total times the game view has been opened. */
  plays: number;
  title: string;
  prompt: string;
  /** Safe to expose: the proxy only honors this agent id, with owner-gated writes. */
  agentId: string;
  agentType: string | null;
  model: string | null;
  status: GameRow['status'];
  agentStatus: string | null;
  isPublic: boolean;
  autoApprove: boolean;
  daemonUrl: string | null;
  /** Agent-authored art, served at /api/games/:id/art/:kind?v=artVersion. */
  hasPreview: boolean;
  hasIcon: boolean;
  /** A looping animated cover exists (shown on tile hover). */
  hasPreviewAnim: boolean;
  /**
   * Done-suggestion count. Filled by list/detail responses; live `game`
   * frames send null and clients keep their last known value.
   */
  shippedCount: number | null;
  artVersion: number;
  /** What the agent is working on right now, when known. */
  currentTask: string | null;
  currentTaskKind: 'suggestion' | 'prompt' | null;
  createdAt: string;
}

export function publicGame(
  game: GameRow,
  ownerName: string,
  viewers = 0,
  shippedCount: number | null = null,
): PublicGame {
  return {
    id: game.id,
    ownerId: game.ownerId,
    ownerName,
    viewers,
    plays: game.plays,
    title: game.title,
    prompt: game.prompt,
    agentId: game.agentId,
    agentType: game.agentType,
    model: game.model,
    status: game.status,
    agentStatus: game.agentStatus,
    isPublic: game.isPublic,
    autoApprove: game.autoApprove,
    daemonUrl: game.daemonUrl,
    hasPreview: game.previewArt !== null,
    hasIcon: game.iconArt !== null,
    hasPreviewAnim: game.previewAnimArt !== null,
    shippedCount,
    artVersion: game.artVersion,
    currentTask: game.currentTask,
    currentTaskKind: game.currentTaskKind,
    createdAt: game.createdAt,
  };
}

/**
 * Called when a socket moves between game views. `countPlay` says whether
 * this arrival is a new play, which two separate things can veto:
 *
 * - The client marked the watch `resume: true`, so it is a reconnect
 *   re-announcing where it already was. Without that split, a deploy —
 *   every socket dropping and re-announcing at once — reads as a rush of
 *   plays across the whole shelf.
 * - This socket has already been counted on this game. Opening a game is a
 *   play; flicking back and forth between two of them is one visit to each,
 *   not a counter to hold down.
 *
 * Neither subsumes the other: a reconnect arrives on a brand-new socket
 * that has counted nothing, and a flip-flopping client marks nothing as
 * resumed.
 */
type WatchListener = (
  prevGameId: string | null,
  nextGameId: string | null,
  countPlay: boolean,
) => void;

/** Close code for "server going away" — clients reconnect immediately on it. */
export const GOING_AWAY = 1001;

export class EventHub {
  private readonly clients = new Set<ArcadeClient>();
  private watchListener: WatchListener | null = null;

  /** Called whenever any socket starts or stops watching a game. */
  setWatchListener(listener: WatchListener): void {
    this.watchListener = listener;
  }

  /** Live sockets currently on a game's view. */
  viewerCount(gameId: string): number {
    let count = 0;
    for (const client of this.clients) if (client.watching === gameId) count++;
    return count;
  }

  add(socket: WebSocket, userId: string | null, now = Date.now()): void {
    const client: ArcadeClient = {
      socket,
      userId,
      watching: null,
      counted: new Set(),
      watchBudget: WATCH_CHANGES_PER_WINDOW,
      watchWindowEndsAt: now + WATCH_WINDOW_MS,
    };
    this.clients.add(client);
    const drop = () => {
      this.clients.delete(client);
      if (client.watching) {
        const prev = client.watching;
        client.watching = null;
        this.watchListener?.(prev, null, false);
      }
    };
    socket.on('close', drop);
    socket.on('error', drop);
    socket.on('message', (raw) => {
      // Client->server frames: keepalive pings and view presence.
      try {
        const parsed = JSON.parse(String(raw)) as {
          type?: string;
          gameId?: string | null;
          resume?: boolean;
        };
        if (parsed.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
        if (parsed.type === 'watch') {
          const next = typeof parsed.gameId === 'string' ? parsed.gameId : null;
          const prev = client.watching;
          if (prev === next) return;
          // The move itself is free and always applied, so this socket's own
          // view of where it is stays honest. What is budgeted is telling
          // everybody else about it.
          client.watching = next;
          if (!this.spendWatchBudget(client)) return;
          // Marked as counted either way: a resumed watch means this player
          // was already counted on the socket this one replaced, so coming
          // back to the same game later is still not a second play.
          const seen = next !== null && client.counted.has(next);
          if (next !== null && client.counted.size < MAX_COUNTED_GAMES) client.counted.add(next);
          this.watchListener?.(prev, next, next !== null && !seen && parsed.resume !== true);
        }
      } catch {
        // Ignore malformed frames.
      }
    });
  }

  /**
   * Deploy handoff: tell every browser to reconnect NOW instead of finding
   * out when the process dies. A 1001 close reaches the client as an orderly
   * frame it reconnects on immediately — straight onto the replacement
   * container — where an abrupt kill costs it the reconnect delay on top.
   */
  closeAll(): void {
    for (const client of this.clients) client.socket.close(GOING_AWAY, 'arcade restarting');
  }

  /** Whether this socket may announce another watch change right now. */
  private spendWatchBudget(client: ArcadeClient, now = Date.now()): boolean {
    if (now >= client.watchWindowEndsAt) {
      client.watchBudget = WATCH_CHANGES_PER_WINDOW;
      client.watchWindowEndsAt = now + WATCH_WINDOW_MS;
    }
    if (client.watchBudget <= 0) return false;
    client.watchBudget -= 1;
    return true;
  }

  private send(client: ArcadeClient, frame: Record<string, unknown>): void {
    if (client.socket.readyState === client.socket.OPEN) {
      client.socket.send(JSON.stringify(frame));
    }
  }

  private broadcast(frame: Record<string, unknown>, onlyUserId?: string): void {
    for (const client of this.clients) {
      // Owner-only frames never reach a signed-out client: its null userId
      // cannot equal an owner id, so private games stay private by default.
      if (onlyUserId && client.userId !== onlyUserId) continue;
      this.send(client, frame);
    }
  }

  /** Game-room chat: follows the game's visibility, like suggestions. */
  chatMessage(message: ChatMessageRow, game: GameRow): void {
    if (game.isPublic) this.broadcast({ type: 'chat.message', message });
    else this.broadcast({ type: 'chat.message', message }, game.ownerId);
  }

  /** A game was deleted; every client drops it (harmless if unknown). */
  gameRemoved(gameId: string): void {
    this.broadcast({ type: 'game.removed', gameId });
  }

  gameChanged(game: PublicGame): void {
    if (game.isPublic) this.broadcast({ type: 'game', game });
    else this.broadcast({ type: 'game', game }, game.ownerId);
  }

  /** Viewer-count frame, following the game's visibility. */
  broadcastViewers(game: GameRow): void {
    const frame = { type: 'viewers', gameId: game.id, count: this.viewerCount(game.id) };
    if (game.isPublic) this.broadcast(frame);
    else this.broadcast(frame, game.ownerId);
  }

  suggestionChanged(suggestion: SuggestionRow, game: GameRow): void {
    if (game.isPublic) this.broadcast({ type: 'suggestion', suggestion });
    else this.broadcast({ type: 'suggestion', suggestion }, game.ownerId);
  }
}
