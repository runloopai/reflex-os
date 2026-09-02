# Agent Guide - Reflex Arcade (sdk/examples/arcade)

Standalone demo app: Reflex agents build games live, Twitch-style — agent
transcript + suggestions next to an iframe of the game's dev server. This
file is a map, not a manual: classify your change, follow the matching
workflow, and verify at the right tier. Run modes, ports, and daemon setup
live in [`README.md`](README.md).

## The One Structural Rule

This package is deliberately OUTSIDE the pnpm workspace, turbo graph, and
repo CI. It has its own npm lockfile and node_modules. It lives at
`sdk/examples/arcade` precisely because the workspace glob is `sdk/*`
(direct children only) — nesting one level deeper keeps it an SDK example
without joining the build system. Never add it to workspace globs, turbo
pipelines, or CI jobs, and never import internal `@reflex/*` workspace
packages — the SDK is consumed from source via the aliases in
`web/vite.config.ts` (`@runloop/reflex-client` only).

The cost of that rule: nothing on main runs these checks. Two PRs that are
each green can still break main together — one widens a type, the other
adds a fixture, neither file conflicts. After main moves under you, re-run
`npm run typecheck` here before assuming your branch is fine.

## Operating Loop

1. Classify the change: server/db, web/UI, SDK-consumption, or docs.
2. Follow the matching workflow below.
3. Verify at the tier the change demands (unit → stories → smoke → live).
4. For anything visual: take screenshots and actually read them — judge the
   result against "clean, sleek, a little fun", don't assume.
5. `npm run typecheck`, `npm run lint`, and `npm run format` before
   finalizing — the demo owns its own prettier (with tailwind class sorting)
   and ESLint config; the repo root's turbo `format`/`lint` do not cover it.

## Repo Map

- `server/` - Fastify + Postgres: auth, games, suggestions (hearts,
  categories, owner notes), chat, the per-game Reflex proxy/relay, and the
  watcher/dispatcher that feeds idle agents the most-hearted suggestion.
  `server/sql.ts` picks the store — a Postgres server when `DATABASE_URL` is
  set, else an embedded PGLite data dir.
- `web/` - React 19 + Vite + Tailwind 4 + performative-ui. The agent chat
  under `web/src/{components,hooks,lib}/reflex/` is scaffolded
  @runloop/reflex-chat-kit output, customized in place.
- `mock-reflex/` - offline stand-in for the Reflex API (`npm run dev:mock`).
- `web/src/lib/game-timeline.ts` - pure merge of the agent's event stream
  with the arcade's suggestion rows behind `/g/:gameId/timeline`. Prompt
  shapes are a contract with `server/reflex.ts` (`suggestionPrompt`,
  `hostFixPrompt`): change one and the timeline mis-files entries, so the
  parsing is pinned in `tests/game-timeline.test.ts`.
- `web/src/lib/game-frame.ts` - the player the arcade appends to the game's
  frame URL (`arcade_player`, `arcade_player_id`, `arcade_avatar`,
  `arcade_role`), so no game has to ask for a name. The parameter names are
  a contract with `GAME_AGENT_SYSTEM_PROMPT`, pinned in
  `tests/suggestion-prompt.test.ts`; the avatar is served as an image by
  `server/avatar.ts` because a 64KB data URL cannot travel in a URL. It is
  display data, not a credential — never put a token in it.
- `stories/` + `tests/` - ALL stories and tests live here, outside the src
  dirs. `tests/fixtures.ts` has the shared builders.
- `.storybook/` - Storybook 10 config; stories run as tests via
  @storybook/addon-vitest in headless Chromium.
- `scripts/shots.mjs` - screenshots the key screens into `shots/`
  (gitignored) for visual judging.

## Workflows

### Server and database changes

- The schema lives in `SCHEMA` in `server/db.ts`; it is re-exec'd on boot,
  so additive DDL only (`if not exists`), plus a one-time migration helper
  when a column moves. On a hosted arcade that boot also runs against data
  someone else is using — an `alter` that rewrites a table blocks every
  reader while it does.
- Queries go through `SqlDriver` (`server/sql.ts`) and must work on BOTH
  drivers: plain Postgres SQL, `$n` parameters, no PGLite-only API. PGLite
  and node-postgres are different clients, so "it passed on PGLite" is not
  evidence — run `tests/postgres-store.test.ts` with
  `ARCADE_TEST_DATABASE_URL` pointed at a throwaway database (see README)
  before shipping a query change.
- `tests/db.test.ts` is the spec for dispatch ordering (hearts desc, then
  approval FIFO) and the guarded status transitions (dispatch claims) —
  extend it for any queue/hearts behavior change. `tests/engine-flags.test.ts`
  is the spec for the stream-replay guard against double dispatch and for
  `runningRecordIsStale`, the rule that decides when a `running` record may
  be overridden. Whether a turn is in flight is the STREAM's call
  (`deriveAgentStatus` / `reduceAgentLiveness`), never a silence timer:
  agents go quiet for many minutes during long builds, and treating that as
  a stall re-sends the suggestion into a turn that never stopped.
- Check: `npm run test:unit`, then the smoke test for flow changes.
- Daemons run plain `tsx` (no watch): restart `arcade-server` after edits,
  and kill the old port-holder first (EADDRINUSE). Never kill it mid-write —
  PGLite corrupts; stop cleanly or wipe `.data/`.

### Web and UI changes

- Components get a story in `stories/` with a `play` function — Storybook
  tests are the component test surface. Connected components (socket/api
  wired) are covered by the smoke test instead; keep new components
  presentational where possible so they stay storyable.
- Check: `npm test` (unit + stories), then `npm run shots` against a running
  stack and READ the images. A change isn't "looking good" until you've seen
  it; compare against the previous shots when in doubt.
- View state that says WHERE you are — the game view's panel, whether the
  phone's room sheet is over the game, a shelf's sort — belongs in the query
  string via `useUrlState`, not in `useState`. Otherwise a refresh silently
  moves you and a shared link opens on a different screen. Defaults are never
  written (`urlParam` owns that rule), so URLs stay clean, and unknown values
  fall back instead of rendering nothing. Two params that move together go
  through `useUrlPatch`; two setters in one handler drop the first write.
- Fullscreen is two features, not one (`web/src/lib/fullscreen.ts`,
  `hooks/useFullscreen.ts`): the Fullscreen API removes the BROWSER's chrome
  and only it can, while the nav, sidebar and dock are removed by the
  `.stage-immersive` CSS. iPhone Safari has no element fullscreen at all, so
  the CSS half must stand alone — and the mode stays out of the URL because a
  request needs a user gesture, so a restored `?fullscreen=1` cannot be
  honoured on load.
- Look: dark zinc base, neon violet/fuchsia accents, glass borders
  (`border-white/10 bg-zinc-900/50`), performative-ui for the pizzazz
  (Aurora, AsciiHero, GradientText, WordRoll, StatCounter, BigBack). Sleek
  first, fun second, never busy — put a scrim under copy that sits on
  animated backgrounds.
- Mobile is a first-class target: people play the games and suggest from
  phones. Below `lg` the stream view is the game, full screen — the app nav
  hides itself, and chat / agent / suggestions open over the game as sheets
  from `PanelDock`. Five rules the layout depends on — (1) one React tree at
  both breakpoints (the sheet and the sidebar are the same `aside` under
  `max-lg:`/`lg:`), so rotating a phone never remounts a live transcript;
  (2) size touch targets with `pointer-coarse:`, never viewport width,
  because a landscape phone is 750px wide and still a thumb; (3) composers
  are 16px on coarse pointers or iOS zooms the page on focus and strands
  them behind the keyboard; (4) the game view's header density comes from
  the STAGE's measured width (`stageDensity`), not the viewport — a dragged
  sidebar can leave the stage under 300px on a laptop; (5) collapsing the
  sidebar is a desktop preference applied in CSS, so a phone that inherited
  it from localStorage still gets the room; (6) viewport heights are `dvh`,
  never `vh` — on iOS `100vh` is the LARGE viewport, so a `vh` box around a
  `dvh` one is taller than the screen by the browser toolbars and leaves a
  strip of background below the dock that scrolls into view. Rows that touch
  a screen edge wear `safe-x`. Check phone portrait AND landscape before
  calling it done — and on a real iPhone, where Chromium cannot help you:
  headless `dvh` and `vh` are the same number.
- Tailwind v4 trap: performative-ui ships UNLAYERED CSS, which beats
  Tailwind's layered utilities. Positional overrides on pui components
  (`position`, `inset`) must be inline `style={{...}}`, or they silently
  no-op (collapsed AsciiHero canvas, aurora stretching the page).

### SDK-consumption changes

- The agent chat pane is chat-kit output: improvements to chat behavior go
  into `sdk/chat-kit/registry/` FIRST (then `pnpm --filter
@runloop/reflex-ui sync`), never forked locally here.
- Agent/model/org pickers are driven by real client routes
  (`getAgentModelSupport`, `getOrganizations`,
  `listAccessibleModelProviderSecrets`) — if data is missing, add it to the
  public API + client, don't hardcode. Provider-key display mirrors Reflex's
  `ModelProviderSecretPicker`: resolution lives in `web/src/lib/provider-keys.ts`,
  rendering in `ProviderKeyList`, and only key metadata (never secret
  material) crosses into the arcade.
- The shop window is public: `/` and `/about` render with no account, and
  the routes that need one gate themselves (`gate(...)` in `App.tsx`) rather
  than the shell replacing the whole app. Anything a signed-out browser can
  reach — `GET /api/games`, hover-card profiles, the hub socket — filters to
  public data on the SERVER; the hub pushes such a client public frames only,
  because a null user id can never match an owner id
  (`tests/hub-anonymous.test.ts`). A token the server rejects is dropped, not
  kept: a stale one left in localStorage makes the socket reconnect forever.
- Share cards are SERVER-rendered, and they are the only part of this app a
  crawler ever sees: Slack, X and LinkedIn fetch the URL, read the `<head>`,
  and leave without running the SPA. `server/share.ts` is the single
  definition — production splices it in `server/index.ts`, dev in
  `web/og-dev-plugin.ts` (dev is what a demo tunnel points at, so it cannot
  be skipped). Adding a default tag to `web/index.html` means teaching
  `stripShareTags` to remove it, or every game unfurls as the generic card:
  faced with two `og:title`s, crawlers take the first. Covers rasterize to
  PNG because no unfurl target renders SVG, and a private game has no card.
- Reflex API keys are saved on the USER (active key), never entered per
  game. Owner `rfx_` keys live only in the arcade's database — they must
  never reach a browser, a fixture, or git. Browsers talk to Reflex only
  through the per-game proxy/relay.
- "Connect with Reflex" is Reflex's own device flow, not an arcade
  endpoint: `server/reflex.ts` starts it with `clientName`, `server/connect.ts`
  holds the pending device codes (server-side only, per player, TTL'd), and
  the browser drives it through `web/src/lib/connect.ts`. Two rules the
  design rests on — the device code and the minted key never reach a
  browser, and a poll only ever resolves for the player who started it.
  Extend the flow here; only reach into base Reflex if the gap is generic
  (the `clientName` label was), never with an arcade-shaped route.

### Hosting changes

- The deployed arcade is one container (`Dockerfile`) plus a managed
  Postgres, on Railway; the service settings live on the service, not in this
  repo (Railway deprecated `railway.json`), and README lists them. The build
  context is the REPO ROOT, not this directory: the server imports
  `sdk/client/src` by relative path,
  and Node needs that package's `package.json` alongside its sources or the
  `.ts` files load as CommonJS and every named import fails.
- Nothing in the container's filesystem survives a deploy. Anything new that
  has to outlive one — art, keys, uploads, pending connect flows — goes in
  the database, not on disk or in process memory.
- Deploys overlap: the new container must pass the healthcheck before the
  old one gets SIGTERM, so two arcades briefly run against one database.
  State that coordinates work must coordinate through rows, not process
  memory — the dispatcher's working slot is claimed per game in SQL
  (`claimSuggestionForDispatch`), and a watcher that finds a dispatch it
  never staged adopts it instead of settling it. On SIGTERM every hub and
  relay socket gets an orderly 1001 close so browsers reconnect immediately
  onto the replacement; a reconnect's re-announced watch carries
  `resume: true` so a deploy does not count as plays
  (`tests/hub-watch.test.ts`).
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

### Verifying against agents

- Default target is the real Reflex deployment; game creation needs a real
  `rfx_` key pasted in the UI.
- For repeatable end-to-end checks, boot the ephemeral mock-wired stack on
  side ports and run the Playwright smoke test (see README). Never repoint
  the live daemons at the mock.
- Real-time sync is WebSocket-first (hub frames); don't add HTTP polling
  (the `creating`-status refetch in GameView is a documented reconnect
  fallback, not a precedent).
- Frames are never replayed, so any view holding socket-fed state must
  re-read it via `useArcadeReconnect` — without that, whatever changed
  during a drop stays wrong until a manual reload. That is a resync on a
  connection event, not polling.

## Commands

| Command                | What                                             |
| ---------------------- | ------------------------------------------------ |
| `npm run dev`          | server (:8790) + web (:5674) against real Reflex |
| `npm run dev:mock`     | offline mock Reflex API (:8791)                  |
| `npm test`             | unit tests + storybook play tests                |
| `npm run test:unit`    | node tests in `tests/`                           |
| `npm run test:stories` | play functions in headless Chromium              |
| `npm run storybook`    | Storybook dev server (:6106)                     |
| `npm run shots`        | screenshot key screens into `shots/`             |
| `npm run typecheck`    | server + web + stories/tests tsconfigs           |
| `npm run lint`         | ESLint 9 flat config across the package          |
| `npm run format`       | prettier + tailwind class sorting (`:check` too) |

## Gotchas Worth Knowing

- `StatCounter` needs `key={target}` or it won't re-animate when data loads.
- The sticky nav must stay near-opaque (`bg-zinc-950/95 backdrop-blur-xl`);
  translucent bars ghost scrolled content through them.
- Entity ids come from `newId('<kind>')` in `server/ids.ts` (crypto-backed);
  don't reach for `Math.random`/`crypto.randomUUID`.
- Real agent streams speak three dialects (flat, ACP, native Claude Code);
  parsing lives in the scaffolded kit's `event-utils` — fix dialect bugs
  upstream in the chat-kit registry.
- Game art is a file contract, not an API: agents serve
  `/arcade/{icon,preview}.{svg,png}` and `/arcade/preview-anim.svg` (looping
  animated SVG for tile hover; the engine also accepts `preview.gif`/`.webp`
  as fallbacks agents are not prompted for) from their dev daemon and the watcher
  captures changes into the database after each turn (`setGameArt`, art
  endpoints in routes.ts). Keep the system prompt, engine `ART_KINDS`,
  and the mock's `/play/:id/arcade/:file` route in sync.
- A system prompt is frozen when the agent launches, so a rule added to
  `GAME_AGENT_SYSTEM_PROMPT` reaches only games created after it. Games
  already running catch up through `GAME_BRIEF_VERSION` + `briefUpdatePrompt`:
  bump the version, put the new rules in that prompt, and the next dispatched
  turn carries them once (recorded on the send — there is nothing to
  re-probe, unlike the art appendix, which repeats while art is missing).
