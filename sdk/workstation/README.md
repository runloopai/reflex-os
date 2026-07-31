# @runloop/reflex-workstation

The Reflex workstation wire protocol.

A workstation is a machine a Reflex agent can drive: it connects out to Reflex over a WebSocket, advertises the tools it is willing to run, and executes tool calls against a directory you choose. This package is the message and tool-call contract for that connection, as Zod schemas.

[`@runloop/reflex-cli`](../tui/README.md) implements this protocol in its `connect` command, which is the reference client. Install this package if you are writing your own: a build agent, a container entrypoint, or a workstation embedded in another product.

```bash
npm install @runloop/reflex-workstation
```

## What is in it

- `WorkstationClientMessageSchema` and `WorkstationServerMessageSchema`, the two sides of the connection.
- `WorkstationToolName` and `WORKSTATION_TOOL_PARAM_SCHEMAS`, the tools a workstation may expose, with a Zod schema per tool's parameters.
- Per-tool parameter and result types: `RunCommandParams` / `RunCommandResult`, `ReadFileParams` / `ReadFileResult`, `WriteFileParams` / `WriteFileResult`, `ListDirectoryParams` / `ListDirectoryResult`.
- The limits both sides enforce: `DEFAULT_COMMAND_TIMEOUT_MS`, `MAX_COMMAND_OUTPUT_CHARS`, `DEFAULT_READ_FILE_BYTES`, `MAX_READ_FILE_BYTES`.
- `WORKSTATION_PROTOCOL_VERSION` and `WORKSTATION_CONNECT_PATH`, which a client needs to open the connection.

## Parsing

Parse every inbound frame rather than trusting it. The schemas are the same ones the Reflex server validates against, so a message that fails here would have been rejected anyway:

```ts
import {
  WorkstationServerMessageSchema,
  WORKSTATION_PROTOCOL_VERSION,
} from '@runloop/reflex-workstation';

socket.addEventListener('message', (event) => {
  const message = WorkstationServerMessageSchema.parse(JSON.parse(event.data));
  // message is now a discriminated union, narrowed by `type`
});
```

Handling a tool call means validating its parameters against the schema for that tool:

```ts
import { WORKSTATION_TOOL_PARAM_SCHEMAS } from '@runloop/reflex-workstation';

const params = WORKSTATION_TOOL_PARAM_SCHEMAS[call.tool].parse(call.params);
```

## A note on trust

The protocol describes what an agent may ask for, not what you should allow. A workstation runs commands on a real machine, so the client decides which tools to advertise, which directory they apply to, and whether a call needs human approval first. The CLI exposes those as `--dir` and `--ask`. Treat every tool call as untrusted input.

## Versioning

Semantic versioning, released independently of the other Reflex packages. Below 1.0, a breaking change bumps the minor version. `WORKSTATION_PROTOCOL_VERSION` tracks the wire format separately from the package version.

## License

[MIT](./LICENSE).
