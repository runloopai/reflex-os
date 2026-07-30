# Contributing to the Reflex SDKs

Thanks for improving the Reflex SDKs. Keep changes focused, add tests for behavior changes, and explain any compatibility impact in the pull request.

## Set up the repository

The SDKs currently live in the Reflex monorepo and use its pinned Node and pnpm versions.

```bash
git clone https://github.com/runloopai/reflex.git
cd reflex
pnpm install
pnpm sdk:check
```

Run a single package while iterating:

```bash
pnpm --filter @runloop/reflex-client test
pnpm --filter @runloop/reflex-chat-kit test
pnpm --filter @runloop/reflex-ui test
pnpm --filter reflex-cli test
```

Run `pnpm format` before committing.

## Generated and synchronized sources

Do not edit `client/src/generated/` or `client/src/react/` by hand. They are generated from the public OpenAPI document. From the repository root, run:

```bash
pnpm api:generate
pnpm client:check
```

The chat kit registry is the source of truth for the importable UI package. Edit `chat-kit/registry/`, then synchronize `ui/src/`:

```bash
pnpm --filter @runloop/reflex-ui sync
```

The UI tests fail if those copies drift.

## Pull request checklist

- Add or update focused tests for behavior changes.
- Keep public APIs backward compatible, or call out the breaking change.
- Update the relevant package README when setup or behavior changes.
- Run `pnpm sdk:check` and `pnpm format`.
- Do not commit API keys, session tokens, customer data, or generated build output.

Report security issues through the repository's [security policy](../.github/SECURITY.md), not a public issue.
