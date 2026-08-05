# Reflex SDKs

Open source packages for building on [Reflex](https://runloop.ai), Runloop's platform for background coding agents. Use them to call the Reflex API, stream live agent events, and drop an agent chat pane into your own React app.

Everything here is published from the `sdk/` tree of Runloop's Reflex repository. See [Repository layout](#repository-layout) for how that works.

## Packages

| Package                                                    | npm                                                                                                                               | What it does                                                                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`@runloop/reflex-client`](sdk/client/README.md)           | [![npm](https://img.shields.io/npm/v/@runloop/reflex-client.svg)](https://www.npmjs.com/package/@runloop/reflex-client)           | Typed API client plus a `ReflexSocket` for live agent event streams. Framework agnostic, runs in browsers and Node. |
| [`@runloop/reflex-chat-kit`](sdk/chat-kit/README.md)       | [![npm](https://img.shields.io/npm/v/@runloop/reflex-chat-kit.svg)](https://www.npmjs.com/package/@runloop/reflex-chat-kit)       | A CLI that copies a customizable React chat pane into your codebase, shadcn style. You own the files after it runs. |
| [`@runloop/reflex-ui`](sdk/ui/README.md)                   | [![npm](https://img.shields.io/npm/v/@runloop/reflex-ui.svg)](https://www.npmjs.com/package/@runloop/reflex-ui)                   | The same chat components as an importable library, for when you would rather upgrade than own the source.           |
| [`@runloop/reflex-cli`](sdk/tui/README.md)                 | [![npm](https://img.shields.io/npm/v/@runloop/reflex-cli.svg)](https://www.npmjs.com/package/@runloop/reflex-cli)                 | Terminal client. Browse and chat with agents, launch new ones, and connect this machine as a workstation.           |
| [`@runloop/reflex-contract`](sdk/contract/README.md)       | [![npm](https://img.shields.io/npm/v/@runloop/reflex-contract.svg)](https://www.npmjs.com/package/@runloop/reflex-contract)       | Schemas and helpers the API cannot express as types: attachments, sandbox options, agent references.                |
| [`@runloop/reflex-workstation`](sdk/workstation/README.md) | [![npm](https://img.shields.io/npm/v/@runloop/reflex-workstation.svg)](https://www.npmjs.com/package/@runloop/reflex-workstation) | The wire protocol a machine speaks to be driven as a workstation by an agent.                                       |

Each package carries its own version and changelog. A change to one does not force a release of the others.

## Getting started

Install the client and authenticate with a personal API key, which you create with `POST /api/me/api-keys`:

```bash
npm install @runloop/reflex-client
```

```ts
import { configureReflex, listAgents, ReflexSocket } from '@runloop/reflex-client';

configureReflex({
  baseUrl: 'https://reflex.example.com',
  apiKey: process.env.REFLEX_API_KEY,
  organizationId: 'my-org',
});

const { data } = await listAgents();
```

Or drive Reflex from a terminal:

```bash
npx @runloop/reflex-cli
```

To scaffold a chat pane into an existing React app:

```bash
npx @runloop/reflex-chat-kit
```

A working consumer app that uses both packages lives in [`sdk/examples/chat-kit-demo`](sdk/examples/chat-kit-demo/README.md).

## Repository layout

Packages sit under `sdk/` at the same paths they occupy upstream:

- [`sdk/contract`](sdk/contract) is `@runloop/reflex-contract`, the shared schemas and helpers both the API client and the Reflex server build on.
- [`sdk/workstation`](sdk/workstation) is `@runloop/reflex-workstation`, the workstation wire protocol.
- [`sdk/client`](sdk/client) is the API client. Its gitignored `src/generated/`
  and `src/react/` directories are produced during install from the committed
  public OpenAPI document.
- [`sdk/chat-kit`](sdk/chat-kit) holds the CLI and the component registry it copies.
- [`sdk/ui`](sdk/ui) is compiled from that same registry, so both packages ship identical components.
- [`sdk/tui`](sdk/tui) is `@runloop/reflex-cli`, the terminal client.
- [`sdk/examples`](sdk/examples) holds runnable example apps.
- [`plugins/plugin-workstation`](plugins/plugin-workstation) is the server and web half of the workstation feature, published here as a reference implementation. It depends on packages that are not published, so it is source visible rather than buildable, and it is not part of this repository's workspace. To write a workstation client you want [`@runloop/reflex-workstation`](sdk/workstation/README.md) instead.

This repository is a read only mirror for source changes: commits are exported from Runloop's Reflex repository, where the SDKs are developed next to the API they talk to. The public OpenAPI document is exported with the SDK and generates the local client during `pnpm install`. Pushes here are overwritten by the next export.

Publishing runs the other way. Every package on npm is published from this repository, using npm trusted publishing, so each release carries a provenance attestation you can trace back to the commit and workflow run that produced it. `pnpm install && pnpm check` here builds and tests exactly what gets published.

Issues and pull requests are welcome. Maintainers apply accepted changes upstream, and the next export brings them back here under your name in the pull request discussion. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the details.

## Security

Report vulnerabilities through the [security policy](.github/SECURITY.md), not a public issue.

## License

[MIT](LICENSE).
