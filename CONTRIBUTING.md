# Contributing to the Reflex SDKs

Thanks for improving the Reflex SDKs. Issues and pull requests are welcome here.

## How this repository works

This repository is a read only mirror. The SDKs are developed in Runloop's Reflex repository, in the same tree as the API they talk to, because the client's generated code and the API's OpenAPI document have to move together. An automated export copies the `sdk/` tree here after it passes CI upstream.

Two consequences:

- Commits pushed directly to this repository are overwritten by the next export.
- A merged pull request here is applied upstream by a maintainer, then arrives back as part of the next export. Your change ships, but the commit is authored by the export bot. The pull request stays as the record of the work.

That tradeoff keeps one source of truth. If it blocks something you want to do, open an issue and say so.

## Reporting a bug

Open an issue with the package name and version, a minimal reproduction, what you expected, and what happened. Runtime and framework versions help. For anything security related, follow the [security policy](.github/SECURITY.md) instead.

## Sending a change

Keep changes focused, add tests for behavior changes, and call out any compatibility impact in the pull request.

The packages under `sdk/` build and test here:

```bash
pnpm install
pnpm check
```

That is the same gate the publish workflow runs, so if it passes locally your change builds the way it will ship. `plugins/` is reference source only and is not part of the workspace.

Maintainers apply accepted changes upstream and run the wider monorepo's suite before merging, since these packages are also consumed by the Reflex server and web app.

### Generated and synchronized sources

Some directories are generated. Editing them by hand does not stick, because the generator overwrites them upstream.

- `sdk/client/src/generated/` and `sdk/client/src/react/` are gitignored and
  generated during `pnpm install` from the committed public OpenAPI document.
  If one of these looks wrong, the fix belongs in the API or the generator, so
  describe the problem in an issue.
- `sdk/ui/src/` is copied from `sdk/chat-kit/registry/`, which is the source of truth for the chat components. Edit the registry, not the copy. Tests fail on drift.

### Checklist

- Add or update focused tests for behavior changes.
- Keep public APIs backward compatible, or call out the breaking change.
- Update the relevant package README when setup or behavior changes.
- Do not commit API keys, session tokens, customer data, or build output.

## Versioning

Each package is versioned independently and follows semantic versioning. `@runloop/reflex-chat-kit` and `@runloop/reflex-ui` release together, because both are built from the same component registry.

All packages are below 1.0. While that is true, a breaking change bumps the minor version.
