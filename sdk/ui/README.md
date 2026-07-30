# @runloop/reflex-ui

Importable Reflex chat components for React: the provider, hooks, and chat pane as a normal npm library.

This package and [`@runloop/reflex-chat-kit`](../chat-kit/README.md) ship the same components in two delivery models, like shadcn/ui offers alongside component libraries:

- **reflex-ui (this package)** — `import { ChatPane } from '@runloop/reflex-ui'`. Zero setup, updates arrive with `npm update`, but customization stops at props and CSS variables.
- **chat-kit** — a CLI that copies the component sources into your app. You own the files and can change anything, but updates are manual.

The sources are identical: this package compiles `sdk/chat-kit/registry/` (synced by `scripts/sync-registry.mjs`; CI fails on drift). Start here; eject to chat-kit when you need to edit the internals.

## Install

```bash
npm install @runloop/reflex-ui @runloop/reflex-client @tanstack/react-query
```

Requires React 18+. Layout styling uses Tailwind utility classes — if you use Tailwind 4, tell it to scan this package:

```css
@source "../node_modules/@runloop/reflex-ui/dist";
```

(Adjust the relative path from your CSS entry to `node_modules`. Without Tailwind you can style the class names yourself; colors work regardless via CSS variables, see below.)

## Use

Mint a personal API key in Reflex (POST `/api/me/api-keys`), then mount the provider and drop in the pane:

```tsx
import { ReflexProvider, ChatPane } from '@runloop/reflex-ui';

export function SupportAgentChat({ apiKey }: { apiKey: string }) {
  return (
    <ReflexProvider baseUrl="https://reflex.runloop.ai" apiKey={apiKey} organizationId="my-org">
      <div className="h-[600px] w-[420px]">
        <ChatPane agentId="agent_123" />
      </div>
    </ReflexProvider>
  );
}
```

The API key authenticates as its owner. Keep it server-side or scoped to trusted users; do not embed a broadly privileged key in a public page.

Every piece is also a subpath import, so you can compose your own pane without pulling in the rest:

```tsx
import { useAgentStream } from '@runloop/reflex-ui/hooks/use-agent-stream';
import { MessageList } from '@runloop/reflex-ui/components/message-list';
```

## Exports

| Import                                                                                                            | What it is                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ReflexProvider`, `useReflex`                                                                                     | Configures the SDK, owns the socket and a QueryClient.                          |
| `useAgentStream`, `agentStreamKey`                                                                                | REST history + live WebSocket cache updates.                                    |
| `useSendMessage`, `useInterruptAgent`                                                                             | Send mutation (text + attachment content blocks); stop the turn.                |
| `ChatPane`                                                                                                        | Header + transcript + composer, composed; `header`/`footer`/`renderItem` slots. |
| `MessageList`, `renderTimelineItem`                                                                               | Transcript with grouped tool runs, pin-aware autoscroll, item overrides.        |
| `MessageBubble`, `MarkdownContent`, `ToolCallLine`, `ToolCallGroup`, `ThoughtBlock`, `SystemNote`, `ChatComposer` | The standalone primitives — take only what you need.                            |
| `buildAgentTimeline`, `groupToolRuns`, `latestAgentStatus`                                                        | Stream → typed timeline (every event dialect) and display helpers.              |
| `buildChatMessages`, `deduplicateEvents`, `parseEventPayload`                                                     | Event-stream utilities.                                                         |

## Relationship to the Reflex web app

The goal is one chat implementation: this package is the canonical home for
agent-transcript rendering, and the Reflex web app composes it rather than
maintaining a parallel tree. The first edges are wired: `@reflex/ui`'s
internal client re-exports this package's stream parsing
(`ui/src/client/event-utils.ts` delegates `deduplicateEvents` /
`parseEventPayload` here), `web` depends on `@runloop/reflex-ui` directly,
and `web/src/components/stream/SdkChatKit.stories.tsx` renders the
published `MessageList` over a native claude-code stream inside the
product's Storybook tests. The web transcript
(`web/src/components/{stream,bubbles}`) still has product-only pieces —
plan cards, setup progress, subagent bubbles, PR/integration cards, payload
inspectors — that depend on the internal `@reflex/ui` design system, which
this package must not import. Those surfaces adopt these primitives
(`MessageList` with `renderItem` overrides for the product-only bubbles)
piece by piece, and anything generic that the product needs next gets added
here first.

## Styling

Colors come from `--reflex-chat-*` CSS variables with built-in fallbacks — a theme is one CSS rule away. See the [chat-kit README](../chat-kit/README.md#styling) for the full variable list. For structural changes, switch to chat-kit and edit the copied sources.
