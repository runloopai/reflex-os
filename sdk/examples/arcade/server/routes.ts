/**
 * Arcade HTTP API: join/login, Reflex key management, games, suggestions,
 * and the general chat. All routes are JSON over `/api/*` and authenticate
 * with the arcade login token as a bearer header (the same value the web
 * app keeps in localStorage).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ArcadeDb, GameRow, UserRow } from './db.ts';
import { CACHE, versioned } from './http-cache.ts';
import { UNTRUSTED_MEDIA_CSP } from './security.ts';
import type { EventHub } from './events.ts';
import { publicGame } from './events.ts';
import type { GameEngine } from './engine.ts';
import {
  destroyAgentQuietly,
  buildGamePrompt,
  createGameAgent,
  fetchModelCatalog,
  fetchOrganizationsForKey,
  pollReflexConnect,
  startReflexConnect,
  validateCredentials,
  GAME_AGENT_SYSTEM_PROMPT,
  GAME_BRIEF_VERSION,
  type ReflexCredentials,
} from './reflex.ts';
import { ConnectStore } from './connect.ts';
import { bearerToken, resolveGameAccess } from './proxy.ts';
import { gameIdFromUrl, oEmbedFor, originFromRequest } from './share.ts';
import { gameShareCard } from './share-card.ts';
import { arcadeShareImage, decodeDataUrl, shareImageFor } from './og-image.ts';
import { avatarImage } from './avatar.ts';
// One list of share sources for both sides: the client tags links with it,
// the join route validates arrivals against it.
import { SHARE_SOURCES } from '../web/src/lib/share.ts';

interface RoutesDeps {
  db: ArcadeDb;
  hub: EventHub;
  engine: GameEngine;
  reflexAgentType: string;
}

function fail(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.status(status).send({ error, message });
}

/** Required non-empty string field with a length cap. */
function text(body: unknown, field: string, maxLength: number): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[field];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

/**
 * Raster formats only for an uploaded avatar — no SVG.
 *
 * An avatar is served back from this origin under its own content type
 * (`GET /api/users/:id/avatar`), and an SVG served that way is a document
 * that runs its own script. That route sandboxes what it serves, which is
 * the control that actually holds; this is the other half of it, because an
 * avatar has no use for a scriptable format in the first place. A picture of
 * a person is a raster, so accepting only rasters costs nobody anything and
 * means a hostile upload never reaches the database.
 */
const AVATAR_MEDIA_TYPES = /^data:image\/(png|jpeg|gif|webp);base64,/;

export function isAllowedAvatar(dataUrl: string): boolean {
  return AVATAR_MEDIA_TYPES.test(dataUrl);
}

function flag(body: unknown, field: string): boolean | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'boolean' ? value : undefined;
}

export function registerRoutes(app: FastifyInstance, deps: RoutesDeps): void {
  const { db, hub, engine } = deps;
  // Connect flows in flight, waiting on a player to approve them in Reflex.
  const connections = new ConnectStore(db);

  /**
   * Label a connected key by the org it acts in, so a player with several
   * sees which is which. The org lookup doubles as a check that the key
   * works, but must not sink the connection: a key we cannot name is still
   * a key Reflex minted and handed over exactly once, and dropping it here
   * would leave it live in their account with nothing pointing at it.
   */
  async function connectedKeyName(apiKey: string, organizationId: string): Promise<string> {
    const orgs = await fetchOrganizationsForKey(apiKey);
    if ('error' in orgs) return 'Reflex';
    const org = orgs.find((candidate) => candidate.id === organizationId);
    return org ? org.name.slice(0, 60) : 'Reflex';
  }

  async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<UserRow | null> {
    const token = bearerToken(req.headers.authorization);
    const user = token ? await db.userByToken(token) : null;
    if (!user) {
      await fail(reply, 401, 'unauthorized', 'Sign in first.');
      return null;
    }
    return user;
  }

  /** The signed-in user, or null — for routes the landing page reads signed out. */
  async function optionalUser(req: FastifyRequest): Promise<UserRow | null> {
    const token = bearerToken(req.headers.authorization);
    return token ? await db.userByToken(token) : null;
  }

  async function meShape(user: UserRow) {
    const keys = await db.keysForUser(user.id);
    const active = await db.activeKeyForUser(user);
    return {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      bio: user.bio,
      activeKeyId: active?.id ?? null,
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        org: key.org,
        preview: `rfx_...${key.apiKey.slice(-4)}`,
      })),
    };
  }

  // -- health -----------------------------------------------------------

  // What a platform healthcheck hits before it routes traffic at a new
  // deployment. It queries the database rather than answering from the
  // process, so a container that came up without a reachable one fails the
  // check instead of serving errors to players.
  app.get('/api/health', async (req, reply) => {
    try {
      await db.ping();
    } catch (err) {
      req.log.error({ err }, 'healthcheck could not reach the database');
      return fail(reply, 503, 'database_unavailable', 'The database is not reachable.');
    }
    return reply.send({ status: 'ok' });
  });

  // -- auth -------------------------------------------------------------

  app.post('/api/join', async (req, reply) => {
    const name = text(req.body, 'name', 40);
    if (!name) return fail(reply, 400, 'invalid_name', 'Pick a name (1-40 characters).');
    // `via` is the shared link they arrived through (`lib/referral.ts`).
    // Never trusted: the join route is unauthenticated, so anything but a
    // source one of our own links actually emits is dropped rather than
    // stored — otherwise a crafted `?utm_source=` invents a channel in the
    // arcade's own numbers.
    const via = text(req.body, 'via', 32);
    const user = await db.createUser(name, via && SHARE_SOURCES.includes(via) ? via : null);
    // The one place the attribution is visible without a query: an operator
    // watching the log sees which posts are actually returning people.
    req.log.info({ via: user.joinedVia }, 'player joined');
    return reply.send({ token: user.token, user: await meShape(user) });
  });

  // "Login" is presenting an existing token (e.g. pasted on another
  // device). There is no logout; the token in localStorage is the account.
  app.post('/api/login', async (req, reply) => {
    const token = text(req.body, 'token', 100);
    const user = token ? await db.userByToken(token) : null;
    if (!user) return fail(reply, 401, 'bad_token', 'That key does not match any player.');
    return reply.send({ token: user.token, user: await meShape(user) });
  });

  // Agent-authored art. Unauthenticated on purpose: <img> tags cannot send
  // the bearer token, and game ids are crypto-random (unlisted-link model).
  app.get('/api/games/:gameId/art/:kind', async (req, reply) => {
    const { gameId, kind } = req.params as { gameId: string; kind: string };
    if (kind !== 'preview' && kind !== 'icon' && kind !== 'preview-anim') {
      return reply.code(404).send();
    }
    const game = await db.gameById(gameId);
    const art =
      kind === 'preview'
        ? game?.previewArt
        : kind === 'preview-anim'
          ? game?.previewAnimArt
          : game?.iconArt;
    const decoded = art ? decodeDataUrl(art) : null;
    if (!game || !decoded) return reply.code(404).send({ message: 'No art yet.' });
    // Immutable only for the version that was asked for: art URLs carry
    // `?v=artVersion` (`web/src/lib/api.ts`), and a bare or stale one names
    // bytes that change under it.
    reply
      .header('content-type', decoded.mediaType)
      // These bytes were written by an agent and are served from the
      // arcade's own origin. Navigated to directly, an SVG is a document
      // that runs its own script — and could read the visitor's login
      // token out of localStorage. Sandboxed, it cannot (see security.ts).
      .header('content-security-policy', UNTRUSTED_MEDIA_CSP)
      .header('cache-control', versioned((req.query as { v?: string }).v, game.artVersion));
    return reply.send(decoded.bytes);
  });

  // -- share cards --------------------------------------------------------
  //
  // Everything an unfurl target needs, all unauthenticated: a crawler has
  // no account. Private games answer as if they did not exist, so a leaked
  // link unfurls as the arcade rather than as someone's private prompt.

  /**
   * The card as JSON, so anything that would rather ask than scrape can —
   * bots, bookmarklets, a Slack app of someone's own.
   */
  app.get('/api/games/:gameId/share', async (req, reply) => {
    const origin = originFromRequest(req.headers);
    const { gameId } = req.params as { gameId: string };
    const card = await gameShareCard(db, gameId, origin);
    if (!card) return fail(reply, 404, 'not_found', 'No shareable game here.');
    return reply.header('cache-control', CACHE.short).send({ share: card });
  });

  // The card image. Agents draw SVG covers and no unfurl target renders
  // SVG, so this is the rasterized one. The URL carries artVersion, so a
  // redrawn cover publishes a new URL and this one can be immutable.
  app.get('/api/games/:gameId/og-image', async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const game = await db.gameById(gameId);
    const isOwnCard = Boolean(game && game.isPublic);
    const image =
      isOwnCard && game
        ? shareImageFor({
            gameId: game.id,
            artVersion: game.artVersion,
            title: game.title,
            author: (await db.userById(game.ownerId))?.name ?? null,
            previewArt: game.previewArt,
          })
        : arcadeShareImage();
    return (
      reply
        .header('content-type', image.contentType)
        // Same rule as the art route, and only for the game's own card: the
        // stand-in a private game answers with must not outlive it going
        // public at the same artVersion.
        .header(
          'cache-control',
          isOwnCard && game
            ? versioned((req.query as { v?: string }).v, game.artVersion)
            : CACHE.short,
        )
        .send(image.body)
    );
  });

  /** The arcade's own card image, for `/` and anything unresolvable. */
  app.get('/api/share-image', async (_req, reply) => {
    const image = arcadeShareImage();
    return reply
      .header('content-type', image.contentType)
      .header('cache-control', CACHE.hour)
      .send(image.body);
  });

  /**
   * oEmbed discovery, linked from every game's `<head>`. Slack, Notion and
   * embed.ly prefer this over scraping, and a live game answers with the
   * game itself in an iframe — the link becomes playable where it lands.
   */
  app.get('/api/oembed', async (req, reply) => {
    const origin = originFromRequest(req.headers);
    const query = req.query as { url?: string; format?: string; maxwidth?: string };
    if (query.format && query.format !== 'json') {
      return fail(reply, 501, 'unsupported_format', 'Only JSON oEmbed is available.');
    }
    // Our own URLs only — an oEmbed provider that answers for any host is
    // a card renderer for somebody else's links.
    const gameId = gameIdFromUrl(query.url, origin);
    if (!gameId) return fail(reply, 404, 'not_found', 'Not an arcade game URL.');
    const card = await gameShareCard(db, gameId, origin);
    if (!card) return fail(reply, 404, 'not_found', 'No shareable game here.');
    const maxWidth = Number(query.maxwidth);
    return reply
      .header('cache-control', CACHE.short)
      .send(oEmbedFor(card, origin, Number.isFinite(maxWidth) ? maxWidth : undefined));
  });

  app.get('/api/me', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return reply.send({ user: await meShape(user) });
  });

  // Profile: name, bio, and a small data-URL avatar, shown in game chat.
  app.patch('/api/me', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = req.body as Record<string, unknown> | null;
    const patch: { name?: string; bio?: string; avatar?: string } = {};
    const name = text(req.body, 'name', 40);
    if (name) patch.name = name;
    if (typeof body?.bio === 'string') {
      const bio = body.bio.trim();
      if (bio.length > 200)
        return fail(reply, 400, 'bio_too_long', 'Keep the bio under 200 characters.');
      patch.bio = bio;
    }
    if (typeof body?.avatar === 'string') {
      const avatar = body.avatar.trim();
      // Only a NEW picture is checked. The profile form submits every field
      // it holds, including the avatar it loaded, so validating
      // unconditionally would lock anyone whose stored picture predates this
      // rule out of editing their own name — rejecting them for a value they
      // did not touch and cannot see. Keeping what is already there costs
      // nothing: the serve side sandboxes it either way.
      if (avatar && avatar !== user.avatar && !isAllowedAvatar(avatar)) {
        return fail(reply, 400, 'invalid_avatar', 'Avatars must be a PNG, JPEG, GIF or WebP.');
      }
      if (avatar.length > 96 * 1024) {
        return fail(reply, 400, 'avatar_too_large', 'Keep the avatar under ~64KB.');
      }
      patch.avatar = avatar;
    }
    await db.updateProfile(user.id, patch);
    return reply.send({ user: await meShape((await db.userById(user.id))!) });
  });

  // Public profile, for hover cards. Unauthenticated like the shelf it is
  // hovered from: signed-out visitors read owner names off the tiles on the
  // landing page, and this is that same name, avatar, and bio.
  app.get('/api/users/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const target = await db.userById(userId);
    if (!target) return fail(reply, 404, 'not_found', 'No such player.');
    return reply.send({
      user: { id: target.id, name: target.name, avatar: target.avatar, bio: target.bio },
    });
  });

  /**
   * A player's avatar as an image. Unauthenticated like the profile above,
   * and CORS-open on purpose: its audience is the GAME, which runs on the
   * agent's devbox under a foreign origin and is handed this URL so it can
   * show who is playing without asking them to type a name.
   *
   * Always answers with an image — the drawn initial chip when the player
   * uploaded nothing — so a game can point an <img> at it unconditionally.
   * `?v=` is the caller's cache key (the arcade appends a hash of the
   * profile); without one the answer is only briefly cacheable, since the
   * player may change their picture at any time.
   *
   * Sandboxed for the same reason the art route is: these bytes came from a
   * player, they are served from the arcade's own origin, and an SVG among
   * them navigated to directly is a document that could read the visitor's
   * login token out of localStorage. Uploads have been raster-only since
   * `isAllowedAvatar`, but rows written before that rule are still in the
   * database, and the header is what covers them (see security.ts).
   */
  app.get('/api/users/:userId/avatar', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const target = await db.userById(userId);
    if (!target) return fail(reply, 404, 'not_found', 'No such player.');
    const image = avatarImage(target);
    const versioned = typeof (req.query as { v?: unknown }).v === 'string';
    return reply
      .header('content-type', image.contentType)
      .header('content-security-policy', UNTRUSTED_MEDIA_CSP)
      .header('access-control-allow-origin', '*')
      .header(
        'cache-control',
        versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
      )
      .send(image.body);
  });

  // -- connect with reflex ------------------------------------------------
  //
  // The way most players get a key: the arcade starts Reflex's device
  // ("connect link") flow, sends the player to Reflex to approve it under
  // their own session, and receives a key Reflex minted for them, already
  // bound to the org they picked. The arcade never sees their password and
  // never asks them to paste a credential.
  //
  //   POST /api/me/reflex-connect              -> approval URL + user code
  //   POST /api/me/reflex-connect/:id/poll     -> pending | approved | ...
  //   DELETE /api/me/reflex-connect/:id        -> give up on the flow

  app.post('/api/me/reflex-connect', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    let started;
    try {
      started = await startReflexConnect();
    } catch (err) {
      req.log.error({ err }, 'starting the reflex connect flow failed');
      return fail(reply, 502, 'connect_failed', 'Could not reach Reflex to start the connection.');
    }
    const pending = await connections.start({
      userId: user.id,
      deviceCode: started.deviceCode,
      userCode: started.userCode,
      expiresIn: started.expiresIn,
    });
    // The device code stays here: it is the secret that claims the key.
    return reply.send({
      connectionId: pending.id,
      userCode: started.userCode,
      approveUrl: started.verificationUriComplete,
      interval: started.interval,
      expiresIn: started.expiresIn,
    });
  });

  app.post('/api/me/reflex-connect/:connectionId/poll', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { connectionId } = req.params as { connectionId: string };
    const pending = await connections.get(connectionId, user.id);
    if (!pending) {
      return fail(reply, 404, 'connect_expired', 'This connection expired. Start it again.');
    }

    let result;
    try {
      result = await pollReflexConnect(pending.deviceCode);
    } catch (err) {
      req.log.error({ err }, 'polling the reflex connect flow failed');
      return fail(reply, 502, 'connect_failed', 'Could not reach Reflex. Trying again shortly.');
    }
    if (result.status === 'pending') return reply.send({ status: 'pending' });

    // Every other answer ends the flow: the code is spent either way.
    await connections.delete(pending.id);
    if (result.status === 'denied') {
      return reply.send({ status: 'denied', message: 'You turned down the connection in Reflex.' });
    }
    if (result.status === 'expired') {
      return reply.send({ status: 'expired', message: 'This connection expired. Start it again.' });
    }

    // Approved. Reflex minted the key against the org the player chose, so
    // it arrives ready to launch with — no org picker, nothing to paste.
    const key = await db.createReflexKey({
      userId: user.id,
      name: await connectedKeyName(result.apiKey, result.organizationId),
      apiKey: result.apiKey,
      org: result.organizationId,
    });
    if (!user.activeKeyId) await db.setActiveKey(user.id, key.id);
    return reply.send({
      status: 'approved',
      keyId: key.id,
      user: await meShape((await db.userById(user.id))!),
    });
  });

  app.delete('/api/me/reflex-connect/:connectionId', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { connectionId } = req.params as { connectionId: string };
    // Own it or it is already gone; either way the player is left with no
    // flow in flight, which is what they asked for.
    const pending = await connections.get(connectionId, user.id);
    if (pending) await connections.delete(pending.id);
    return reply.send({ ok: true });
  });

  // -- reflex keys --------------------------------------------------------
  //
  // Keys are a user-level setting: connect (or paste) once, pick the org it
  // should act in (listed live from Reflex via the key itself), and mark one
  // key active. Game creation always uses the active key — never a
  // per-launch key.

  app.post('/api/me/reflex-keys', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const apiKey = text(req.body, 'apiKey', 200);
    if (!apiKey) return fail(reply, 400, 'invalid_key', 'Paste a Reflex API key (rfx_...).');
    const name = text(req.body, 'name', 60) ?? `key ...${apiKey.slice(-4)}`;

    // Validates the key and discovers its organizations in one call.
    const orgs = await fetchOrganizationsForKey(apiKey);
    if ('error' in orgs) return fail(reply, 400, 'key_rejected', orgs.error);

    // A single-org key needs no picker; otherwise the client PATCHes the
    // chosen org from the returned list.
    const org = orgs.length === 1 ? orgs[0]!.id : null;
    const key = await db.createReflexKey({ userId: user.id, name, apiKey, org });
    if (!user.activeKeyId) await db.setActiveKey(user.id, key.id);
    return reply.send({
      keyId: key.id,
      organizations: orgs,
      user: await meShape((await db.userById(user.id))!),
    });
  });

  app.get('/api/me/reflex-keys/:keyId/organizations', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { keyId } = req.params as { keyId: string };
    const key = await db.keyById(keyId);
    if (!key || key.userId !== user.id) return fail(reply, 404, 'not_found', 'No such key.');
    const orgs = await fetchOrganizationsForKey(key.apiKey);
    if ('error' in orgs) return fail(reply, 502, 'key_rejected', orgs.error);
    return reply.send({ organizations: orgs });
  });

  app.patch('/api/me/reflex-keys/:keyId', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { keyId } = req.params as { keyId: string };
    const key = await db.keyById(keyId);
    if (!key || key.userId !== user.id) return fail(reply, 404, 'not_found', 'No such key.');
    const org = text(req.body, 'organizationId', 100);
    if (!org) return fail(reply, 400, 'invalid_org', 'Pick an organization.');
    const problem = await validateCredentials({ apiKey: key.apiKey, org });
    if (problem) return fail(reply, 400, 'org_rejected', problem);
    await db.setKeyOrg(keyId, org);
    return reply.send({ user: await meShape(user) });
  });

  app.put('/api/me/active-key', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const keyId = text(req.body, 'keyId', 60);
    const key = keyId ? await db.keyById(keyId) : null;
    if (!key || key.userId !== user.id) return fail(reply, 404, 'not_found', 'No such key.');
    await db.setActiveKey(user.id, key.id);
    return reply.send({ user: await meShape((await db.userById(user.id))!) });
  });

  // Launch catalog (agent types, providers with key availability, models)
  // for the user's active key — the same data Reflex's own launch dialog
  // reads, via the SDK's getAgentModelSupport.
  app.get('/api/reflex/catalog', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const key = await db.activeKeyForUser(user);
    if (!key) return fail(reply, 409, 'no_reflex_key', 'Add a Reflex API key first.');
    if (!key.org) {
      return fail(reply, 409, 'no_org', 'Pick an organization for your Reflex key first.');
    }
    try {
      const catalog = await fetchModelCatalog({ apiKey: key.apiKey, org: key.org });
      return reply.send({ catalog });
    } catch (err) {
      req.log.error({ err }, 'fetching model catalog failed');
      return fail(reply, 502, 'catalog_failed', 'Could not load the launch catalog from Reflex.');
    }
  });

  app.delete('/api/me/reflex-keys/:keyId', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { keyId } = req.params as { keyId: string };
    const key = await db.keyById(keyId);
    if (!key || key.userId !== user.id) return fail(reply, 404, 'not_found', 'No such key.');
    const inUse = await db.countGamesUsingKey(keyId);
    if (inUse > 0) {
      return fail(
        reply,
        409,
        'key_in_use',
        `This key runs ${inUse} game(s); it cannot be removed.`,
      );
    }
    await db.deleteReflexKey(keyId);
    return reply.send({ user: await meShape(user) });
  });

  // -- games ------------------------------------------------------------

  app.post('/api/games', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const title = text(req.body, 'title', 60);
    const prompt = text(req.body, 'prompt', 2000);
    if (!title || !prompt) {
      return fail(reply, 400, 'invalid_game', 'A game needs a title and an idea.');
    }
    // The agent runs under the user's saved active key (a profile-level
    // setting), never a key supplied at launch time.
    const key = await db.activeKeyForUser(user);
    if (!key) {
      return fail(reply, 409, 'no_reflex_key', 'Add a Reflex API key before creating a game.');
    }
    if (!key.org) {
      return fail(reply, 409, 'no_org', 'Pick an organization for your Reflex key first.');
    }
    const agentType = text(req.body, 'agentType', 60) ?? deps.reflexAgentType;
    const model = text(req.body, 'model', 100);
    // A pinned model-provider key, passed straight through to Reflex.
    // Checked for shape, not for Reflex's exact id length: the arcade is not
    // the authority on that format, and pinning the length here would reject
    // valid ids the day Reflex changes it. Reflex validates properly.
    const providerKeyId = text(req.body, 'providerKeyId', 64);
    if (providerKeyId && !/^mps_[A-Za-z0-9]+$/.test(providerKeyId)) {
      return fail(reply, 400, 'invalid_provider_key', 'That is not a provider key id.');
    }
    const isPublic = flag(req.body, 'isPublic') ?? false;
    const autoApprove = flag(req.body, 'autoApprove') ?? false;

    const creds: ReflexCredentials = { apiKey: key.apiKey, org: key.org };
    let agent;
    try {
      agent = await createGameAgent(creds, {
        name: `arcade: ${title}`,
        prompt: buildGamePrompt(title, prompt),
        systemPrompt: GAME_AGENT_SYSTEM_PROMPT,
        agentType,
        model,
        providerSecretId: providerKeyId,
      });
    } catch (err) {
      req.log.error({ err }, 'creating game agent failed');
      const detail = err instanceof Error ? ` (${err.message})` : '';
      return fail(
        reply,
        502,
        'agent_create_failed',
        `Reflex could not start the game agent${detail}.`,
      );
    }

    const game = await db.createGame({
      ownerId: user.id,
      keyId: key.id,
      title,
      prompt,
      agentId: agent.id,
      agentStreamId: agent.streamId,
      agentType,
      model,
      isPublic,
      autoApprove,
      // Launched with the current rules in its system prompt, so it never
      // needs the catch-up appendix.
      briefVersion: GAME_BRIEF_VERSION,
    });
    await engine.ensureWatcher(game);
    hub.gameChanged(publicGame(game, user.name));
    return reply.send({ game: publicGame(game, user.name) });
  });

  // Unauthenticated on purpose: the landing page is the arcade's shop
  // window, so a visitor sees the public shelf before picking a name.
  // Signed out means public games only — `listedGamesFor` adds your own.
  app.get('/api/games', async (req, reply) => {
    const user = await optionalUser(req);
    const games = await db.listedGamesFor(user?.id ?? null);
    const shipped = await db.shippedCounts(games.map(({ game }) => game.id));
    return reply.send({
      games: games.map(({ game, ownerName }) =>
        publicGame(game, ownerName, hub.viewerCount(game.id), shipped[game.id] ?? 0),
      ),
    });
  });

  app.get('/api/games/:gameId', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { gameId } = req.params as { gameId: string };
    const access = await resolveGameAccess(db, gameId, user.token);
    if ('error' in access) return fail(reply, access.status, 'forbidden', access.error);
    const owner = await db.userById(access.game.ownerId);
    const shipped = await db.shippedCounts([access.game.id]);
    return reply.send({
      game: publicGame(
        access.game,
        owner?.name ?? 'unknown',
        hub.viewerCount(access.game.id),
        shipped[access.game.id] ?? 0,
      ),
      role: access.isOwner ? 'owner' : 'viewer',
    });
  });

  // Owner-only: delete a game (stops its agent best-effort, drops the
  // watcher, cascades suggestions/hearts/chat, tells every client).
  app.delete('/api/games/:gameId', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { gameId } = req.params as { gameId: string };
    const game = await db.gameById(gameId);
    if (!game) return reply.code(404).send({ message: 'No such game.' });
    if (game.ownerId !== user.id) {
      return reply.code(403).send({ message: 'Only the owner can delete a game.' });
    }
    engine.dropWatcher(game.id);
    const key = await db.credsForGame(game);
    if (key) await destroyAgentQuietly({ apiKey: key.apiKey, org: key.org }, game.agentId);
    await db.deleteGame(game.id);
    hub.gameRemoved(game.id);
    return { ok: true };
  });

  app.patch('/api/games/:gameId', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { gameId } = req.params as { gameId: string };
    const game = await db.gameById(gameId);
    if (!game) return fail(reply, 404, 'not_found', 'Game not found.');
    if (game.ownerId !== user.id) {
      return fail(reply, 403, 'forbidden', 'Only the owner can change game settings.');
    }
    const updated = await db.updateGame(gameId, {
      isPublic: flag(req.body, 'isPublic'),
      autoApprove: flag(req.body, 'autoApprove'),
    });
    if (!updated) return fail(reply, 404, 'not_found', 'Game not found.');
    hub.gameChanged(publicGame(updated, user.name));
    return reply.send({ game: publicGame(updated, user.name) });
  });

  // -- suggestions --------------------------------------------------------

  async function gameForSuggestion(
    req: FastifyRequest,
    reply: FastifyReply,
    user: UserRow,
  ): Promise<{ game: GameRow; isOwner: boolean } | null> {
    const { gameId } = req.params as { gameId: string };
    const access = await resolveGameAccess(db, gameId, user.token);
    if ('error' in access) {
      await fail(reply, access.status, 'forbidden', access.error);
      return null;
    }
    return { game: access.game, isOwner: access.isOwner };
  }

  app.get('/api/games/:gameId/suggestions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const ctx = await gameForSuggestion(req, reply, user);
    if (!ctx) return;
    return reply.send({ suggestions: await db.suggestionsForGame(ctx.game.id, user.id) });
  });

  app.post('/api/games/:gameId/suggestions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const ctx = await gameForSuggestion(req, reply, user);
    if (!ctx) return;
    const body = text(req.body, 'body', 500);
    if (!body) return fail(reply, 400, 'invalid_suggestion', 'Write a suggestion first.');
    const rawCategory = text(req.body, 'category', 20) ?? 'improvement';
    const category =
      rawCategory === 'bug' || rawCategory === 'feature' || rawCategory === 'improvement'
        ? rawCategory
        : 'improvement';
    const suggestion = await db.createSuggestion({
      gameId: ctx.game.id,
      authorId: user.id,
      body,
      category,
      status: ctx.game.autoApprove ? 'approved' : 'pending',
    });
    hub.suggestionChanged(suggestion, ctx.game);
    if (suggestion.status === 'approved') engine.poke(ctx.game.id, 'suggestion-auto-approved');
    return reply.send({ suggestion });
  });

  /**
   * Authors rewrite their own suggestions until the agent has them.
   * `pending` and `approved` are the pre-dispatch statuses; once a
   * suggestion is `working` the text is already in the agent's transcript,
   * and `done`/`rejected` are history. The status guard lives in the
   * UPDATE itself, so an edit racing the dispatcher's claim loses cleanly
   * instead of rewriting work already sent.
   */
  app.patch('/api/games/:gameId/suggestions/:suggestionId', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const ctx = await gameForSuggestion(req, reply, user);
    if (!ctx) return;
    const { suggestionId } = req.params as { suggestionId: string };
    const existing = await db.suggestionById(suggestionId);
    if (!existing || existing.gameId !== ctx.game.id) {
      return fail(reply, 404, 'not_found', 'Suggestion not found.');
    }
    if (existing.authorId !== user.id) {
      return fail(reply, 403, 'forbidden', 'Only the author can edit a suggestion.');
    }
    const body = text(req.body, 'body', 500);
    if (!body) return fail(reply, 400, 'invalid_suggestion', 'A suggestion needs some text.');
    const rawCategory = text(req.body, 'category', 20) ?? existing.category;
    const category =
      rawCategory === 'bug' || rawCategory === 'feature' || rawCategory === 'improvement'
        ? rawCategory
        : existing.category;
    const suggestion = await db.editSuggestion(suggestionId, { body, category }, [
      'pending',
      'approved',
    ]);
    if (!suggestion) {
      return fail(
        reply,
        409,
        'already_sent',
        'The agent already has this suggestion, so it can no longer be edited.',
      );
    }
    hub.suggestionChanged(suggestion, ctx.game);
    return reply.send({ suggestion });
  });

  // Anyone with access can heart a suggestion; the dispatcher works the
  // most-hearted approved suggestion first, so hearts steer the agent.
  app.post('/api/games/:gameId/suggestions/:suggestionId/heart', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const ctx = await gameForSuggestion(req, reply, user);
    if (!ctx) return;
    const { suggestionId } = req.params as { suggestionId: string };
    const existing = await db.suggestionById(suggestionId);
    if (!existing || existing.gameId !== ctx.game.id) {
      return fail(reply, 404, 'not_found', 'Suggestion not found.');
    }
    const hearted = await db.toggleHeart(suggestionId, user.id);
    const suggestion = (await db.suggestionById(suggestionId))!;
    hub.suggestionChanged(suggestion, ctx.game);
    return reply.send({ suggestion, hearted });
  });

  app.post('/api/games/:gameId/suggestions/:suggestionId/approve', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const ctx = await gameForSuggestion(req, reply, user);
    if (!ctx) return;
    if (!ctx.isOwner) return fail(reply, 403, 'forbidden', 'Only the owner approves suggestions.');
    const { suggestionId } = req.params as { suggestionId: string };
    const existing = await db.suggestionById(suggestionId);
    if (!existing || existing.gameId !== ctx.game.id) {
      return fail(reply, 404, 'not_found', 'Suggestion not found.');
    }
    // Guarded transition: approving is atomic against racing writers.
    const suggestion = await db.setSuggestionStatus(suggestionId, 'approved', ['pending']);
    if (!suggestion) {
      return fail(reply, 409, 'not_pending', 'Only pending suggestions can be approved.');
    }
    hub.suggestionChanged(suggestion, ctx.game);
    engine.poke(ctx.game.id, 'suggestion-approved');
    return reply.send({ suggestion });
  });

  app.post('/api/games/:gameId/suggestions/:suggestionId/reject', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const ctx = await gameForSuggestion(req, reply, user);
    if (!ctx) return;
    if (!ctx.isOwner) return fail(reply, 403, 'forbidden', 'Only the owner rejects suggestions.');
    const { suggestionId } = req.params as { suggestionId: string };
    const existing = await db.suggestionById(suggestionId);
    if (!existing || existing.gameId !== ctx.game.id) {
      return fail(reply, 404, 'not_found', 'Suggestion not found.');
    }
    // An optional reason travels with the rejection as the owner's note.
    const rawReason = (req.body as Record<string, unknown> | null)?.reason;
    if (rawReason !== undefined && typeof rawReason !== 'string') {
      return fail(reply, 400, 'invalid_reason', 'The reason must be text.');
    }
    const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
    if (reason.length > 500) {
      return fail(reply, 400, 'reason_too_long', 'Keep the reason under 500 characters.');
    }
    // Guarded transition: if the dispatcher claimed it first, reject fails
    // instead of yanking a suggestion whose turn is already being sent.
    const rejected = await db.setSuggestionStatus(suggestionId, 'rejected', [
      'pending',
      'approved',
    ]);
    if (!rejected) {
      return fail(reply, 409, 'not_rejectable', 'This suggestion is already being worked on.');
    }
    const suggestion = reason
      ? ((await db.setSuggestionNote(suggestionId, reason)) ?? rejected)
      : rejected;
    hub.suggestionChanged(suggestion, ctx.game);
    return reply.send({ suggestion });
  });

  // Owner-only: leave, edit, or clear a public note on a suggestion. Works
  // in any status; an empty note clears it. Queued notes also reach the
  // agent when the suggestion is dispatched.
  app.put('/api/games/:gameId/suggestions/:suggestionId/note', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const ctx = await gameForSuggestion(req, reply, user);
    if (!ctx) return;
    if (!ctx.isOwner) return fail(reply, 403, 'forbidden', 'Only the owner leaves notes.');
    const { suggestionId } = req.params as { suggestionId: string };
    const existing = await db.suggestionById(suggestionId);
    if (!existing || existing.gameId !== ctx.game.id) {
      return fail(reply, 404, 'not_found', 'Suggestion not found.');
    }
    const raw = (req.body as Record<string, unknown> | null)?.note;
    if (typeof raw !== 'string') return fail(reply, 400, 'invalid_note', 'The note must be text.');
    const note = raw.trim();
    if (note.length > 500) {
      return fail(reply, 400, 'note_too_long', 'Keep the note under 500 characters.');
    }
    const suggestion = (await db.setSuggestionNote(suggestionId, note || null))!;
    hub.suggestionChanged(suggestion, ctx.game);
    return reply.send({ suggestion });
  });

  // -- game chat ----------------------------------------------------------
  //
  // Every game is a chat room for the people watching it (Twitch-style).
  // Access follows the game: the owner always, viewers when it is public.

  app.get('/api/games/:gameId/chat', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const ctx = await gameForSuggestion(req, reply, user);
    if (!ctx) return;
    return reply.send({ messages: await db.recentChatMessages(ctx.game.id) });
  });

  app.post('/api/games/:gameId/chat', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const ctx = await gameForSuggestion(req, reply, user);
    if (!ctx) return;
    const body = text(req.body, 'body', 500);
    if (!body) return fail(reply, 400, 'invalid_message', 'Write a message first.');
    const message = await db.createChatMessage(ctx.game.id, user.id, body);
    hub.chatMessage(message, ctx.game);
    return reply.send({ message });
  });
}
