/**
 * Per-game Reflex proxy.
 *
 * The browser runs the real `@runloop/reflex-client` + `@runloop/reflex-ui`
 * configured with `baseUrl = <arcade origin>/reflex/<gameId>` and the
 * arcade login token as its "API key". Requests therefore arrive here as
 * `/reflex/:gameId/api/...` with `Authorization: Bearer ark_...`; we check
 * game access, swap in the owner's real Reflex credentials, and forward.
 *
 * Only the endpoints the chat pane needs are exposed, always scoped to the
 * game's own agent:
 *
 * - `GET  /agents/:agentId`          (owner + viewers of public games)
 * - `GET  /agents/:agentId/stream`   (owner + viewers of public games)
 * - `POST /agents/:agentId/message`  (owner only — viewers are read-only)
 *
 * The matching WebSocket relay lives in `relay.ts`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ArcadeDb, GameRow, UserRow } from './db.ts';

export interface GameAccess {
  user: UserRow;
  game: GameRow;
  isOwner: boolean;
}

/** Resolve the requesting user + game and enforce visibility. */
export async function resolveGameAccess(
  db: ArcadeDb,
  gameId: string,
  token: string | null,
): Promise<GameAccess | { error: string; status: number }> {
  if (!token) return { error: 'Sign in to view this game.', status: 401 };
  const user = await db.userByToken(token);
  if (!user) return { error: 'Unknown login token.', status: 401 };
  const game = await db.gameById(gameId);
  if (!game) return { error: 'Game not found.', status: 404 };
  const isOwner = game.ownerId === user.id;
  if (!isOwner && !game.isPublic) return { error: 'This game is private.', status: 403 };
  return { user, game, isOwner };
}

export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length) || null;
}

interface AllowedRoute {
  method: string;
  /** Builds the upstream path from the game's agent id, or null if the request path does not match. */
  match: (path: string, agentId: string) => boolean;
  ownerOnly: boolean;
}

/** Text of a SendAgentMessage body (string content or text blocks). */
export function promptText(rawBody: unknown): string | null {
  if (typeof rawBody !== 'string') return null;
  try {
    const parsed = JSON.parse(rawBody) as { content?: unknown; message?: unknown };
    // Text-only sends travel as `message`; attachment sends as `content`.
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim();
    const content = parsed.content;
    if (typeof content === 'string') return content.trim() || null;
    if (Array.isArray(content)) {
      const text = content
        .map((block) =>
          block && typeof block === 'object' && (block as { type?: string }).type === 'text'
            ? String((block as { text?: unknown }).text ?? '')
            : '',
        )
        .filter(Boolean)
        .join('\n')
        .trim();
      return text || null;
    }
  } catch {
    // Not JSON — nothing to surface.
  }
  return null;
}

const ALLOWED: AllowedRoute[] = [
  { method: 'GET', match: (p, a) => p === `/agents/${a}`, ownerOnly: false },
  { method: 'GET', match: (p, a) => p === `/agents/${a}/stream`, ownerOnly: false },
  { method: 'POST', match: (p, a) => p === `/agents/${a}/message`, ownerOnly: true },
  { method: 'POST', match: (p, a) => p === `/agents/${a}/interrupt`, ownerOnly: true },
];

export function registerReflexProxy(
  app: FastifyInstance,
  db: ArcadeDb,
  reflexBaseUrl: string,
  /** Called with the text of an owner prompt after Reflex accepts it. */
  onOwnerPrompt?: (game: GameRow, text: string) => void,
): void {
  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/reflex/:gameId/api/*',
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { gameId } = req.params as { gameId: string };
      const wildcard = (req.params as Record<string, string>)['*'] ?? '';
      const path = `/${wildcard}`;

      const access = await resolveGameAccess(db, gameId, bearerToken(req.headers.authorization));
      if ('error' in access) {
        return reply.status(access.status).send({ error: 'forbidden', message: access.error });
      }

      const route = ALLOWED.find(
        (r) => r.method === req.method && r.match(path, access.game.agentId),
      );
      if (!route || (route.ownerOnly && !access.isOwner)) {
        return reply
          .status(403)
          .send({ error: 'forbidden', message: 'Not available through the game proxy.' });
      }

      const key = await db.credsForGame(access.game);
      if (!key) {
        return reply
          .status(409)
          .send({ error: 'no_reflex_key', message: 'The game owner has no Reflex key on file.' });
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${key.apiKey}`,
      };
      if (key.org) headers['x-organization-id'] = key.org;
      const contentType = req.headers['content-type'];
      if (contentType) headers['content-type'] = contentType;

      const search = req.raw.url?.includes('?') ? `?${req.raw.url.split('?')[1]}` : '';
      let upstream: Response;
      try {
        upstream = await fetch(`${reflexBaseUrl}/api${path}${search}`, {
          method: req.method,
          headers,
          body: req.method === 'GET' ? undefined : (req.body as string | undefined),
        });
      } catch {
        return reply
          .status(502)
          .send({ error: 'reflex_unreachable', message: 'Could not reach the Reflex server.' });
      }

      // Surface owner prompts as the game's current task ("what is the
      // agent working on") once Reflex has accepted the message.
      if (upstream.ok && path === `/agents/${access.game.agentId}/message` && onOwnerPrompt) {
        const text = promptText(req.body);
        if (text) onOwnerPrompt(access.game, text);
      }

      const body = await upstream.arrayBuffer();
      return reply
        .status(upstream.status)
        .header('content-type', upstream.headers.get('content-type') ?? 'application/json')
        .send(Buffer.from(body));
    },
  });

  // Body parsing is skipped for proxied requests: register a passthrough
  // parser so Fastify hands us the raw text to forward.
  app.addContentTypeParser(
    'application/json',
    // Generous limit: agent messages may carry base64 image/file blocks.
    { parseAs: 'string', bodyLimit: 32 * 1024 * 1024 },
    (req, payload, done) => {
      if (req.url.startsWith('/reflex/')) {
        done(null, payload);
        return;
      }
      try {
        done(null, payload === '' ? undefined : JSON.parse(payload as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
}
