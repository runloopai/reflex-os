# SDK-consumption changes

Deep detail for the SDK-consumption workflow in [`../AGENTS.md`](../AGENTS.md).

## Chat kit

The agent chat pane is chat-kit output: improvements to chat behavior go into
`sdk/chat-kit/registry/` FIRST (then `pnpm --filter @runloop/reflex-ui sync`),
never forked locally here.

## Pickers are driven by real client routes

Agent/model/org pickers use `getAgentModelSupport`, `getOrganizations`, and
`listAccessibleModelProviderSecrets` — if data is missing, add it to the
public API + client, don't hardcode. Provider-key display mirrors Reflex's
`ModelProviderSecretPicker`: resolution lives in
`web/src/lib/provider-keys.ts`, rendering in `ProviderKeyList`, and only key
metadata (never secret material) crosses into the arcade.

## The shop window is public

`/` and `/about` render with no account, and the routes that need one gate
themselves (`gate(...)` in `App.tsx`) rather than the shell replacing the
whole app. Anything a signed-out browser can reach — `GET /api/games`,
hover-card profiles, the hub socket — filters to public data on the SERVER;
the hub pushes such a client public frames only, because a null user id can
never match an owner id (`tests/hub-anonymous.test.ts`). A token the server
rejects is dropped, not kept: a stale one left in localStorage makes the
socket reconnect forever.

## Share cards are server-rendered

They are the only part of this app a crawler ever sees: Slack, X and LinkedIn
fetch the URL, read the `<head>`, and leave without running the SPA.
`server/share.ts` is the single definition — production splices it in
`server/index.ts`, dev in `web/og-dev-plugin.ts` (dev is what a demo tunnel
points at, so it cannot be skipped). Adding a default tag to
`web/index.html` means teaching `stripShareTags` to remove it, or every game
unfurls as the generic card: faced with two `og:title`s, crawlers take the
first. Covers rasterize to PNG because no unfurl target renders SVG, and a
private game has no card.

## Keys and the connect flow

Reflex API keys are saved on the USER (active key), never entered per game.
Owner `rfx_` keys live only in the arcade's database — they must never reach
a browser, a fixture, or git. Browsers talk to Reflex only through the
per-game proxy/relay.

"Connect with Reflex" is Reflex's own device flow, not an arcade endpoint:
`server/reflex.ts` starts it with `clientName`, `server/connect.ts` holds the
pending device codes (server-side only, per player, TTL'd), and the browser
drives it through `web/src/lib/connect.ts`. Two rules the design rests on —
the device code and the minted key never reach a browser, and a poll only
ever resolves for the player who started it. Extend the flow here; only reach
into base Reflex if the gap is generic (the `clientName` label was), never
with an arcade-shaped route.
