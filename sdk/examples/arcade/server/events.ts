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
}

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
 * `resumed` marks a watch that re-announces presence on a reconnect rather
 * than a viewer newly opening the game — the split that keeps a deploy
 * (every socket drops and re-announces at once) from counting as plays.
 */
type WatchListener = (
  prevGameId: string | null,
  nextGameId: string | null,
  resumed: boolean,
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

  add(socket: WebSocket, userId: string | null): void {
    const client: ArcadeClient = { socket, userId, watching: null };
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
          client.watching = next;
          this.watchListener?.(prev, next, parsed.resume === true);
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
