/**
 * Reflex Arcade server.
 *
 * One process serves the JSON API (`/api/*`), the arcade's live-update
 * WebSocket (`/api/ws`), the per-game Reflex proxy + relay (`/reflex/*`),
 * and — in production — the built web app. Data lives in an embedded
 * PGLite database under `.data/`.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config.ts';
import { ArcadeDb } from './db.ts';
import { EventHub, publicGame } from './events.ts';
import { GameEngine } from './engine.ts';
import { initReflex } from './reflex.ts';
import { registerRoutes } from './routes.ts';
import { registerReflexProxy } from './proxy.ts';
import { createReflexRelay } from './relay.ts';
import { gameIdFromPath, injectShareTags, isAppRoute, originFromRequest } from './share.ts';
import { cardOrArcade } from './share-card.ts';

const config = loadConfig();
initReflex(config.reflexBaseUrl);

const db = await ArcadeDb.open(config.dataDir);
const hub = new EventHub();
const engine = new GameEngine(db, hub, config.reflexBaseUrl);

// Presence: viewer counts fan out on every watch change, and opening a
// game view counts as a play (which also refreshes the game tiles).
hub.setWatchListener((prevGameId, nextGameId) => {
  void (async () => {
    for (const gameId of new Set([prevGameId, nextGameId])) {
      if (!gameId) continue;
      const game = await db.gameById(gameId);
      if (game) hub.broadcastViewers(game);
    }
    if (nextGameId && nextGameId !== prevGameId) {
      await db.incrementPlays(nextGameId);
      const game = await db.gameById(nextGameId);
      if (game) {
        const owner = await db.userById(game.ownerId);
        hub.gameChanged(publicGame(game, owner?.name ?? 'unknown', hub.viewerCount(game.id)));
      }
    }
  })().catch((err) => app.log.error({ err }, 'watch listener failed'));
});

// Body limit sized for agent messages carrying base64 attachment blocks.
const app = Fastify({ logger: { level: 'info' }, bodyLimit: 32 * 1024 * 1024 });

registerReflexProxy(app, db, config.reflexBaseUrl, (game, text) => {
  void (async () => {
    const updated = await db.updateGame(game.id, {
      currentTask: text,
      currentTaskKind: 'prompt',
    });
    if (updated) {
      const owner = await db.userById(updated.ownerId);
      hub.gameChanged(publicGame(updated, owner?.name ?? 'unknown', hub.viewerCount(updated.id)));
    }
    engine.poke(game.id, 'owner-prompt');
  })().catch((err) => app.log.error({ err }, 'owner prompt task failed'));
});
registerRoutes(app, { db, hub, engine, reflexAgentType: config.reflexAgentType });

const webDist = new URL('../web/dist', import.meta.url).pathname;
if (config.serveWeb && existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  const shell = await readFile(`${webDist}/index.html`, 'utf8');

  /**
   * Every app route is the same HTML file, so the share card has to be
   * written into it per request: a crawler reads the `<head>` and leaves
   * without running a line of the app. Dev does the same through the Vite
   * plugin in `web/og-dev-plugin.ts`, with these same functions.
   */
  const sendShell = async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = originFromRequest(req.headers);
    const card = await cardOrArcade(db, gameIdFromPath(req.raw.url ?? '/'), origin);
    const oembed = `${origin}/api/oembed?url=${encodeURIComponent(card.url)}`;
    return reply.type('text/html; charset=utf-8').send(injectShareTags(shell, card, oembed));
  };

  // A hook rather than a route: `/` is served by fastify-static's own
  // wildcard, so there is no route of ours to hang this on, and disabling
  // its index only makes it answer 403.
  app.addHook('onRequest', async (req, reply) => {
    if (isAppRoute(req.method, req.raw.url ?? '/')) return sendShell(req, reply);
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api') || req.raw.url?.startsWith('/reflex')) {
      return reply.status(404).send({ error: 'not_found', message: 'No such endpoint.' });
    }
    return reply.sendFile('index.html');
  });
}

await app.ready();

// WebSocket endpoints share the HTTP server: `/api/ws` is the arcade hub,
// `/reflex/:gameId/api/ws` relays the Reflex stream (see relay.ts).
const hubWss = new WebSocketServer({ noServer: true });
const relay = createReflexRelay(db, config.reflexBaseUrl);

app.server.on('upgrade', (req, socket, head) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://arcade.local');
    if (url.pathname === '/api/ws') {
      // A token is optional: the landing page browses public games signed
      // out and still wants live frames. A token that does not match a
      // player is rejected rather than silently downgraded to anonymous.
      const token = url.searchParams.get('token');
      const user = token ? await db.userByToken(token) : null;
      if (token && !user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      hubWss.handleUpgrade(req, socket, head, (ws) => hub.add(ws, user?.id ?? null));
      return;
    }
    if (await relay.handleUpgrade(req, socket, head)) return;
    socket.destroy();
  })().catch(() => socket.destroy());
});

await engine.resumeAll();
await app.listen({ port: config.port, host: config.host });
app.log.info(
  { reflex: config.reflexBaseUrl, agentType: config.reflexAgentType },
  'reflex arcade up',
);

// Snapshot the database every few minutes (and once at boot) so a corrupt
// data dir — unclean kills can break PGLite's WAL — restores automatically
// on the next start with at most a few minutes of loss.
const BACKUP_INTERVAL_MS = 5 * 60_000;
if (!config.dataDir.startsWith('memory:')) {
  const snapshot = () =>
    db.dumpTo(config.dataDir).catch((err) => app.log.warn({ err }, 'database snapshot failed'));
  void snapshot();
  setInterval(snapshot, BACKUP_INTERVAL_MS).unref();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    engine.stopAll();
    // app.close() waits for open sockets (hub clients, relays) and can hang
    // past the service manager's grace period — which escalates to SIGKILL
    // mid-write and corrupts PGLite. Close the database within a hard
    // deadline no matter what the HTTP side is doing.
    const deadline = setTimeout(() => {
      console.error('[arcade] shutdown deadline hit; exiting');
      process.exit(1);
    }, 8_000);
    void (async () => {
      await app.close().catch(() => {});
      await db.close().catch(() => {});
      clearTimeout(deadline);
      process.exit(0);
    })();
  });
}
