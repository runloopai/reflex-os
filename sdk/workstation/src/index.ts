import { z } from 'zod';
import { createIdFactory } from '@runloop/reflex-contract';

/**
 * Shared contract for the workstation plugin: the `Workstation` entity, the
 * `workstation` launch attachment ("Connect"), the tool surface remote agents
 * can call on a connected machine, and the WebSocket wire protocol spoken
 * between the Reflex server and a workstation client (the `reflex-cli`
 * `connect` mode).
 *
 * Everything here is imported by both the server plugin and the terminal
 * client, so the two sides can never drift on frame shapes.
 */

/**
 * Id factory for the entities this protocol names. Exported so a client can
 * validate a `wks_`/`wtc_` id it was handed rather than treating ids as opaque
 * strings.
 */
export const workstationIds = createIdFactory({
  workstation: 'wks',
  call: 'wtc',
} as const);

/** Plugin name — used for `PluginAttachmentValue.pluginName` and plugin events. */
export const WORKSTATION_PLUGIN_NAME = 'workstation';

/** Attachment id shown as "Connect" in the launch dialog. */
export const WORKSTATION_ATTACHMENT_ID = 'workstation';

/** Plugin event broadcast whenever a workstation's presence/row changes. */
export const WORKSTATION_UPDATED_EVENT = 'workstation:updated';
/**
 * Plugin event broadcast after a relayed tool call completes. Payload is an
 * invalidation ping (`{ workstationId }`) only — call details stay behind
 * the owner-scoped audit endpoint rather than fanning out org-wide.
 */
export const WORKSTATION_CALL_EVENT = 'workstation:call';

/**
 * Wire protocol version. Bump only for breaking frame changes; the server
 * rejects registrations whose `v` it does not speak.
 */
export const WORKSTATION_PROTOCOL_VERSION = 1;

/** WebSocket path (under the global `/api` mount + `/workstations` prefix). */
export const WORKSTATION_CONNECT_PATH = '/api/workstations/connect';

// --- Limits ---

/** Combined stdout+stderr cap per command result, in characters. */
export const MAX_COMMAND_OUTPUT_CHARS = 100_000;
/** Hard cap a single `read_file` result may carry (pre-base64 size). */
export const MAX_READ_FILE_BYTES = 2 * 1024 * 1024;
/** Default `read_file` size when the caller does not ask for more. */
export const DEFAULT_READ_FILE_BYTES = 256 * 1024;
/** Default and maximum command timeouts. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
export const MAX_COMMAND_TIMEOUT_MS = 600_000;
/** Extra slack the server adds on top of a call's own timeout before it gives up on the relay. */
export const CALL_RELAY_GRACE_MS = 15_000;
/** Server → workstation heartbeat cadence and staleness threshold. */
export const WORKSTATION_HEARTBEAT_INTERVAL_MS = 25_000;
export const WORKSTATION_STALE_THRESHOLD_MS = 75_000;
/**
 * How often a workstation client emits `tool.progress` while a call is in
 * flight (covering both approval wait and execution). Each frame re-arms
 * the server relay's timeout window, so long builds and slow human
 * approvals don't trip the per-call timeout as long as the client is alive.
 */
export const WORKSTATION_PROGRESS_INTERVAL_MS = 10_000;
/** Absolute ceiling on one relayed call — progress can slide the window, never past this. */
export const WORKSTATION_CALL_MAX_LIFETIME_MS = 30 * 60_000;
/** Audit rows keep at most this much of the call summary / error text. */
export const MAX_AUDIT_TEXT_CHARS = 500;

// --- Entity ---

export const WorkstationStatusSchema = z.enum(['online', 'offline']);
export type WorkstationStatus = z.infer<typeof WorkstationStatusSchema>;

export const WorkstationSchema = z.object({
  id: z.string(),
  name: z.string(),
  hostname: z.string(),
  /** `process.platform` of the workstation client (e.g. `darwin`, `linux`). */
  platform: z.string(),
  /** Directory the workstation confines tool access to, as advertised by the client. */
  toolRoot: z.string().nullable(),
  status: WorkstationStatusSchema,
  userId: z.string(),
  organizationId: z.string(),
  connectedAt: z.number().nullable(),
  lastSeenAt: z.number(),
  createdAt: z.number(),
});
export type Workstation = z.infer<typeof WorkstationSchema>;

// --- Launch attachment ("Connect") ---

/**
 * How much an agent may do on a connected workstation:
 *   - `read`       — inspect only (read files, list directories)
 *   - `read-write` — full control (also write files and run commands)
 *
 * Chosen per attachment in the launch dialog. Attachments minted before the
 * mode existed have no value; treat that as {@link WORKSTATION_DEFAULT_ACCESS_MODE}.
 */
export const WorkstationAccessModeSchema = z.enum(['read', 'read-write']);
export type WorkstationAccessMode = z.infer<typeof WorkstationAccessModeSchema>;

/** Mode assumed when an attachment omits one (matches pre-mode behavior). */
export const WORKSTATION_DEFAULT_ACCESS_MODE: WorkstationAccessMode = 'read-write';

export const WorkstationAttachmentConfigSchema = z.object({
  workstationId: z.string(),
  /** Denormalized for chip display; the server re-resolves the row at launch. */
  workstationName: z.string().optional(),
  /**
   * What the agent may do on the machine. Optional for backward compatibility
   * with attachments minted before modes existed; absent means
   * {@link WORKSTATION_DEFAULT_ACCESS_MODE}.
   */
  mode: WorkstationAccessModeSchema.optional(),
});
export type WorkstationAttachmentConfig = z.infer<typeof WorkstationAttachmentConfigSchema>;

// --- Tools ---

export const WorkstationToolNameSchema = z.enum([
  'run_command',
  'read_file',
  'write_file',
  'list_directory',
]);
export type WorkstationToolName = z.infer<typeof WorkstationToolNameSchema>;

/** Tools that only observe the machine — safe under `read` access. */
export const WORKSTATION_READ_ONLY_TOOLS = [
  'read_file',
  'list_directory',
] as const satisfies readonly WorkstationToolName[];

/** Tools an agent may call under a given access mode. `read` is a strict subset. */
export function workstationToolsForMode(
  mode: WorkstationAccessMode,
): readonly WorkstationToolName[] {
  return mode === 'read'
    ? WORKSTATION_READ_ONLY_TOOLS
    : (['run_command', 'read_file', 'write_file', 'list_directory'] as const);
}

/** Whether `tool` is permitted under `mode`. */
export function isWorkstationToolAllowed(
  tool: WorkstationToolName,
  mode: WorkstationAccessMode,
): boolean {
  return workstationToolsForMode(mode).includes(tool);
}

export const RunCommandParamsSchema = z.object({
  command: z.string().min(1),
  /** Working directory, relative to the workstation's tool root. */
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(MAX_COMMAND_TIMEOUT_MS).optional(),
});
export type RunCommandParams = z.infer<typeof RunCommandParamsSchema>;

export const RunCommandResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  /** `null` when the process was killed by a signal (e.g. the timeout). */
  exitCode: z.number().nullable(),
  durationMs: z.number(),
  truncated: z.boolean(),
  timedOut: z.boolean(),
});
export type RunCommandResult = z.infer<typeof RunCommandResultSchema>;

export const ReadFileParamsSchema = z.object({
  path: z.string().min(1),
  maxBytes: z.number().int().positive().max(MAX_READ_FILE_BYTES).optional(),
});
export type ReadFileParams = z.infer<typeof ReadFileParamsSchema>;

export const ReadFileResultSchema = z.object({
  path: z.string(),
  /** `utf8` for text files; binary content arrives base64-encoded. */
  encoding: z.enum(['utf8', 'base64']),
  content: z.string(),
  /** Full size on disk, which may exceed the returned (possibly truncated) content. */
  size: z.number(),
  truncated: z.boolean(),
});
export type ReadFileResult = z.infer<typeof ReadFileResultSchema>;

export const WriteFileParamsSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']).optional(),
});
export type WriteFileParams = z.infer<typeof WriteFileParamsSchema>;

export const WriteFileResultSchema = z.object({
  path: z.string(),
  bytesWritten: z.number(),
});
export type WriteFileResult = z.infer<typeof WriteFileResultSchema>;

export const ListDirectoryParamsSchema = z.object({
  /** Directory to list, relative to the tool root. Defaults to the root itself. */
  path: z.string().optional(),
});
export type ListDirectoryParams = z.infer<typeof ListDirectoryParamsSchema>;

export const DirectoryEntrySchema = z.object({
  name: z.string(),
  type: z.enum(['file', 'directory', 'symlink', 'other']),
  size: z.number().optional(),
  modifiedAt: z.number().optional(),
});
export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;

export const ListDirectoryResultSchema = z.object({
  path: z.string(),
  entries: z.array(DirectoryEntrySchema),
});
export type ListDirectoryResult = z.infer<typeof ListDirectoryResultSchema>;

/**
 * Param schema per tool. The workstation client validates every incoming
 * `tool.call` against this map before executing, so a compromised or buggy
 * server-side caller can never smuggle unexpected fields to the executor.
 */
export const WORKSTATION_TOOL_PARAM_SCHEMAS = {
  run_command: RunCommandParamsSchema,
  read_file: ReadFileParamsSchema,
  write_file: WriteFileParamsSchema,
  list_directory: ListDirectoryParamsSchema,
} as const satisfies Record<WorkstationToolName, z.ZodTypeAny>;

/**
 * One-line human summary of a call (the command, or the path). Shared by
 * the TUI activity log and the server audit trail so both show the same
 * text. Bounded so a giant script never bloats a log row.
 */
export function summarizeToolCall(tool: WorkstationToolName, params: unknown): string {
  const rec = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  const raw =
    tool === 'run_command'
      ? String(rec.command ?? '')
      : tool === 'list_directory'
        ? String(rec.path ?? '.')
        : String(rec.path ?? '');
  return raw.length > MAX_AUDIT_TEXT_CHARS ? `${raw.slice(0, MAX_AUDIT_TEXT_CHARS - 1)}…` : raw;
}

/** Persisted audit record of one relayed tool call (see the audit endpoint). */
export const WorkstationToolCallRecordSchema = z.object({
  id: z.string(),
  workstationId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  agentId: z.string().nullable(),
  tool: z.string(),
  summary: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  durationMs: z.number(),
  createdAt: z.number(),
});
export type WorkstationToolCallRecord = z.infer<typeof WorkstationToolCallRecordSchema>;

// --- WebSocket protocol: workstation client → server ---

export const WorkstationRegisterSchema = z.object({
  v: z.literal(WORKSTATION_PROTOCOL_VERSION),
  type: z.literal('register'),
  name: z.string().min(1).max(120),
  hostname: z.string().min(1).max(255),
  platform: z.string().min(1).max(64),
  toolRoot: z.string().max(1024).optional(),
});
export type WorkstationRegister = z.infer<typeof WorkstationRegisterSchema>;

export const WorkstationToolResultSchema = z.object({
  v: z.literal(WORKSTATION_PROTOCOL_VERSION),
  type: z.literal('tool.result'),
  /** Correlation id copied verbatim from the originating `tool.call`. */
  id: z.string(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type WorkstationToolResult = z.infer<typeof WorkstationToolResultSchema>;

export const WorkstationPongSchema = z.object({
  v: z.literal(WORKSTATION_PROTOCOL_VERSION),
  type: z.literal('pong'),
});

/**
 * Liveness for one in-flight call: emitted while the call awaits owner
 * approval or the command is still running. Re-arms the relay's timeout
 * window (bounded by {@link WORKSTATION_CALL_MAX_LIFETIME_MS}).
 */
export const WorkstationToolProgressSchema = z.object({
  v: z.literal(WORKSTATION_PROTOCOL_VERSION),
  type: z.literal('tool.progress'),
  id: z.string(),
});

export const WorkstationClientMessageSchema = z.discriminatedUnion('type', [
  WorkstationRegisterSchema,
  WorkstationToolResultSchema,
  WorkstationToolProgressSchema,
  WorkstationPongSchema,
]);
export type WorkstationClientMessage = z.infer<typeof WorkstationClientMessageSchema>;

// --- WebSocket protocol: server → workstation client ---

export const WorkstationRegisteredSchema = z.object({
  v: z.literal(WORKSTATION_PROTOCOL_VERSION),
  type: z.literal('registered'),
  workstation: WorkstationSchema,
});

export const WorkstationToolCallSchema = z.object({
  v: z.literal(WORKSTATION_PROTOCOL_VERSION),
  type: z.literal('tool.call'),
  id: z.string(),
  tool: WorkstationToolNameSchema,
  params: z.unknown(),
  /** Agent on whose behalf the call runs, when known — surfaced in the activity log. */
  agentId: z.string().optional(),
});
export type WorkstationToolCall = z.infer<typeof WorkstationToolCallSchema>;

export const WorkstationPingSchema = z.object({
  v: z.literal(WORKSTATION_PROTOCOL_VERSION),
  type: z.literal('ping'),
});

export const WorkstationServerErrorSchema = z.object({
  v: z.literal(WORKSTATION_PROTOCOL_VERSION),
  type: z.literal('error'),
  message: z.string(),
});

export const WorkstationServerMessageSchema = z.discriminatedUnion('type', [
  WorkstationRegisteredSchema,
  WorkstationToolCallSchema,
  WorkstationPingSchema,
  WorkstationServerErrorSchema,
]);
export type WorkstationServerMessage = z.infer<typeof WorkstationServerMessageSchema>;
