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
- `docs/` - the depth behind the workflows below: [`web-ui`](docs/web-ui.md),
  [`sdk-consumption`](docs/sdk-consumption.md), [`hosting`](docs/hosting.md),
  [`gotchas`](docs/gotchas.md).

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
  tests are the component test surface; connected components are covered by
  the smoke test instead.
- Check: `npm test` (unit + stories), then `npm run shots` against a running
  stack and READ the images.
- Deep detail — URL-owned view state, iframe focus, popovers, fullscreen, the
  look, the six mobile rules, Tailwind v4: [`docs/web-ui.md`](docs/web-ui.md).

### SDK-consumption changes

- Chat behavior is fixed upstream in `sdk/chat-kit/registry/`, never forked
  here; pickers are driven by real client routes, not hardcoded data.
- Reflex API keys live on the USER and only in the arcade's database —
  browsers talk to Reflex through the per-game proxy/relay.
- Deep detail — the public shop window, server-rendered share cards, and the
  "Connect with Reflex" device flow:
  [`docs/sdk-consumption.md`](docs/sdk-consumption.md).

### Hosting changes

- One container (`Dockerfile`) plus a managed Postgres on Railway, built from
  the REPO ROOT. Nothing on disk survives a deploy, and deploys overlap: state
  that coordinates work coordinates through rows, never process memory.
- Deep detail — rate limits and body size, untrusted-media and app CSPs,
  health, deny-by-default caching, and crawler files:
  [`docs/hosting.md`](docs/hosting.md).

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

Animation-vs-`toBeVisible()`, the art file contract, frozen system prompts,
and the rest: [`docs/gotchas.md`](docs/gotchas.md).
