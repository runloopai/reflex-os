import { bigint, boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Workstations — user machines running the Reflex TUI in `connect` mode.
 *
 * A row is created on first registration and reused across reconnects: the
 * natural key is `(organizationId, userId, hostname, name)` so the same
 * machine keeps a stable `wks_*` id (and stays selectable in saved drafts)
 * across sessions. `status` reflects live socket presence; rows are stamped
 * with the holding instance's boot-scoped id, reset to `offline` at that
 * instance's boot (sockets do not survive restarts), and swept to `offline`
 * when their instance stops refreshing `last_seen_at` — so at N>1 a
 * restarting replica never wipes a peer's live presence.
 */
export const workstations = pgTable(
  'workstations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    hostname: text('hostname').notNull(),
    platform: text('platform').notNull(),
    toolRoot: text('tool_root'),
    status: text('status').notNull(),
    /**
     * Boot-scoped id of the server instance holding the live socket
     * (`ctx.instanceId`), null while offline. Lets each replica reset or
     * sweep only presence it can speak for: at N>1 a restarting replica
     * must not wipe a peer's live rows.
     */
    connectedInstanceId: text('connected_instance_id'),
    userId: text('user_id').notNull(),
    organizationId: text('organization_id').notNull(),
    connectedAt: bigint('connected_at', { mode: 'number' }),
    lastSeenAt: bigint('last_seen_at', { mode: 'number' }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    uniqueIndex('workstations_identity_unique').on(t.organizationId, t.userId, t.hostname, t.name),
  ],
);

/**
 * Audit trail: one row per tool call relayed to a workstation, written when
 * the call completes (success, tool failure, timeout, or disconnect). The
 * row id is the call's `wtc_*` correlation id, so a log line on the client
 * and the audit row name the same call. Rows older than the retention
 * window are pruned at boot.
 */
export const workstationToolCalls = pgTable(
  'workstation_tool_calls',
  {
    id: text('id').primaryKey(),
    workstationId: text('workstation_id').notNull(),
    organizationId: text('organization_id').notNull(),
    userId: text('user_id').notNull(),
    agentId: text('agent_id'),
    tool: text('tool').notNull(),
    summary: text('summary').notNull(),
    ok: boolean('ok').notNull(),
    error: text('error'),
    durationMs: bigint('duration_ms', { mode: 'number' }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [index('workstation_tool_calls_ws_created_idx').on(t.workstationId, t.createdAt)],
);
