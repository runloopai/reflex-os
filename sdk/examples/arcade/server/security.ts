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
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    const proto = req.headers['x-forwarded-proto'];
    const scheme = Array.isArray(proto) ? proto[0] : proto;
    if ((scheme ?? '').split(',')[0]?.trim() === 'https') {
      reply.header('strict-transport-security', `max-age=${HSTS_MAX_AGE}`);
    }
  });
}
