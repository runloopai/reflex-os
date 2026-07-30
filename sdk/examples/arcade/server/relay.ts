/**
 * WebSocket relay for the Reflex live stream.
 *
 * Browsers connect to `/reflex/:gameId/api/ws?token=<arcade token>` (the
 * URL `ReflexSocket` derives from the proxy baseUrl). After the same access
 * check as the HTTP proxy, we open one upstream socket per client to the
 * real Reflex `/api/ws` using the owner's key and pipe frames both ways.
 *
 * Client -> upstream frames are filtered to the protocol's read-only verbs
 * (`ping`, `subscribe`/`unsubscribe` for the game's own stream), so a
 * viewer can never address another stream even with a hand-rolled client.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import type { ArcadeDb } from './db.ts';
import { resolveGameAccess } from './proxy.ts';

const RELAY_PATH = /^\/reflex\/([^/]+)\/api\/ws$/;

export function createReflexRelay(db: ArcadeDb, reflexBaseUrl: string) {
  const wss = new WebSocketServer({ noServer: true });

  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://relay.local');
    const match = RELAY_PATH.exec(url.pathname);
    if (!match) return false;
    const gameId = match[1]!;
    const token = url.searchParams.get('token');

    const access = await resolveGameAccess(db, gameId, token);
    if ('error' in access) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    const key = await db.credsForGame(access.game);
    if (!key) {
      socket.write('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      const params = new URLSearchParams({ token: key.apiKey });
      if (key.org) params.set('organizationId', key.org);
      const upstreamUrl = `${reflexBaseUrl.replace(/^http/, 'ws')}/api/ws?${params.toString()}`;
      const upstream = new WebSocket(upstreamUrl);
      const streamId = access.game.agentStreamId;

      // ReflexSocket subscribes the moment its socket opens, which is
      // before our upstream connection exists — queue until it does.
      const queued: string[] = [];
      const sendUpstream = (frame: string) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(frame);
        else if (upstream.readyState === WebSocket.CONNECTING) queued.push(frame);
      };

      upstream.on('open', () => {
        for (const frame of queued.splice(0)) upstream.send(frame);
      });
      upstream.on('message', (raw) => {
        if (client.readyState === WebSocket.OPEN) client.send(String(raw));
      });
      upstream.on('close', () => client.close());
      upstream.on('error', () => client.close());

      client.on('message', (raw) => {
        let frame: { type?: string; streamId?: string };
        try {
          frame = JSON.parse(String(raw)) as typeof frame;
        } catch {
          return;
        }
        if (frame.type === 'ping') {
          sendUpstream(JSON.stringify({ type: 'ping' }));
          return;
        }
        if (
          (frame.type === 'subscribe' || frame.type === 'unsubscribe') &&
          frame.streamId === streamId
        ) {
          sendUpstream(JSON.stringify({ type: frame.type, streamId }));
        }
        // Anything else is dropped: the relay is read-only by construction.
      });
      client.on('close', () => upstream.close());
      client.on('error', () => upstream.close());
    });
    return true;
  }

  return { handleUpgrade };
}
