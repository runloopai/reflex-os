# @runloop/reflex-chat-kit

Scaffold a customizable Reflex chat pane into your React app. Like shadcn/ui, the components are copied into your codebase, not imported from a package: you own the files and can change anything.

Prefer plain imports over owning the files? [`@runloop/reflex-ui`](../ui/README.md) ships these same components as a regular library.

The kit wires the same patterns Reflex itself uses: TanStack React Query for the event cache, a WebSocket subscription that appends live events into that cache, and an optimistic pending bubble on send. The transcript renders the agent's _activity_, not just text: markdown agent messages (inline-code chips, lists, fenced code), collapsed thinking sections, tool calls as compact mono lines, and lifecycle events as system notes — across every stream dialect Reflex emits (ACP `session/*`, native Claude Code, native Codex app-server `item/*` frames, and the flat `message`/`tool_call` events). The composer supports optional file attachments (picker, drag & drop, or paste — sent as `image`/`file` content blocks), voice dictation, and an interrupt button while a turn is running; the pane has a `readOnly` spectator mode.

For a complete consumer app scaffolded with this CLI (agent sidebar, theme switching via CSS variables, env-based config), see [`sdk/examples/chat-kit-demo`](../examples/chat-kit-demo/README.md) in the Reflex repo.

## Requirements

- React 18+
- `@tanstack/react-query` v5
- `@runloop/reflex-client`
- `react-markdown` + `remark-gfm` (agent messages render as markdown)
- Tailwind CSS (the templates use utility classes; swap them out if you prefer)

```bash
npm install @runloop/reflex-client @tanstack/react-query react-markdown remark-gfm
```

## Scaffold

```bash
npx @runloop/reflex-chat-kit init
npx @runloop/reflex-chat-kit add chat
```

`init` writes `reflex-kit.json` with the target directories:

```json
{
  "componentsDir": "src/components/reflex",
  "hooksDir": "src/hooks/reflex",
  "libDir": "src/lib/reflex"
}
```

Override with flags: `init --components-dir app/ui/reflex --hooks-dir app/hooks --lib-dir app/lib`.

`add chat` installs everything: the provider, both hooks, the event helpers, and the chat pane components, with imports rewritten to your layout. `add <item>` installs one item plus its dependencies; `list` shows what is available.

The CLI refuses to overwrite `reflex-kit.json` or an installed source file by default, so running it again cannot erase your customizations. Pass `--overwrite` when you intentionally want to replace existing files:

```bash
npx @runloop/reflex-chat-kit add chat --overwrite
```

## Use

Mint a personal API key in Reflex (POST `/api/me/api-keys`), then mount the provider and drop in the pane:

```tsx
import { ReflexProvider } from './lib/reflex/reflex-provider';
import { ChatPane } from './components/reflex/chat-pane';

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

## Compose your own

`ChatPane` is a thin composition — you don't need everything. Every piece is
its own registry item (and its own `@runloop/reflex-ui` subpath export):

- **Primitives**: `MarkdownContent` (standalone GFM renderer with chat
  styling), `MessageBubble`, `ToolCallLine` / `ToolCallGroup` (the "N more"
  expander), `ThoughtBlock`, `SystemNote`, `ChatComposer`.
- **Data**: `buildAgentTimeline` (stream → typed items across every event
  dialect), `groupToolRuns` (collapse long tool runs for display),
  `latestAgentStatus`, and the hooks (`useAgentStream`, `useSendMessage`,
  `useInterruptAgent`).
- **Slots on the composition**: `ChatPane` takes `header` / `footer`
  ReactNodes to replace those regions, and `renderItem` (also on
  `MessageList`) to override how any timeline item renders — return
  `undefined` to keep the default (`renderTimelineItem` is exported as that
  default).

Minimal read-only transcript, no pane, no composer:

```tsx
import { useAgentStream } from './hooks/reflex/use-agent-stream';
import { MessageList } from './components/reflex/message-list';

export function Transcript({ agentId, streamId }: { agentId: string; streamId: string }) {
  const stream = useAgentStream(agentId, streamId);
  return <MessageList events={stream.data ?? []} />;
}
```

Or drop the components entirely and drive the data helpers into your own UI:
`groupToolRuns(buildAgentTimeline(events))` gives you typed items to render
however you like.

## Styling

Layout comes from Tailwind utilities in the templates. Colors come from `--reflex-chat-*` CSS variables with built-in fallbacks, so a theme is one CSS rule away:

```css
.my-chat-theme {
  --reflex-chat-bg: #ffffff;
  --reflex-chat-fg: #111827;
  --reflex-chat-border: #e5e7eb;
  --reflex-chat-accent: #0f766e;
  --reflex-chat-accent-fg: #ffffff;
  --reflex-chat-user-bubble: #0f766e;
  --reflex-chat-user-fg: #ffffff;
  --reflex-chat-agent-bubble: #f4f4f5;
  --reflex-chat-agent-fg: #18181b;
  --reflex-chat-muted-fg: #71717a;
  --reflex-chat-input-bg: #ffffff;
  --reflex-chat-input-fg: #111827;
}
```

For deeper changes, edit the files directly. They are yours.

## Registry items

| Item               | Type      | What it does                                           |
| ------------------ | --------- | ------------------------------------------------------ |
| `chat`             | meta      | Installs everything below.                             |
| `reflex-provider`  | lib       | Configures the SDK, owns the socket and a QueryClient. |
| `event-utils`      | lib       | Dedupe, payload parsing, event-to-message reducer.     |
| `use-agent-stream` | hook      | REST history + live WebSocket cache updates.           |
| `use-send-message` | hook      | Send mutation with optimistic pending bubble.          |
| `chat-pane`        | component | Header + transcript + composer, composed.              |
| `message-list`     | component | Scrolling transcript.                                  |
| `message-bubble`   | component | One user or agent bubble.                              |
| `chat-composer`    | component | Textarea; Enter sends, Shift+Enter breaks.             |
