# Reflex SDKs

Publishable npm packages for building on Reflex from outside this repo. The client and chat packages authenticate with personal API keys (`POST /api/me/api-keys`). They live here so code generation and CI keep them in sync with the API.

- [`contract/`](contract/README.md) — `@runloop/reflex-contract`: Zod schemas and helpers for the contract rules that generated API types cannot express (attachments, sandbox options, agent references). `@reflex/shared` re-exports it, so the server and every client share one definition.
- [`client/`](client/README.md) — `@runloop/reflex-client`: framework-agnostic typed API client (orval-generated from `openapi/openapi.public.json`) plus a `ReflexSocket` for live event streams. Works in browsers and Node.
- [`chat-kit/`](chat-kit/README.md) — `@runloop/reflex-chat-kit`: a shadcn-style CLI that copies a customizable React chat pane (provider, hooks, components) into a consumer app, built on `@runloop/reflex-client` and TanStack React Query.
- [`ui/`](ui/README.md) — `@runloop/reflex-ui`: the same chat components as an importable library, compiled from `chat-kit/registry/` (the single source of truth; `ui/src` is synced by `ui/scripts/sync-registry.mjs` and its tests fail on drift). Import the whole pane or a single piece via subpaths (`@runloop/reflex-ui/components/message-list`).
- [`tui/`](tui/README.md) — `@runloop/reflex-cli`: the terminal client. Browse and chat with agents, launch new ones, and connect this machine as a workstation. Bundled into a single self-contained binary from workspace source.

For a working consumer app built with both packages, see [`sdk/examples/chat-kit-demo`](examples/chat-kit-demo/README.md). The folder also contains other example apps.

## Development

Install dependencies from the repository root, then run the SDK quality gate:

```bash
pnpm install
pnpm sdk:check
```

The quality gate builds and type-checks every package under `sdk/`, runs their unit tests, and validates each public npm tarball with [publint](https://publint.dev/). Run `pnpm format` before opening a pull request.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for source-generation rules and the pull request checklist.

## Security and license

Report vulnerabilities through the repository's [security policy](../.github/SECURITY.md), not a public issue. Code in this directory is available under the [MIT License](LICENSE).

Constraints:

- No runtime dependencies on private `@reflex/*` workspace packages. Contract shapes that the server and external clients must agree on live in `@runloop/reflex-contract`, which `@reflex/shared` re-exports, rather than being duplicated.
- `sdk/client/src/generated/` and `sdk/client/src/react/` are gitignored orval
  output (see `orval.config.ts` at the repo root). `pnpm install` generates
  them from the committed public OpenAPI spec; `pnpm client:check` verifies
  codegen and the hand-authored exports in CI.
