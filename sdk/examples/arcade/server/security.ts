/**
 * The response headers that decide what a browser is allowed to do with
 * what the arcade hands it.
 *
 * The sharp edge is the art. Every game's cover, icon and animated preview
 * is authored by an AGENT, fetched off its dev server, and served back from
 * the arcade's own origin (`/api/games/:id/art/:kind`). SVG is not a picture
 * — it is a document, and a document served as `image/svg+xml` runs its own
 * `<script>` when someone navigates straight to it. On this origin that
 * script can read `localStorage`, where the player's `ark_` login token
 * lives: an agent that writes a hostile icon takes over the account of
 * anyone who opens it. Confirmed in a browser before this file existed.
 *
 * The fix is `sandbox`, not filtering. Stripping `<script>` from a hostile
 * SVG is a regex arms race; a sandboxed document simply cannot execute one,
 * and the declarative animation the agents actually use — SMIL and CSS —
 * keeps working, as does every `<img>` that embeds the art on a tile.
 */
import type { FastifyInstance } from 'fastify';

/**
 * For agent-authored bytes. `sandbox` with no `allow-scripts` is the whole
 * point; `default-src 'none'` stops the document reaching back out for
 * anything, and inline style stays because that is how SVG carries its own
 * animation.
 */
export const ART_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * The app's own policy, for the HTML shell.
 *
 * Written against what the build actually produces, not a template: Vite
 * emits one external module script, so `script-src 'self'` needs no
 * `unsafe-inline` — the JSON-LD block is data a browser never executes.
 * The rest is what this app genuinely does, and nothing more:
 *
 * - `style-src 'unsafe-inline'` — Tailwind is a file, but React style props
 *   and performative-ui's runtime CSS are inline, and there is no nonce to
 *   hand them through a static shell.
 * - `img-src data:` — avatars and captured art are stored as data URLs.
 * - `frame-src https:` — a game's iframe is its agent's dev server, on a
 *   devbox host nobody can enumerate in advance. Any https origin, never
 *   plain http, and never `*` (which would allow `data:` documents). The
 *   bundled mock serves its fake games over plain http on localhost, so an
 *   http Reflex origin adds itself — the offline stack is the one case
 *   where a game legitimately is not on https.
 * - `connect-src 'self'` covers the arcade's own WebSockets: same-origin
 *   `ws:`/`wss:` match `'self'` under CSP 3.
 * - `frame-ancestors 'none'` — an oEmbed embeds the GAME, never this app,
 *   so nothing legitimately frames the arcade.
 */
export function appCsp(reflexBaseUrl: string): string {
  const frames = ['https:'];
  // Only ever an origin, never a bare scheme: `http:` here would let any
  // plaintext page in the world frame itself into the arcade.
  if (reflexBaseUrl.startsWith('http://')) frames.push(new URL(reflexBaseUrl).origin);
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    `frame-src ${frames.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** A year, in seconds, for HSTS. */
const HSTS_MAX_AGE = 31_536_000;

/**
 * Headers every response gets.
 *
 * - `nosniff`: the art is served under the content type the agent's daemon
 *   claimed, so a browser must not go looking for a more interesting one.
 * - `Referrer-Policy`: a game URL is the capability to view that game
 *   (ids are unguessable and unlisted games rely on it). Sending the full
 *   URL to every host a game links out to would hand it away.
 * - HSTS only when the request actually arrived over TLS, so a local
 *   `http://localhost` run does not pin itself to https for a year.
 */
export function registerSecurityHeaders(app: FastifyInstance, reflexBaseUrl = ''): void {
  const csp = appCsp(reflexBaseUrl);
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    // Every HTML answer, not just the share-card shell: the static
    // `index.html` and the SPA fallback are the same app under a policy
    // that is only worth having if it has no way around it.
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html') && !reply.getHeader('content-security-policy')) {
      reply.header('content-security-policy', csp);
    }
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    const proto = req.headers['x-forwarded-proto'];
    const scheme = Array.isArray(proto) ? proto[0] : proto;
    if ((scheme ?? '').split(',')[0]?.trim() === 'https') {
      reply.header('strict-transport-security', `max-age=${HSTS_MAX_AGE}`);
    }
  });
}
