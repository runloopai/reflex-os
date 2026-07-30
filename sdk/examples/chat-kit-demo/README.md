# Reflex chat kit demo

A minimal Vite + React app that renders a Reflex agent chat outside the Reflex web app. It uses `@runloop/reflex-client` for API calls and live events, and components scaffolded by `@runloop/reflex-chat-kit`.

What it shows:

- A sidebar that lists your agents (`listAgents`) and creates new ones (`createAgent`).
- The scaffolded `ChatPane` for the selected agent: REST history, live WebSocket updates, optimistic sends.
- Two themes switched purely through `--reflex-chat-*` CSS variables, no component edits.

## Prerequisites

1. A running Reflex server. From the repo root: `pnpm dev` (server on `http://localhost:4000`).
2. The server must allow this app's origin for CORS and WebSocket upgrades. Start it with `ALLOWED_ORIGINS=http://localhost:4001,http://localhost:4002` (the Reflex web app plus this demo). Without it, browsers block the API calls and the socket handshake returns 403.
3. A personal API key. In the Reflex web app, open **Security > API keys** and mint a key (`rfx_...`). The key authenticates as you; treat it like a password.
4. To actually launch agents, the org needs its default blueprint bootstrapped (a configured Runloop account). Listing agents and chatting with existing ones work without it.

## Setup

```bash
cp .env.example .env
```

Fill in `.env`:

- `VITE_REFLEX_BASE_URL` - server origin, defaults to `http://localhost:4000`.
- `VITE_REFLEX_API_KEY` - your `rfx_...` key.
- `VITE_REFLEX_ORG` - org id (`org_...`) or slug the key's user belongs to.

## Run

```bash
# This example is standalone (outside the pnpm workspace), like the arcade:
npm install
npm run dev   # http://localhost:4002
```

Without an API key the app renders a setup screen instead of crashing.

## How the chat components got here

The files under `src/components/reflex`, `src/hooks/reflex`, and `src/lib/reflex` were not written by hand. They were copied in by the chat kit CLI, shadcn-style, and committed as-is:

```bash
# from this directory (external users run `npx @runloop/reflex-chat-kit` instead)
node ../../chat-kit/dist/bin.js init
node ../../chat-kit/dist/bin.js add chat
```

`init` wrote `reflex-kit.json` with the target directories. `add chat` copied the provider, hooks, event helpers, and pane components, rewriting imports to this layout. The copies are ours to edit.

To pull updated components after the kit changes, rebuild it and rerun `add`. It overwrites the scaffolded files, so stash local edits first:

```bash
pnpm --filter @runloop/reflex-chat-kit build   # from the repo root
node ../../chat-kit/dist/bin.js add chat
```

## Custom styling

The scaffolded components read colors from `--reflex-chat-*` CSS variables with built-in fallbacks. This demo defines two themes in [`src/index.css`](src/index.css) (`.theme-day` and `.theme-night`) and the switcher in `App.tsx` just swaps the class on the chat container. Setting the variables on any ancestor restyles the whole pane:

```css
.theme-night {
  --reflex-chat-bg: #18181b;
  --reflex-chat-accent: #2dd4bf;
  --reflex-chat-user-bubble: #0f766e;
  /* ... */
}
```

For layout or markup changes, edit the scaffolded files directly. They are part of this app.
