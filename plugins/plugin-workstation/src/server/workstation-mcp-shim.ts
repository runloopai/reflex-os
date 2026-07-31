import type { DevboxProvisionParams } from '@reflex/plugin-api';
import { CLAUDE_USER_CONFIG_PATH, SANDBOX_BRIDGE_IPC_PORT } from '@reflex/shared';
import {
  WORKSTATION_READ_ONLY_TOOLS,
  type WorkstationAccessMode,
  type WorkstationToolName,
} from '@runloop/reflex-workstation';

/**
 * On-box location of the workstation MCP shim. Mounted at devbox create by the
 * workstation setup hook and registered as a local stdio MCP server in the
 * harness config. Lives under the shared reflex bin dir so it survives the
 * snapshot alongside the other on-box helpers.
 */
export const WORKSTATION_SHIM_PATH = '/home/user/.reflex/bin/workstation-mcp-shim.mjs';

/** Env var carrying the attachment's access mode into the shim (`read` | `read-write`). */
export const WORKSTATION_SHIM_MODE_ENV = 'REFLEX_WORKSTATION_MODE';

/** Env var overriding the bridge IPC port the shim posts tool calls to. */
export const WORKSTATION_SHIM_IPC_PORT_ENV = 'FLEX_BRIDGE_IPC_PORT';

/** Logical MCP server name the shim registers under in the harness config. */
export const WORKSTATION_SHIM_SERVER_NAME = 'workstation';

/**
 * The stdio MCP shim, as a self-contained Node ESM script mounted on the
 * devbox. It speaks newline-delimited JSON-RPC (MCP stdio transport) to the
 * agent harness and forwards each `workstation_*` `tools/call` to the on-box
 * flex-bridge IPC surface (`POST 127.0.0.1:<ipc>/tool`), which relays it over
 * the per-agent control socket to Reflex. The server side is the source of
 * truth for the target workstation and access mode; the shim only mode-filters
 * `tools/list` so the agent never sees a tool it may not use.
 *
 * No dependencies (not even the MCP SDK): it must run on a bare devbox with
 * only Node available. All diagnostics go to stderr — stdout is the JSON-RPC
 * channel and must carry nothing else.
 *
 * `SANDBOX_BRIDGE_IPC_PORT` is inlined as the default so the script needs no
 * `@reflex/shared` import at runtime; `FLEX_BRIDGE_IPC_PORT` overrides it.
 */
export const WORKSTATION_SHIM_SCRIPT = `#!/usr/bin/env node
import { createInterface } from 'node:readline';
import http from 'node:http';

const MODE = process.env.${WORKSTATION_SHIM_MODE_ENV} === 'read' ? 'read' : 'read-write';
const IPC_PORT = Number(process.env.${WORKSTATION_SHIM_IPC_PORT_ENV} || ${SANDBOX_BRIDGE_IPC_PORT});
const PROTOCOL_VERSION = '2024-11-05';

// Tool catalog. Names are fully-qualified (workstation_*) so they pass through
// the bridge relay unchanged; the server strips any caller-supplied
// workstationId and binds the target from the agent's attachment.
const TOOLS = [
  {
    name: 'workstation_read_file',
    readOnly: true,
    description:
      "Read a file from the owner's connected workstation. Text returns utf8; binary returns base64. Paths resolve inside the workstation tool root.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, description: 'File path, relative to the tool root.' },
        maxBytes: { type: 'number', description: 'Cap the number of bytes returned.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'workstation_list_directory',
    readOnly: true,
    description:
      "List a directory on the owner's connected workstation. Defaults to the workstation tool root.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to list, relative to the tool root.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'workstation_write_file',
    readOnly: false,
    description:
      "Write a file on the owner's connected workstation (creates parent directories). Paths resolve inside the workstation tool root.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, description: 'File path, relative to the tool root.' },
        content: { type: 'string', description: 'File contents.' },
        encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'How content is encoded.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'workstation_run_command',
    readOnly: false,
    description:
      "Run a shell command on the owner's connected workstation (their real machine — be conservative). Requires the workstation to be online in the Reflex TUI. Paths and cwd resolve inside its tool root.",
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', minLength: 1, description: 'Shell command to run.' },
        cwd: { type: 'string', description: "Working directory, relative to the tool root." },
        timeoutMs: { type: 'number', description: 'Max run time in ms (up to 10 minutes).' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
];

// Only advertise tools the attachment mode permits. Read-only never sees the
// write/command tools, so a well-behaved agent cannot even attempt them; the
// server enforces the same rule as the real gate.
const allowedTools = () => (MODE === 'read' ? TOOLS.filter((t) => t.readOnly) : TOOLS);

function log(...args) {
  // stderr only — stdout is the JSON-RPC channel.
  console.error('[workstation-mcp-shim]', ...args);
}

// POST a tool call to the on-box bridge IPC and resolve its {ok,result,error}.
function postToolCall(tool, params) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ tool, params: params ?? {} });
    const req = http.request(
      {
        host: '127.0.0.1',
        port: IPC_PORT,
        path: '/tool',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode || 0;
          if (status >= 200 && status < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              resolve({
                ok: false,
                error: 'the on-box bridge returned an unreadable response (HTTP ' + status + ')',
              });
            }
            return;
          }
          const body = (data || '').trim();
          if (status === 404) {
            // The IPC is listening but has no /tool route: the flex-bridge binary
            // on this box predates the workstation tool relay. It must be rolled
            // forward (publish:flex, or FLEX_BRIDGE_SOURCE=upload on a fresh box).
            resolve({
              ok: false,
              error:
                'the workstation tool relay is unavailable: the on-box flex-bridge is outdated ' +
                'and has no /tool endpoint (HTTP 404 at 127.0.0.1:' +
                IPC_PORT +
                '/tool). The bridge binary needs to be rolled forward to a build that includes ' +
                'the tool relay.',
            });
            return;
          }
          // 503 reflex_unreachable / 504 tool_timeout carry a short body.
          resolve({ ok: false, error: body || 'bridge returned HTTP ' + status });
        });
      },
    );
    // Nothing listening on the IPC port — the bridge daemon is not running.
    req.on('error', (err) =>
      resolve({
        ok: false,
        error:
          'could not reach the on-box bridge at 127.0.0.1:' +
          IPC_PORT +
          ' (' +
          (err && err.code ? err.code : 'request failed') +
          '); the flex-bridge daemon may not be running.',
      }),
    );
    req.write(body);
    req.end();
  });
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\\n');
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleCall(id, params) {
  const name = params?.name;
  const args = params?.arguments ?? {};
  const tool = allowedTools().find((t) => t.name === name);
  if (!tool) {
    // Unknown to this mode — treat as a tool error the agent can read, not a
    // protocol error, so the harness surfaces the message.
    result(id, {
      isError: true,
      content: [{ type: 'text', text: 'tool "' + name + '" is not available under ' + MODE + ' access' }],
    });
    return;
  }
  const outcome = await postToolCall(name, args);
  if (outcome && outcome.ok) {
    result(id, {
      content: [{ type: 'text', text: JSON.stringify(outcome.result ?? null) }],
    });
  } else {
    const text = (outcome && outcome.error) || 'workstation tool call failed';
    result(id, { isError: true, content: [{ type: 'text', text }] });
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  switch (method) {
    case 'initialize':
      result(id, {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'reflex-workstation', version: '1.0.0' },
      });
      return;
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return; // notifications carry no response
    case 'ping':
      if (!isNotification) result(id, {});
      return;
    case 'tools/list':
      result(id, { tools: allowedTools().map(({ readOnly, ...t }) => t) });
      return;
    case 'tools/call':
      await handleCall(id, params);
      return;
    default:
      if (!isNotification) error(id, -32601, 'method not found: ' + method);
      return;
  }
}

log('starting; mode=' + MODE + ' ipcPort=' + IPC_PORT);
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    log('ignoring non-JSON line');
    return;
  }
  handle(msg).catch((err) => log('handler error', err && err.message ? err.message : err));
});
rl.on('close', () => process.exit(0));
`;

/** Tools the shim advertises for a given mode (mirrors the server-side gate). */
export function shimToolsForMode(mode: WorkstationAccessMode): WorkstationToolName[] {
  const all: WorkstationToolName[] = ['read_file', 'list_directory', 'write_file', 'run_command'];
  return mode === 'read' ? [...WORKSTATION_READ_ONLY_TOOLS] : all;
}

/**
 * The devbox-create params that mount the shim and register it as a local
 * stdio MCP server in the Claude Code config. Mirrors the `jq` merge the
 * generic MCP setup hook uses for local servers (see `buildLocalMcpAddCommands`
 * in `mcp-claude-hook.ts`): one atomic patch of `.mcpServers.workstation` in
 * `$CLAUDE_CONFIG_DIR/.claude.json`, run once (the snapshot carries the config
 * across resume). The shim's `command`/`args`/`env` fully describe the server;
 * the mode env gates which tools it advertises, and the target workstation is
 * resolved server-side from the agent's attachment.
 *
 * Claude Code only for now — the shim is registered via the Claude config
 * format, matching where the feature is validated. Other harnesses need their
 * own registration before they can reach workstation tools.
 */
export function buildWorkstationShimProvisionParams(
  mode: WorkstationAccessMode,
): DevboxProvisionParams {
  const config = CLAUDE_USER_CONFIG_PATH;
  const ensure = `[ -f ${config} ] || echo '{}' > ${config}`;
  const jqArgs = [
    `--arg name '${WORKSTATION_SHIM_SERVER_NAME}'`,
    `--arg cmd 'node'`,
    `--argjson args '${JSON.stringify([WORKSTATION_SHIM_PATH])}'`,
    `--arg mode '${mode}'`,
  ].join(' ');
  const filter =
    `.mcpServers[$name] = {type: "stdio", command: $cmd, args: $args, ` +
    `env: {"${WORKSTATION_SHIM_MODE_ENV}": $mode}}`;
  const merge = [
    ensure,
    `jq ${jqArgs} '${filter}' ${config} > ${config}.tmp`,
    `mv ${config}.tmp ${config}`,
  ].join(' && ');

  return {
    fileMounts: { [WORKSTATION_SHIM_PATH]: WORKSTATION_SHIM_SCRIPT },
    onceLaunchCommands: [{ id: 'connecting_workstation', command: merge }],
  };
}
