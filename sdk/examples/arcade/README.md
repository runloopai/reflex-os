# Reflex Arcade

A Twitch-style demo app built on the Reflex SDKs: every "stream" is a Reflex
agent building a browser game live. Viewers watch the agent chat, play the
current build in an embedded iframe, and suggest features; the owner approves
suggestions (or turns on auto-approve) and the agent picks them up one at a
time, as soon as it finishes its previous turn.

This is a standalone demo. It is **not** part of the repo's pnpm workspace,
Turbo graph, or CI — it has its own `package.json`, npm lockfile, and
node_modules, and nothing at the repo root references it.

## What it demonstrates

- `@runloop/reflex-client` in the browser **and** in Node: the server creates
  agents (`createAgent` with the chosen agent type and model), sends turns
  (`sendAgentMessage`), and watches the live event stream; the web app runs
  the same client through a proxy.
- The SDK's `agent-liveness` helpers: each game watcher folds stream events
  through `reduceAgentLiveness` and publishes `deriveAgentStatus(state,
record.status)` instead of the raw record — so tiles and banners show
  `asleep` when the devbox suspends and go idle the moment a turn ends,
  even when the polled record still says `running`.
- `@runloop/reflex-chat-kit`: the chat pane under
  `web/src/{components,hooks,lib}/reflex/` is **stock scaffold output** from
  the kit's CLI (`reflex-chat-kit add chat`) — everything the arcade needed
  was upstreamed into the kit's registry (and therefore into
  `@runloop/reflex-ui`): markdown agent messages with code chips, thoughts
  collapsed behind "Thought for a moment", tool calls as mono lines,
  lifecycle system notes, a `readOnly` spectator mode with a host-supplied
  live `status`, and a composer bar with attachments (picker, drag & drop,
  paste — `image`/`file` content blocks), SpeechRecognition voice
  dictation, an interrupt button while the agent is running
  (`useInterruptAgent` → `POST /agents/:id/interrupt`, owner-only through
  the arcade proxy), and a round send button
  (`enableAttachments`/`enableVoice` props). The kit's
  `buildAgentTimeline` understands both stream dialects: the ACP one real
  deployments emit (`session/prompt`, `session/update`) and the flat one
  (`message`, `agent_message_chunk`, `tool_call`) used by other brokers,
  the optimistic pending bubble, and the bundled mock.
- Connecting a Reflex account without handling a credential: **Connect with
  Reflex** drives the device-authorization flow the terminal client already
  uses (`startDeviceAuth` / `pollDeviceAuthToken`, both public SDK routes).
  The arcade names itself in the start call, the player approves on Reflex's
  own page under their own session and picks an organization there, and
  Reflex mints a personal API key named after the app and hands it back once.
  The device code never leaves the arcade server and the key never reaches a
  browser; the arcade saves it against the player, already org-scoped, and
  launches agents with it. The only change to Reflex was making that flow
  client-agnostic (an optional `clientName` on the start request, surfaced on
  the approval page) — no arcade-specific endpoint exists.
- Launch catalog through public SDK routes: agent and model pickers are fed
  from `getAgentModelSupport` (the same `GET /config/agent-model-support`
  catalog Reflex's own launch dialog reads — providers, key availability,
  discovered models, defaults) and org selection from `getOrganizations`
  (the orgs a personal key can act in). Both routes were added to / typed in
  the public OpenAPI spec + generated client as part of this demo.
- Provider keys per agent/model combination: picking an agent and model
  resolves one model provider, and the form lists the keys that can
  authenticate it. They come from `listAccessibleModelProviderSecrets`, the
  same route Reflex's own `ModelProviderSecretPicker` reads, and render the
  same way: grouped user → team → org (the precedence the server resolves
  with), badged API key vs subscription, with keys of a kind the provider
  doesn't accept greyed rather than hidden — so "no key" reads apart from
  "wrong kind of key".
- A timeline view (`/g/:gameId/timeline`) that reconstructs the story of a
  game from the agent's own event stream — the opening ask, every owner
  prompt, every dispatched suggestion, and each shipped turn — joined with
  the arcade's suggestion rows for the things a stream cannot know (who
  asked, hearts, the owner's note, what became of it). Suggestions that
  never reached the agent appear too, marked "not sent". Viewers of a
  public game get it through the same read-only proxy as the chat.
- Phones are a first-class surface. Opening a game there gives it the whole
  screen — the app nav stands down and the game runs edge to edge — and the
  room becomes three screens of its own behind a dock: chat, the agent
  transcript, and suggestions each open over the game and hand it straight
  back. Badges on the dock carry what arrived while a panel was closed.
  Desktop is unchanged: the same panel is the resizable sidebar next to the
  stage. Touch targets and composer type size are driven by pointer
  coarseness rather than viewport width.
- A standing prompt that treats phones as the default surface: the game
  agent is told every action must be reachable by touch, the play surface
  must resize with its container and stay sharp on a retina screen, and the
  page must not fight the player (`touch-action`, no hover-only). It applies
  to games created from now on — a system prompt is fixed when the agent is
  created, so existing games need an owner prompt to catch up.
- Agent daemons: the game-creation prompt instructs the agent to run its dev
  server as a registered daemon; the app embeds `agent.daemons[].url` in an
  iframe the moment it appears on the stream.
- Agent-authored art: the system prompt asks every agent to hand-author
  `/arcade/icon.svg` (square mark), `/arcade/preview.svg` (16:9 cover), and
  `/arcade/preview-anim.svg` (a looping animated cover — SMIL/CSS animation
  inside the SVG) in its game's `public/` dir. The watcher fetches them off the daemon
  after each finished turn (PNG works too), stores them as data URLs with
  an `artVersion`, and serves them from
  `/api/games/:id/art/{preview,icon,preview-anim}` — so tiles keep their
  art even while the devbox sleeps, and refresh automatically when the
  agent redraws them. Hovering a tile plays the animated cover, then fades
  in the live game itself (the daemon iframe, inert and scaled down) — a
  real moving preview instead of one frame.
- A user-level key model: players save named Reflex personal API keys on
  their account, bind each to an organization picked from the key's own org
  list, and mark one active. Game creation always launches under the saved
  active key — no key entry at launch time. Keys live server-side
  and never reach other browsers — viewers stream the agent chat through an
  allowlisted proxy.

## Layout

```
sdk/examples/arcade/
  server/        Fastify + Postgres + ws (run with tsx, no build step)
    index.ts     boot: HTTP API, hub socket, Reflex proxy + relay, static web
    sql.ts       the store: Postgres via DATABASE_URL, else embedded PGLite
    db.ts        users / games / suggestions / chat_messages
    routes.ts    join/login, reflex-key, games, suggestions, general chat
    engine.ts    per-game stream watcher + suggestion dispatcher
    proxy.ts     /reflex/:gameId/api/* HTTP allowlist proxy
    relay.ts     /reflex/:gameId/api/ws  read-only WebSocket relay
    reflex.ts    server-side SDK calls with per-owner credentials
    events.ts    the arcade's own live-update hub (/api/ws)
  web/           Vite + React + Tailwind 4 (SDKs aliased to ../../sdk/*/src)
  mock-reflex/   tiny fake Reflex server for offline runs
```

The client SDK is consumed **from source**: Vite aliases and tsconfig paths
point `@runloop/reflex-client` at `sdk/client/src`, so there is no SDK build
step and no workspace linkage (the same idea as the repo's internal
`@reflex/source` export condition). The chat UI is not imported at all — it
is chat-kit scaffold output living in this app's own `src/`.

## Run it

```bash
cd sdk/examples/arcade
npm install
```

Against a real Reflex server. The default origin is `REFLEX_BASE_URL` if
set, else `REFLEX_API_URL` minus its `/api` suffix (present on
Reflex-managed devboxes), else `http://localhost:4000`:

```bash
npm run dev                 # arcade server :8790 + web :5674
# REFLEX_BASE_URL=https://reflex.example.com npm run dev   # other deployments
```

Fully offline, with the bundled mock Reflex (fake agent that emits
plan/tool-call/daemon events and serves a playable page):

```bash
npm run dev:mock            # mock reflex on :8791
REFLEX_BASE_URL=http://localhost:8791 npm run dev
```

Then open http://localhost:5674, pick a name, and create a game. Hit
**Connect with Reflex** once: the arcade starts Reflex's device flow, sends
you to Reflex to approve it under your own session and pick an
organization, and Reflex hands back a personal API key it minted for you.
Pasting a key you minted yourself (Reflex > profile > API keys) still works
as a fallback — it is validated via `getOrganizations`, which also lists the
orgs it can act in so you pick one instead of typing a slug. The agent
picker shows the deployment's enabled agent types and the model picker its
discovered models — providers without a usable key in the org are disabled
— both from `getAgentModelSupport`. Games always launch under your saved
active key.

Offline, the mock stands in for Reflex's approval page too: the connect
button opens its `/mock-connect` screen, where Approve mints a fake key
against the org you pick.

Production-ish: `npm run build`, then `NODE_ENV=production npm start` serves
the built web app and the API from :8790.

## Where the data lives

`DATABASE_URL` decides. Set it and the arcade runs on that Postgres server;
leave it unset and it runs on an embedded PGLite database under `.data/`, so
`npm install && npm run dev` needs no database of any kind. Both drivers sit
behind `SqlDriver` in `server/sql.ts` and answer the same SQL, so the store
is the only thing that changes.

```bash
DATABASE_URL=postgres://user:pass@host:5432/arcade npm start
# ARCADE_DATABASE_URL wins over DATABASE_URL, for a process that already
# has some other one in its environment.
```

The schema is applied on every boot (additive DDL in `SCHEMA`, `server/db.ts`),
so there is no migration step to run. PGLite additionally takes a snapshot
into `<data dir>.backups` every five minutes and restores from it if the data
dir is ever corrupted by an unclean kill; a Postgres server has its own
backups and skips that.

## Hosting it

`Dockerfile` builds the deployed arcade: one container serving the API and
the built web app, alongside a managed Postgres. The build context is the
**repository root**, because the server imports the client SDK from
`sdk/client/src`:

```bash
docker build -f sdk/examples/arcade/Dockerfile -t reflex-arcade .
docker run -p 8790:8790 -e DATABASE_URL=... -e REFLEX_BASE_URL=... reflex-arcade
```

The container sets `HOST=0.0.0.0` and `NODE_ENV=production` itself; a host
only has to supply `DATABASE_URL`, `REFLEX_BASE_URL`, and `PORT`.
`GET /api/health` is the healthcheck and queries the database, so a container
that cannot reach one fails the check instead of serving errors.

It runs on Railway in the `reflex-arcade` project (workspace `runloop.ai`),
as two services: **Postgres** (official template, volume at
`/var/lib/postgresql/data`) and **arcade**, built from this repo's `main`
branch. The arcade service's settings are not in this repo — Railway
deprecated `railway.json`, so they live on the service itself and are
reproduced here:

| Setting               | Value                                            |
| --------------------- | ------------------------------------------------ |
| Root directory        | `/` (the repo root, for `sdk/client/src`)        |
| Dockerfile path       | `sdk/examples/arcade/Dockerfile`                 |
| Healthcheck           | `/api/health`, 120s timeout                      |
| Watch paths           | `sdk/examples/arcade/**`, `sdk/client/**`        |
| `DATABASE_URL`        | `${{Postgres.DATABASE_URL}}`                     |
| `REFLEX_BASE_URL`     | the Reflex deployment players' agents run on     |
| `REFLEX_AGENT_TYPE`   | `claude-code`                                    |

Only the watch paths make a change here redeploy; a change elsewhere in the
repo does not rebuild the arcade.

## Tests and Storybook

Stories and tests live in `stories/` and `tests/`, outside the src dirs.

```sh
npm test                    # unit tests + storybook play-function tests
npm run test:unit           # node tests (sorting, database-backed dispatch/hearts)
npm run test:stories        # every story's play function, headless Chromium
npm run storybook           # storybook dev server on :6106
npm run shots               # screenshot key screens into shots/ for judging
# The store tests run on PGLite by default. Point them at a throwaway
# Postgres to cover the driver a hosted arcade actually uses (it drops and
# recreates the public schema):
# ARCADE_TEST_DATABASE_URL=postgres://postgres@localhost:5432/arcade_test npm run test:unit
npm run lint                # eslint (typescript-eslint, react-hooks, storybook)
npm run format              # prettier with tailwind class sorting
```

For end-to-end verification there is a Playwright smoke script that boots
nothing itself — run an ephemeral mock-wired stack on side ports so live
daemons stay untouched:

```sh
PORT=8795 ARCADE_DATA_DIR=/tmp/arcade-smoke REFLEX_BASE_URL=http://localhost:8791 npm run start &
ARCADE_API_ORIGIN=http://localhost:8795 npx vite --config web/vite.config.ts --port 5679 &
```

## How the pieces fit

```
browser ── /api/*            arcade JSON API (join, games, suggestions, chat)
        ── /api/ws           arcade hub: live game/suggestion/chat frames
        ── /reflex/:game/api/*   Reflex proxy (owner's key injected here)
        ── /reflex/:game/api/ws  Reflex stream relay (read-only protocol)
                                   │
arcade server ── owner's rfx_ key ─┴─> Reflex /api + /api/ws
             └─ per-game watcher socket -> suggestion dispatcher
```

- **Login**: `POST /api/join` mints an `ark_...` token the web app keeps in
  localStorage. There is no logout and no password — the token is the
  account (copyable from the nav to sign in elsewhere).
- **Browsing is public**: `/` and `/about` render signed out, so a visitor
  sees the live shelf before picking a name. `GET /api/games` answers a
  request with no token with the public games only, and the hub socket
  accepts one — pushing it public frames and never an owner's; the join
  screen goes up as the route element on anything that needs an account
  (a game, your shelf, creating one, profiles), so joining lands you on the
  page you asked for instead of back on `/`.
- **Sharing**: a game link unfurls into a card wherever it is pasted —
  Slack, X, LinkedIn, Discord, iMessage. None of those run JavaScript, so
  the tags are written into the HTML before it leaves the server
  (`server/share.ts`, used by `server/index.ts` in production and by the
  Vite plugin in `web/og-dev-plugin.ts` in dev — dev is what a demo tunnel
  points at). The card image is the agent's own cover art, rasterized to
  PNG because no unfurl target renders SVG; a game that has not drawn one
  yet gets a generated card. `GET /api/oembed?url=` answers oEmbed for the
  clients that prefer asking, with a live game embedded as the playable
  game itself, and `GET /api/games/:id/share` is the same card as JSON.
  Private games have no card at all: they unfurl as the arcade, never as
  their own title.
- **Game creation** starts an agent with a standing **system prompt**
  (`GAME_AGENT_SYSTEM_PROMPT` in `server/reflex.ts`): build with TypeScript
  - Vite, host through the Vite dev server (`vite --host 0.0.0.0`, game at
    the root path — never a static file server or directory listing), and
    register that dev server as a daemon. The launch `prompt` is just the
    game brief. The watcher subscribes to the agent's stream; on
    `agent.daemon_started` / `agent.status_change` it refreshes the agent and
    stores the daemon URL — the game flips to `live` and the iframe appears.
- **Suggestions** flow `pending -> approved -> working -> done` (or
  `rejected`). The dispatcher sends exactly one approved suggestion per idle
  agent (`needs_input` / `completed`), marks it `working`, and completes it
  when that turn ends; then the next approved suggestion goes out
  automatically. Auto-approve skips the review step for new suggestions.
  Rejection takes an optional reason, and the owner can leave a public note
  on any suggestion in any status; both live in the same `ownerNote` field,
  render on the card for everyone with access, and ride along in the prompt
  when a queued suggestion is dispatched to the agent.
- **Game chat**: every game is a chat room for the people watching it —
  Twitch-style, in the sidebar's default tab. The owner's messages carry a
  crown badge (lucide-react). Room access and live broadcast follow the
  game's visibility.
- **Public games** appear on the landing page for everyone; viewers get the
  read-only chat pane and the suggestion composer, never the owner's key and
  never write access to the agent (the proxy allows viewers only
  `GET /agents/:id` and `GET /agents/:id/stream` for the game's own agent;
  `POST .../message` is owner-only; the WS relay forwards only
  `subscribe`/`unsubscribe` for the game's stream id).

## Caveats (it is a demo)

- The arcade trusts its own data; there is no rate limiting, no email,
  and no way to recover a lost `ark_` token.
- A game whose devbox is later stopped keeps its last daemon URL until the
  watcher notices the status change on reconcile (30s).
- Turning a public game private does not retroactively push a removal frame
  to viewers currently on the page; they lose access on the next request.
- The mock Reflex accepts any API key and simulates turns; it exists to
  exercise the arcade end to end without a Runloop-backed deployment.
