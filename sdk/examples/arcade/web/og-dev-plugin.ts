/**
 * Share cards in dev.
 *
 * In production the arcade server serves the built app and writes each
 * game's card into the HTML itself (`server/index.ts`). In dev, Vite is the
 * origin — and it is the one a tunnel points at, which is exactly the URL
 * anybody demoing this pastes into Slack. Without this, every dev link
 * unfurls as a bare hostname.
 *
 * So: intercept the HTML requests for `/g/:gameId`, ask the arcade API for
 * the card, and splice it in with the SAME functions the production path
 * uses. `server/share.ts` is pure (its only import is a type), so importing
 * it here costs nothing and keeps one definition of what a card says.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import {
  arcadeCard,
  gameIdFromPath,
  injectShareTags,
  isAppRoute,
  originFromRequest,
  type ShareCard,
} from '../server/share.ts';

/** The public origin the browser (or crawler) used, not Vite's own. */
function publicOrigin(req: IncomingMessage): string {
  return originFromRequest({
    'x-forwarded-host': req.headers['x-forwarded-host'] ?? req.headers.host,
    'x-forwarded-proto': req.headers['x-forwarded-proto'],
    host: req.headers.host,
  });
}

export function shareCardsInDev(apiOrigin: string): Plugin {
  return {
    name: 'arcade-share-cards-dev',
    apply: 'serve',
    configureServer(server) {
      // Registered here rather than in the returned post-hook so it runs
      // BEFORE Vite's own HTML middleware answers the route.
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '/';
        if (!isAppRoute(req.method ?? 'GET', url)) return next();
        const gameId = gameIdFromPath(url);

        void (async () => {
          const origin = publicOrigin(req);
          let card: ShareCard = arcadeCard(origin);
          try {
            // Forwarded headers, so the API builds absolute URLs on the
            // tunnel host a reader can actually reach — not on localhost.
            // Timed out because a wedged arcade server (as opposed to a
            // stopped one) would otherwise hang the page load forever:
            // this middleware owns the response until it answers.
            const answer = gameId
              ? await fetch(`${apiOrigin}/api/games/${gameId}/share`, {
                  signal: AbortSignal.timeout(2_000),
                  headers: {
                    'x-forwarded-host': new URL(origin).host,
                    'x-forwarded-proto': new URL(origin).protocol.replace(':', ''),
                  },
                })
              : null;
            if (answer?.ok) card = ((await answer.json()) as { share: ShareCard }).share;
          } catch {
            // Arcade server down, restarting, or wedged: the generic card
            // still unfurls, and the app itself is unaffected.
          }
          const shell = await readFile(path.join(server.config.root, 'index.html'), 'utf8');
          const html = await server.transformIndexHtml(url, shell, req.originalUrl);
          const oembed = `${origin}/api/oembed?url=${encodeURIComponent(card.url)}`;
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(injectShareTags(html, card, oembed));
        })().catch(next);
      });
    },
  };
}
