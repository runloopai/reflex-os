# @runloop/reflex-contract

Zod schemas and helpers for the parts of the [Reflex](https://runloop.ai) contract that are not expressible as generated API types.

[`@runloop/reflex-client`](../client/README.md) covers request and response shapes. It is generated from Reflex's public OpenAPI document, so it never drifts from the running API. What it cannot express is the behavior around those shapes: how a set of files becomes the content blocks of a launch request, which bytes count as an inline image, how a legacy `blueprintId` folds into structured sandbox options. Those rules have to agree between the Reflex server and every client, so they live here as one implementation instead of prose each client reimplements.

Most people do not install this directly. `@runloop/reflex-client` is the entry point for building on Reflex. Reach for this package when you are constructing launch payloads by hand, validating attachments before upload, or writing a client that has to agree with the server byte for byte.

Its only dependency is `zod`.

```bash
npm install @runloop/reflex-contract
```

## What is in it

| Area               | Exports                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Attachments        | `AttachmentSchema`, `buildContentBlocks`, `classifyAttachmentBytes`, `parseFileEnvelopes`, and the `MAX_ATTACHMENT*` size limits |
| Sandbox options    | `SandboxOptionsSchema`, `resolveSandboxOptions`, `ResourceSizeSchema`, `CustomSandboxSizeSchema`                                 |
| Plugin attachments | `PluginAttachmentValueSchema`, `buildGitRepoAttachment`, `GitRepoAttachmentConfigSchema`                                         |
| Agent chat         | `AskUserQuestionItemSchema`, `AskUserQuestionDetailSchema`, `QueuedMessageSchema`, `normalizeAgentRunReferences`                 |
| Entity ids         | `createIdFactory`, `generateId`, `idSchema`, `isId`, `parseId`                                                                   |

## Example

Turn local files into the `content` array of a launch request, applying the same limits the server enforces:

```ts
import { buildContentBlocks, MAX_ATTACHMENTS_COUNT } from '@runloop/reflex-contract';
import { createAgent } from '@runloop/reflex-client';

const content = buildContentBlocks('Fix the failing test', attachments);

await createAgent({ agentType: 'claude-code', prompt: 'Fix the failing test', content });
```

Validate a sandbox override before sending it:

```ts
import { SandboxOptionsSchema, resolveSandboxOptions } from '@runloop/reflex-contract';

const options = resolveSandboxOptions({ blueprintName: 'node_base', sandboxOptions: null });
SandboxOptionsSchema.parse(options);
```

## Versioning

Semantic versioning, released independently of the other Reflex packages. Below 1.0, a breaking change bumps the minor version.

## License

[MIT](./LICENSE).
