# @runloop/reflex-client

Typed API client and live event stream for [Reflex](https://reflex.runloop.ai). Works in browsers and Node (>= 22), with any framework or none. Authenticates with a personal API key, or with a session token provider for host apps.

This is the same client the Reflex web app runs on: the app configures the transport with its session token and delegates every API call to it. External consumers get the identical code path with an API key instead.

## Install

```bash
npm install @runloop/reflex-client
```

## Mint an API key

In Reflex, open your profile settings and create a personal API key, or call the API directly with your session:

```bash
curl -X POST https://reflex.runloop.ai/api/me/api-keys \
  -H "Authorization: Bearer <session token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-integration"}'
```

The response contains a `token` starting with `rfx_`. It is shown once; store it securely. The key authenticates as you, and requests are scoped to an organization you belong to via the `x-organization-id` header (an org id like `org_...` or the org slug).

## Configure

Call `configureReflex` once at startup. There is no implicit configuration: no localStorage, no environment variables.

```ts
import { configureReflex } from '@runloop/reflex-client';

configureReflex({
  baseUrl: 'https://reflex.runloop.ai', // server origin, no /api suffix
  apiKey: 'rfx_...',
  organizationId: 'my-org', // org id or slug; optional
});
```

### All options

| Option              | Type                                | Purpose                                                                                                                                                                              |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `baseUrl`           | `string`                            | Server origin; the transport appends `/api`. Pass `''` for a same-origin host app (requires `getToken`).                                                                             |
| `apiKey`            | `string?`                           | Personal API key (`rfx_...`). Required unless `getToken` is set.                                                                                                                     |
| `getToken`          | `() => string \| null \| undefined` | Dynamic bearer token provider, read on every request. Takes precedence over `apiKey`; falls back to it when the provider returns nothing. For host apps that own a session.          |
| `organizationId`    | `string?`                           | Static org scope (org id or slug), sent as `x-organization-id`.                                                                                                                      |
| `getOrganizationId` | `() => string \| null \| undefined` | Dynamic org provider, read on every request. Takes precedence over `organizationId`. Explicit `x-organization-id` headers on a request win over both.                                |
| `onUnauthorized`    | `(ctx: { path: string }) => void`   | Called when a response is 401, before the error is thrown. Use it to drop a stale session. Per-request opt-out: `reflexRequest(path, init, { notifyOnUnauthorized: false })`.        |
| `credentials`       | `RequestCredentials?`               | Explicit `fetch` credentials mode. When omitted, cross-origin session auth (absolute `baseUrl` plus `getToken`) sends `credentials: 'include'`; API-key requests never send cookies. |
| `fetch`             | `typeof fetch?`                     | Custom fetch implementation (tests, polyfills).                                                                                                                                      |

Either `apiKey` or `getToken` must be provided.

## Call the API

Every operation in the public OpenAPI spec is exported as a typed function. Responses are `{ data, status, headers }` envelopes; non-2xx responses throw `ReflexApiError` with `status`, `code`, and the parsed body.

```ts
import { listAgents, sendAgentMessage, ReflexApiError } from '@runloop/reflex-client';

const { data } = await listAgents();
console.log(data.agents.map((a) => a.name));

try {
  await sendAgentMessage(agentId, { message: 'Summarize the latest PR.' });
} catch (err) {
  if (err instanceof ReflexApiError && err.status === 403) {
    console.error('No access to this agent:', err.code);
  } else {
    throw err;
  }
}
```

## Subscribe to a live stream

`ReflexSocket` connects to the Reflex WebSocket endpoint, sends heartbeats, reconnects with backoff, and replays subscriptions after a reconnect. On subscribe the server sends the stream's recent history first, then live events.

```ts
import { getAgent, ReflexSocket } from '@runloop/reflex-client';

const socket = new ReflexSocket();

const { data: agent } = await getAgent(agentId);
const unsubscribe = socket.subscribe(agent.streamId, (event) => {
  console.log(new Date(event.timestamp).toISOString(), event.type, event.payload);
});

socket.onStateChange((state) => console.log('socket:', state));

// Later:
unsubscribe();
socket.close();
```

On Node versions without a global `WebSocket`, inject an implementation:

```ts
import WebSocket from 'ws';
const socket = new ReflexSocket({ webSocket: WebSocket as never });
```

## Derive live agent status

The polled agent record's `status` can go stale: deployments sometimes leave it on `running` after a turn ends, and it says nothing about a suspended devbox. `agent-liveness` folds stream events into a small pure state and combines it with the record into the status a UI should actually show — including the stream-only `suspended` state:

```ts
import {
  getAgent,
  ReflexSocket,
  initialAgentLiveness,
  reduceAgentLiveness,
  deriveAgentStatus,
  turnEndedBetween,
} from '@runloop/reflex-client';

let liveness = initialAgentLiveness();
socket.subscribe(agent.streamId, (event) => {
  const prev = liveness;
  liveness = reduceAgentLiveness(liveness, event);
  if (turnEndedBetween(prev, liveness)) console.log('turn ended');
  // 'running' | 'needs_input' | 'suspended' | ... — record + stream combined
  console.log(deriveAgentStatus(liveness, agent.status));
});
```

The reducer is replay-safe (subscribing replays the stream's history; events stamped before what the state has seen are ignored), so feed it every event without filtering. Re-derive with a fresh `getAgent()` record whenever you poll one.

## Errors

`ReflexApiError` mirrors the server's error envelope:

- `status`: HTTP status code
- `code`: machine-readable discriminator (for example `validation_error`)
- `hint`: optional remediation hint
- `issues`: field-level details for validation failures
- `body`: the full parsed response body

## React Query hooks: `@runloop/reflex-client/react/*`

The same public API surface is also available as generated TanStack React Query hooks, one module per resource tag:

```ts
import { useListAgents, getListAgentsQueryKey } from '@runloop/reflex-client/react/agents';
import { useListPersonalApiKeys } from '@runloop/reflex-client/react/me';
import type { Agent } from '@runloop/reflex-client/react/model/agent';
```

Only the `/react/*` entry points need `react` and `@tanstack/react-query` (declared as optional peer dependencies). The root entry stays dependency-free and works without them.

The hooks share the transport configured with `configureReflex`, including org scoping and 401 handling. Hooks resolve with the parsed response body (not the `{ data, status, headers }` envelope the root functions return).

## Errors and requests from host apps

- `reflexRequest<T>(path, init?, opts?)` executes one request through the configured transport and resolves with the parsed body. Host apps build their own `request()` helpers on it; `opts.notifyOnUnauthorized: false` suppresses the `onUnauthorized` callback for a single request (for 401s that mean "reconnect an integration", not "session expired").

## Regenerating (maintainers)

The functions under `src/generated/` (root entry) and the hooks under `src/react/` are produced by orval from `openapi/openapi.public.json`. Regenerate with `pnpm client:generate` at the repo root; do not edit generated files by hand. The admin (`/admin/*`) surface is intentionally excluded and never ships in this package.
