# Reflex SDKs

Publishable npm packages for building on Reflex from outside this repo. The client and chat packages authenticate with personal API keys (`POST /api/me/api-keys`). They live here so code generation and CI keep them in sync with the API.

- [`client/`](client/README.md) — `@runloop/reflex-client`: framework-agnostic typed API client (orval-generated from `openapi/openapi.public.json`) plus a `ReflexSocket` for live event streams. Works in browsers and Node.
- [`chat-kit/`](chat-kit/README.md) — `@runloop/reflex-chat-kit`: a shadcn-style CLI that copies a customizable React chat pane (provider, hooks, components) into a consumer app, built on `@runloop/reflex-client` and TanStack React Query.
- [`ui/`](ui/README.md) — `@runloop/reflex-ui`: the same chat components as an importable library, compiled from `chat-kit/registry/` (the single source of truth; `ui/src` is synced by `ui/scripts/sync-registry.mjs` and its tests fail on drift). Import the whole pane or a single piece via subpaths (`@runloop/reflex-ui/components/message-list`).

For a working consumer app built with both packages, see [`sdk/examples/chat-kit-demo`](examples/chat-kit-demo/README.md).

The folder also contains the non-publishable [`reflex-cli`](tui/README.md) package and example apps. The CLI currently bundles private workspace packages, so it is not part of the public npm release.

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

- No runtime dependencies on private `@reflex/*` workspace packages. The few shared shapes (for example the stream event interface) are duplicated with comments pointing at the source of truth.
- `sdk/client/src/generated/` is orval output (see `orval.config.ts` at the repo root). Regenerate with `pnpm client:generate`; `pnpm client:check` fails CI on drift.
