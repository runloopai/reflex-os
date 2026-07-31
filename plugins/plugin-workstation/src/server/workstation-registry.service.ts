import { and, desc, eq, lt } from 'drizzle-orm';
import type { PluginContext, PluginLogger } from '@reflex/plugin-api';
import type { WsBroadcastServiceContract } from '@reflex/plugin-api/services';
import {
  CALL_RELAY_GRACE_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_AUDIT_TEXT_CHARS,
  WORKSTATION_CALL_EVENT,
  WORKSTATION_CALL_MAX_LIFETIME_MS,
  WORKSTATION_HEARTBEAT_INTERVAL_MS,
  WORKSTATION_PLUGIN_NAME,
  WORKSTATION_PROTOCOL_VERSION,
  WORKSTATION_STALE_THRESHOLD_MS,
  WORKSTATION_UPDATED_EVENT,
  WorkstationClientMessageSchema,
  workstationIds,
  summarizeToolCall,
  type Workstation,
  type WorkstationClientMessage,
  type WorkstationServerMessage,
  type WorkstationToolCallRecord,
  type WorkstationToolName,
} from '@runloop/reflex-workstation';
import { workstationToolCalls, workstations } from './schema.js';

/** Audit rows older than this are pruned at boot. */
const AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Minimal surface of the `ws` socket the registry needs. Narrowed so unit
 * tests can drive the registry with plain fakes instead of real sockets.
 */
export interface WorkstationSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export class WorkstationServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkstationServiceError';
  }

  static is(err: unknown): err is WorkstationServiceError {
    return err instanceof WorkstationServiceError;
  }
}

interface Connection {
  workstationId: string;
  organizationId: string;
  userId: string;
  socket: WorkstationSocketLike;
  lastSeenAt: number;
}

/** Everything the audit row needs, captured when the call is dispatched. */
interface CallAuditMeta {
  workstationId: string;
  organizationId: string;
  userId: string;
  agentId: string | null;
  tool: WorkstationToolName;
  summary: string;
}

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  /** Timeout window re-armed by each `tool.progress` frame. */
  windowMs: number;
  /** Absolute cutoff — progress slides the window, never past this. */
  deadlineAt: number;
  startedAt: number;
  meta: CallAuditMeta;
}

export interface RegisterWorkstationInput {
  organizationId: string;
  userId: string;
  name: string;
  hostname: string;
  platform: string;
  toolRoot?: string;
  socket: WorkstationSocketLike;
}

export interface CallToolInput {
  workstationId: string;
  organizationId: string;
  /** When set, the target workstation must be owned by this user. */
  userId?: string;
  tool: WorkstationToolName;
  params: unknown;
  timeoutMs?: number;
  /** Agent attribution surfaced in the workstation's activity log and audit trail. */
  agentId?: string;
}

/**
 * Holds the live WebSocket per connected workstation, correlates
 * `tool.call` → `tool.result` frames, and keeps the `workstations` table's
 * presence columns in sync. Connections are in-memory per server instance —
 * the same graceful-degradation stance the agent Execution handles take: a
 * server restart drops presence and clients reconnect.
 *
 * Every completed call (success, tool failure, timeout, or disconnect) is
 * recorded to the `workstation_tool_calls` audit table under the call's
 * correlation id.
 */
export class WorkstationRegistryService {
  private readonly db: PluginContext['db'];
  private readonly log: PluginLogger;
  private broadcast?: WsBroadcastServiceContract;
  private readonly connections = new Map<string, Connection>();
  private readonly pending = new Map<string, PendingCall>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(ctx: PluginContext) {
    this.db = ctx.db;
    this.log = ctx.log.child ? ctx.log.child('workstation-registry') : ctx.log;
  }

  attachBroadcast(broadcast: WsBroadcastServiceContract | undefined): void {
    this.broadcast = broadcast;
  }

  /**
   * Reset every `online` row to `offline`. Called once at plugin boot:
   * sockets never survive a server restart, so any lingering `online`
   * status is stale by definition.
   */
  async resetPresence(): Promise<void> {
    await this.db
      .update(workstations)
      .set({ status: 'offline', connectedAt: null })
      .where(eq(workstations.status, 'online'));
  }

  /** Drop audit rows past the retention window. Called once at boot. */
  async pruneAuditLog(retentionMs = AUDIT_RETENTION_MS): Promise<void> {
    await this.db
      .delete(workstationToolCalls)
      .where(lt(workstationToolCalls.createdAt, Date.now() - retentionMs));
  }

  /**
   * Upsert the workstation row for a newly registered socket and start
   * routing frames for it. A second registration for the same workstation
   * replaces the previous socket (the old one is closed) — last writer
   * wins, matching how a user restarts the TUI without waiting for the
   * server to notice the old socket died.
   */
  async register(input: RegisterWorkstationInput): Promise<Workstation> {
    const now = Date.now();
    const identity = and(
      eq(workstations.organizationId, input.organizationId),
      eq(workstations.userId, input.userId),
      eq(workstations.hostname, input.hostname),
      eq(workstations.name, input.name),
    );
    const existing = await this.db.select().from(workstations).where(identity).limit(1);

    let row: Workstation;
    if (existing.length > 0) {
      const id = existing[0]!.id;
      const [updated] = await this.db
        .update(workstations)
        .set({
          platform: input.platform,
          toolRoot: input.toolRoot ?? null,
          status: 'online',
          connectedAt: now,
          lastSeenAt: now,
        })
        .where(eq(workstations.id, id))
        .returning();
      row = updated as Workstation;
    } else {
      const [inserted] = await this.db
        .insert(workstations)
        .values({
          id: workstationIds.generate('workstation'),
          name: input.name,
          hostname: input.hostname,
          platform: input.platform,
          toolRoot: input.toolRoot ?? null,
          status: 'online',
          userId: input.userId,
          organizationId: input.organizationId,
          connectedAt: now,
          lastSeenAt: now,
          createdAt: now,
        })
        .returning();
      row = inserted as Workstation;
    }

    const previous = this.connections.get(row.id);
    if (previous && previous.socket !== input.socket) {
      try {
        previous.socket.close(1000, 'replaced by a newer connection');
      } catch {
        // Old socket may already be gone.
      }
    }
    this.connections.set(row.id, {
      workstationId: row.id,
      organizationId: input.organizationId,
      userId: input.userId,
      socket: input.socket,
      lastSeenAt: now,
    });

    this.log.info(
      { workstationId: row.id, hostname: row.hostname, name: row.name },
      'workstation connected',
    );
    this.broadcastUpdated(row);
    return row;
  }

  /**
   * Route a raw frame from a registered workstation socket. Returns the
   * parsed message so the route handler can react (e.g. reply to pings).
   */
  handleMessage(workstationId: string, raw: unknown): WorkstationClientMessage | undefined {
    const parsed = WorkstationClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.log.warn({ workstationId }, 'dropping malformed workstation frame');
      return undefined;
    }
    const msg = parsed.data;
    const conn = this.connections.get(workstationId);
    if (conn) conn.lastSeenAt = Date.now();

    if (msg.type === 'tool.progress') {
      const call = this.pending.get(msg.id);
      if (call && call.meta.workstationId === workstationId) this.armCallTimer(msg.id);
      return msg;
    }

    if (msg.type === 'tool.result') {
      const call = this.pending.get(msg.id);
      if (!call || call.meta.workstationId !== workstationId) {
        this.log.warn({ workstationId, callId: msg.id }, 'tool.result with no pending call');
        return msg;
      }
      if (msg.ok) {
        this.settleCall(msg.id, { result: msg.result });
      } else {
        this.settleCall(msg.id, {
          error: new WorkstationServiceError(
            502,
            'workstation_tool_failed',
            msg.error ?? 'Workstation reported a tool failure',
          ),
        });
      }
    }
    return msg;
  }

  /**
   * Mark a workstation offline and reject its in-flight calls. `socket`
   * guards against a stale close racing a fresh registration: when the old
   * socket's `close` event fires after `register()` already swapped in a
   * new one, the disconnect is ignored.
   */
  async disconnect(workstationId: string, socket?: WorkstationSocketLike): Promise<void> {
    const conn = this.connections.get(workstationId);
    if (!conn) return;
    if (socket && conn.socket !== socket) return;
    this.connections.delete(workstationId);

    for (const [callId, call] of this.pending) {
      if (call.meta.workstationId !== workstationId) continue;
      this.settleCall(callId, {
        error: new WorkstationServiceError(
          502,
          'workstation_disconnected',
          'Workstation disconnected while the call was in flight',
        ),
      });
    }

    const [row] = await this.db
      .update(workstations)
      .set({ status: 'offline', connectedAt: null, lastSeenAt: Date.now() })
      .where(eq(workstations.id, workstationId))
      .returning();
    this.log.info({ workstationId }, 'workstation disconnected');
    if (row) this.broadcastUpdated(row as Workstation);
  }

  isOnline(workstationId: string): boolean {
    return this.connections.has(workstationId);
  }

  async list(organizationId: string, userId?: string): Promise<Workstation[]> {
    const scope = userId
      ? and(eq(workstations.organizationId, organizationId), eq(workstations.userId, userId))
      : eq(workstations.organizationId, organizationId);
    const rows = await this.db.select().from(workstations).where(scope);
    // Live socket presence wins over whatever the row says — a row can lag
    // (e.g. between a socket drop and the async status write).
    return (rows as Workstation[])
      .map((row) => ({
        ...row,
        status: this.connections.has(row.id) ? ('online' as const) : ('offline' as const),
      }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  async getById(workstationId: string, organizationId: string): Promise<Workstation | undefined> {
    const rows = await this.db
      .select()
      .from(workstations)
      .where(
        and(eq(workstations.id, workstationId), eq(workstations.organizationId, organizationId)),
      )
      .limit(1);
    const row = rows[0] as Workstation | undefined;
    if (!row) return undefined;
    return { ...row, status: this.connections.has(row.id) ? 'online' : 'offline' };
  }

  /**
   * Recent audit rows for one workstation, owner-scoped: callers who don't
   * own the workstation get the same 404 as a missing id, so the endpoint
   * doesn't confirm other users' machine names.
   */
  async listCalls(
    workstationId: string,
    organizationId: string,
    userId: string,
    limit = 50,
  ): Promise<WorkstationToolCallRecord[]> {
    const workstation = await this.getById(workstationId, organizationId);
    if (!workstation || workstation.userId !== userId) {
      throw new WorkstationServiceError(404, 'workstation_not_found', 'Workstation not found');
    }
    const rows = await this.db
      .select()
      .from(workstationToolCalls)
      .where(eq(workstationToolCalls.workstationId, workstationId))
      .orderBy(desc(workstationToolCalls.createdAt))
      .limit(limit);
    return rows as WorkstationToolCallRecord[];
  }

  async delete(workstationId: string, organizationId: string, userId: string): Promise<void> {
    if (this.connections.has(workstationId)) {
      throw new WorkstationServiceError(
        409,
        'workstation_online',
        'Disconnect the workstation before removing it',
      );
    }
    const deleted = await this.db
      .delete(workstations)
      .where(
        and(
          eq(workstations.id, workstationId),
          eq(workstations.organizationId, organizationId),
          eq(workstations.userId, userId),
        ),
      )
      .returning();
    if (deleted.length === 0) {
      throw new WorkstationServiceError(404, 'workstation_not_found', 'Workstation not found');
    }
  }

  /**
   * Relay one tool call to a connected workstation and await its result.
   * Scope checks (org always, owner when `userId` is provided) happen here
   * so every caller — REST route or MCP tool — enforces the same tenancy
   * rules. The timeout window slides on every `tool.progress` frame (long
   * commands, human approval waits) up to a hard per-call lifetime.
   */
  async callTool(input: CallToolInput): Promise<unknown> {
    const conn = this.connections.get(input.workstationId);
    if (!conn || conn.organizationId !== input.organizationId) {
      throw new WorkstationServiceError(
        409,
        'workstation_offline',
        'Workstation is not connected. Ask its owner to run `reflex-cli connect` on that machine.',
      );
    }
    if (input.userId && conn.userId !== input.userId) {
      throw new WorkstationServiceError(
        403,
        'workstation_not_owned',
        'Only the workstation owner can run tools on it',
      );
    }

    const callId = workstationIds.generate('call');
    const startedAt = Date.now();
    const windowMs = (input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS) + CALL_RELAY_GRACE_MS;
    const frame: WorkstationServerMessage = {
      v: WORKSTATION_PROTOCOL_VERSION,
      type: 'tool.call',
      id: callId,
      tool: input.tool,
      params: input.params,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    };

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(callId, {
        resolve,
        reject,
        timer: setTimeout(() => undefined, 0),
        windowMs,
        deadlineAt: startedAt + WORKSTATION_CALL_MAX_LIFETIME_MS,
        startedAt,
        meta: {
          workstationId: input.workstationId,
          organizationId: input.organizationId,
          userId: input.userId ?? conn.userId,
          agentId: input.agentId ?? null,
          tool: input.tool,
          summary: summarizeToolCall(input.tool, input.params),
        },
      });
      this.armCallTimer(callId);
      try {
        conn.socket.send(JSON.stringify(frame));
      } catch (err) {
        this.settleCall(callId, {
          error: new WorkstationServiceError(
            502,
            'workstation_send_failed',
            err instanceof Error ? err.message : 'Failed to reach the workstation socket',
          ),
        });
      }
    });
  }

  /**
   * Ping every connection on an interval and drop the ones that have gone
   * quiet past the staleness threshold. Timers are unref'd so they never
   * hold the process open.
   */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const ping: WorkstationServerMessage = {
        v: WORKSTATION_PROTOCOL_VERSION,
        type: 'ping',
      };
      for (const conn of [...this.connections.values()]) {
        if (now - conn.lastSeenAt > WORKSTATION_STALE_THRESHOLD_MS) {
          this.log.warn({ workstationId: conn.workstationId }, 'workstation stale; closing');
          try {
            conn.socket.close(1001, 'heartbeat timeout');
          } catch {
            // Socket already dead — disconnect below still cleans up.
          }
          void this.disconnect(conn.workstationId, conn.socket);
          continue;
        }
        try {
          conn.socket.send(JSON.stringify(ping));
        } catch {
          void this.disconnect(conn.workstationId, conn.socket);
        }
      }
    }, WORKSTATION_HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  /** (Re-)arm one call's timeout: the sliding window, capped by the deadline. */
  private armCallTimer(callId: string): void {
    const call = this.pending.get(callId);
    if (!call) return;
    clearTimeout(call.timer);
    const remaining = call.deadlineAt - Date.now();
    const window = Math.min(call.windowMs, remaining);
    if (window <= 0) {
      this.settleCall(callId, {
        error: new WorkstationServiceError(
          504,
          'workstation_call_timeout',
          'Workstation call exceeded its maximum lifetime',
        ),
      });
      return;
    }
    call.timer = setTimeout(() => {
      this.settleCall(callId, {
        error: new WorkstationServiceError(
          504,
          'workstation_call_timeout',
          `Workstation did not answer within ${call.windowMs}ms`,
        ),
      });
    }, window);
    call.timer.unref?.();
  }

  /** Single completion path: resolves/rejects the caller and writes the audit row. */
  private settleCall(
    callId: string,
    outcome: { result?: unknown; error?: WorkstationServiceError },
  ): void {
    const call = this.pending.get(callId);
    if (!call) return;
    this.pending.delete(callId);
    clearTimeout(call.timer);
    this.recordCall(callId, call.meta, outcome.error, Date.now() - call.startedAt);
    if (outcome.error) call.reject(outcome.error);
    else call.resolve(outcome.result);
  }

  /** Fire-and-forget audit insert + owner-facing invalidation ping. */
  private recordCall(
    callId: string,
    meta: CallAuditMeta,
    error: WorkstationServiceError | undefined,
    durationMs: number,
  ): void {
    void this.db
      .insert(workstationToolCalls)
      .values({
        id: callId,
        workstationId: meta.workstationId,
        organizationId: meta.organizationId,
        userId: meta.userId,
        agentId: meta.agentId,
        tool: meta.tool,
        summary: meta.summary,
        ok: !error,
        error: error ? error.message.slice(0, MAX_AUDIT_TEXT_CHARS) : null,
        durationMs,
        createdAt: Date.now(),
      })
      .then(() => {
        this.broadcast?.broadcastPluginEvent(
          WORKSTATION_PLUGIN_NAME,
          WORKSTATION_CALL_EVENT,
          { workstationId: meta.workstationId },
          meta.organizationId,
        );
      })
      .catch((err: unknown) => {
        this.log.warn(
          { callId, err: err instanceof Error ? err.message : String(err) },
          'failed to record workstation tool call',
        );
      });
  }

  private broadcastUpdated(workstation: Workstation): void {
    this.broadcast?.broadcastPluginEvent(
      WORKSTATION_PLUGIN_NAME,
      WORKSTATION_UPDATED_EVENT,
      workstation,
      workstation.organizationId,
    );
  }
}
