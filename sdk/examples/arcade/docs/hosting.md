# Hosting changes

Deep detail for the hosting workflow in [`../AGENTS.md`](../AGENTS.md).

## Shape of the deployment

The deployed arcade is one container (`Dockerfile`) plus a managed Postgres,
on Railway; the service settings live on the service, not in this repo
(Railway deprecated `railway.json`), and [`../README.md`](../README.md) lists
them. The build context is the REPO ROOT, not this directory: the server
imports `sdk/client/src` by relative path, and Node needs that package's
`package.json` alongside its sources or the `.ts` files load as CommonJS and
every named import fails.

## Nothing on disk survives a deploy

Anything new that has to outlive one — art, keys, uploads, pending connect
flows — goes in the database, not on disk or in process memory.
`DATABASE_URL` is refused-at-boot required in production for exactly that
reason: the disk fallback does not fail, it just loses everything at the next
release.

## Deploys overlap

The new container must pass the healthcheck before the old one gets SIGTERM,
so two arcades briefly run against one database. State that coordinates work
must coordinate through rows, not process memory — the dispatcher's working
slot is claimed per game in SQL (`claimSuggestionForDispatch`), and a watcher
that finds a dispatch it never staged adopts it instead of settling it. On
SIGTERM every hub and relay socket gets an orderly 1001 close so browsers
reconnect immediately onto the replacement; a reconnect's re-announced watch
carries `resume: true` so a deploy does not count as plays
(`tests/hub-watch.test.ts`).

## Rate limits and body size

`server/limits.ts` is the whole abuse policy, keyed by
`METHOD <route pattern>` — a typo there is a limit that silently never
applies, which is why `tests/limits.test.ts` checks every key against the
routes Fastify actually registered and lists the write routes deliberately
left out. The key is `req.ip`, which is only the caller's address when
`trustProxy` is set to the right hop COUNT (`config.ts`); `true` would let
anyone mint an identity per request with an `X-Forwarded-For` of their own.
The counters are per-process, so the deploy overlap above means both
containers grant a full budget for the minute they coexist — acceptable for a
limit sized to stop scripts, and the first thing to move into a row if it
ever is not.

Body size is Fastify's `bodyLimit`, never a `Content-Length` check: a chunked
request declares no length, and the caller picks the encoding. The small
limit is the server default and `/reflex/*` raises it per-route (a route's
limit beats a content-type parser's — the parser option there applied to
nothing for a while). Anything that authorizes inside its handler rather than
in front of it needs a rate-limit rule, because by the time it says no the
body is already read.

The hub socket sits in front of no HTTP hook at all, so a client frame that
costs a database write or a site-wide fan-out has to be metered in
`events.ts` itself — `watch` is budgeted per socket and counts a play once
per game. Any new client frame with a cost behind it needs the same.

## Serving bytes the arcade did not author

They go out under `UNTRUSTED_MEDIA_CSP` (`server/security.ts`), whoever wrote
them: agent art and player avatars are the same "SVG is a document, on our
origin, where the `ark_` token lives" hazard, and a new route serving stored
media is the same hazard again. Uploads are also narrowed to raster types at
the boundary — the header is what covers rows written before that rule.

Two CSPs live in `server/security.ts`, and they are not interchangeable: the
app's (`appCsp`) and the `sandbox` one every agent-authored byte is served
under. Art is written by an AGENT and served from this origin, so an SVG
navigated to directly would run script next to the player's token — sandbox
is what stops it, and filtering the markup is not an acceptable substitute.
Changing either means re-driving the app in a browser and reading the
console; `tests/security.test.ts` pins the headers, not what the app needs in
order to render.

## Health, caching, and crawlers

- `GET /api/health` is the platform's healthcheck and queries the database on
  purpose: a container that came up without one must fail the check rather
  than serve errors. Keep it unauthenticated and cheap.
- Caching is deny-by-default (`server/http-cache.ts`): every `/api` and
  `/reflex` response is `private, no-store` unless its handler names a
  policy, because most of them vary by bearer token on a fixed URL and this
  app is meant to sit behind a CDN. A route that opts into `CACHE.immutable`
  must have a version in its URL and must hand it back through `versioned()`
  — an immutable answer to a request with no `?v=` pins bytes that change.
  `tests/http-cache.test.ts` is the spec.
- Crawler-facing files live in `server/discovery.ts` (robots, sitemap, icons,
  manifest). The sitemap is the ONLY link graph this app has — the shelf is
  client-rendered — so a new public page belongs in it, and a private game
  must never be: `tests/discovery.test.ts` pins that. Anything added to the
  `<head>` by `share.ts` must also be removed by `stripShareTags`, or
  injecting twice leaves two of them and crawlers take the first.
