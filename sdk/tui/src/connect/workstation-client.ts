import { hostname as osHostname } from 'node:os';
import {
  WORKSTATION_CONNECT_PATH,
  WORKSTATION_PROGRESS_INTERVAL_MS,
  WORKSTATION_PROTOCOL_VERSION,
  WorkstationServerMessageSchema,
  summarizeToolCall,
  type Workstation,
  type WorkstationClientMessage,
  type WorkstationToolCall,
  type WorkstationToolName,
} from '@runloop/reflex-workstation';
import type { ToolExecutor } from './executor.js';
import type { GateInput, GateResult } from './policy.js';

export type ConnectEvent =
  | {
      kind: 'status';
      status: 'connecting' | 'registered' | 'closed';
      workstation?: Workstation;
      detail?: string;
    }
  | {
      kind: 'tool-start';
      id: string;
      tool: WorkstationToolName;
      summary: string;
      agentId?: string;
    }
  | {
      kind: 'tool';
      id: string;
      tool: WorkstationToolName;
      summary: string;
      outcome: 'ok' | 'failed' | 'denied';
      durationMs: number;
      agentId?: string;
    }
  | { kind: 'error'; message: string };

/** Structural slice of {@link ToolApprover} the connection needs. */
export interface CallGate {
  gate(input: GateInput): Promise<GateResult>;
}

export interface WorkstationConnectionOptions {
  baseUrl: string;
  apiKey: string;
  organizationId?: string;
  /** Display name for this machine; defaults to its hostname. */
  name?: string;
  toolRoot: string;
  executor: ToolExecutor;
  /** Permission gate for exec/write calls; omitted = everything allowed. */
  approver?: CallGate;
  onEvent?: (event: ConnectEvent) => void;
  /** Injectable for tests; defaults to the global WebSocket (Node ≥ 22). */
  webSocket?: typeof WebSocket;
}

export function buildConnectUrl(baseUrl: string, apiKey: string, organizationId?: string): string {
  const url = new URL(WORKSTATION_CONNECT_PATH, baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  // WS handshakes can't carry an Authorization header from every runtime —
  // the server's auth middleware accepts `?token=` on upgrade requests only.
  url.searchParams.set('token', apiKey);
  if (organizationId) url.searchParams.set('organizationId', organizationId);
  return url.toString();
}

/**
 * Registers this machine as a Reflex workstation and serves the tool calls
 * agents relay through the server. Reconnects with exponential backoff
 * (1s → 30s) until `stop()` — the same posture as the web/SDK sockets.
 *
 * While a call is in flight (either awaiting the owner's approval or still
 * executing) the connection emits `tool.progress` heartbeats so the server
 * relay keeps the call alive instead of timing out on the original window.
 */
export class WorkstationConnection {
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoffMs = 1_000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private workstationValue: Workstation | null = null;
  private readonly inFlight = new Map<string, { controller: AbortController; socket: WebSocket }>();

  constructor(private readonly options: WorkstationConnectionOptions) {}

  get workstation(): Workstation | null {
    return this.workstationValue;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.abortAllCalls();
    this.ws?.close(1000, 'client shutdown');
    this.ws = null;
  }

  private emit(event: ConnectEvent): void {
    this.options.onEvent?.(event);
  }

  private connect(): void {
    const WebSocketImpl = this.options.webSocket ?? globalThis.WebSocket;
    if (!WebSocketImpl) {
      this.emit({ kind: 'error', message: 'No WebSocket implementation available' });
      return;
    }
    this.emit({ kind: 'status', status: 'connecting' });
    const socket = new WebSocketImpl(
      buildConnectUrl(this.options.baseUrl, this.options.apiKey, this.options.organizationId),
    );
    this.ws = socket;

    socket.addEventListener('open', () => {
      this.send({
        v: WORKSTATION_PROTOCOL_VERSION,
        type: 'register',
        name: this.options.name ?? osHostname(),
        hostname: osHostname(),
        platform: process.platform,
        toolRoot: this.options.toolRoot,
      });
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      void this.handleFrame(
        typeof event.data === 'string' ? event.data : String(event.data),
        socket,
      );
    });

    socket.addEventListener('close', (event: CloseEvent) => {
      if (this.ws !== socket) return;
      this.abortCallsForSocket(socket);
      this.ws = null;
      this.emit({ kind: 'status', status: 'closed', detail: event.reason || undefined });
      if (!this.stopped) this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // close fires after error and owns reconnection.
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private send(message: WorkstationClientMessage): void {
    try {
      this.ws?.send(JSON.stringify(message));
    } catch {
      // Socket is closing; reconnect logic owns recovery.
    }
  }

  private async handleFrame(data: string, socket: WebSocket): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      this.emit({ kind: 'error', message: 'Server sent a non-JSON frame' });
      return;
    }
    const parsed = WorkstationServerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.emit({ kind: 'error', message: 'Server sent an unrecognized frame' });
      return;
    }
    const msg = parsed.data;
    switch (msg.type) {
      case 'ping':
        this.send({ v: WORKSTATION_PROTOCOL_VERSION, type: 'pong' });
        return;
      case 'registered':
        this.backoffMs = 1_000;
        this.workstationValue = msg.workstation;
        this.emit({ kind: 'status', status: 'registered', workstation: msg.workstation });
        return;
      case 'error':
        this.emit({ kind: 'error', message: msg.message });
        return;
      case 'tool.call':
        await this.handleToolCall(msg, socket);
        return;
    }
  }

  private async handleToolCall(call: WorkstationToolCall, socket: WebSocket): Promise<void> {
    const startedAt = Date.now();
    const controller = new AbortController();
    this.inFlight.get(call.id)?.controller.abort(new Error('Duplicate workstation call id'));
    this.inFlight.set(call.id, { controller, socket });
    const summary = summarizeToolCall(call.tool, call.params);
    this.emit({
      kind: 'tool-start',
      id: call.id,
      tool: call.tool,
      summary,
      agentId: call.agentId,
    });

    // Keep the server relay alive through approval waits and long commands.
    const progress = setInterval(() => {
      this.sendOn(socket, {
        v: WORKSTATION_PROTOCOL_VERSION,
        type: 'tool.progress',
        id: call.id,
      });
    }, WORKSTATION_PROGRESS_INTERVAL_MS);
    progress.unref?.();

    const finish = (
      outcome: 'ok' | 'failed' | 'denied',
      response: { ok: boolean; result?: unknown; error?: string },
      detail?: string,
    ) => {
      clearInterval(progress);
      this.sendOn(socket, {
        v: WORKSTATION_PROTOCOL_VERSION,
        type: 'tool.result',
        id: call.id,
        ...response,
      });
      this.emit({
        kind: 'tool',
        id: call.id,
        tool: call.tool,
        summary: detail ? `${summary} — ${detail}` : summary,
        outcome,
        durationMs: Date.now() - startedAt,
        agentId: call.agentId,
      });
    };

    try {
      const gate = this.options.approver
        ? await this.options.approver.gate({
            callId: call.id,
            tool: call.tool,
            summary,
            agentId: call.agentId,
            signal: controller.signal,
          })
        : { allowed: true as const };
      controller.signal.throwIfAborted();
      if (!gate.allowed) {
        const reason = gate.reason ?? 'denied by the workstation owner';
        finish('denied', { ok: false, error: reason }, reason);
        return;
      }
      const result = await this.options.executor.execute(call.tool, call.params, controller.signal);
      controller.signal.throwIfAborted();
      finish('ok', { ok: true, result });
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      finish('failed', { ok: false, error: message }, message);
    } finally {
      clearInterval(progress);
      if (this.inFlight.get(call.id)?.controller === controller) this.inFlight.delete(call.id);
    }
  }

  private sendOn(socket: WebSocket, message: WorkstationClientMessage): void {
    if (this.ws !== socket) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // Socket is closing; reconnect logic owns recovery.
    }
  }

  private abortCallsForSocket(socket: WebSocket): void {
    for (const call of this.inFlight.values()) {
      if (call.socket === socket) call.controller.abort(new Error('Workstation disconnected'));
    }
  }

  private abortAllCalls(): void {
    for (const call of this.inFlight.values()) {
      call.controller.abort(new Error('Workstation connection stopped'));
    }
  }
}
