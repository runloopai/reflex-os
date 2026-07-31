import { describe, expect, it, vi } from 'vitest';
import {
  WORKSTATION_PROTOCOL_VERSION,
  WorkstationClientMessageSchema,
} from '@runloop/reflex-workstation';
import {
  WorkstationConnection,
  buildConnectUrl,
  type CallGate,
  type ConnectEvent,
} from '../connect/workstation-client.js';
import type { ToolExecutor } from '../connect/executor.js';

type Listener = (event: { data?: string; reason?: string }) => void;

/** Minimal fake of the WHATWG WebSocket surface the connection uses. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, listener]);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.emit('close', { reason: 'client' });
  }

  emit(type: string, event: { data?: string; reason?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  lastSent(): unknown {
    return JSON.parse(this.sent.at(-1)!);
  }
}

function makeConnection(executor?: Partial<ToolExecutor>, approver?: CallGate) {
  FakeWebSocket.instances = [];
  const events: ConnectEvent[] = [];
  const connection = new WorkstationConnection({
    baseUrl: 'https://reflex.example.com',
    apiKey: 'rfx_test',
    organizationId: 'org_1',
    name: 'Test Machine',
    toolRoot: '/tmp/root',
    executor: {
      execute: executor?.execute ?? vi.fn().mockResolvedValue({ ok: true }),
    },
    approver,
    onEvent: (event) => events.push(event),
    webSocket: FakeWebSocket as unknown as typeof WebSocket,
  });
  connection.start();
  const socket = FakeWebSocket.instances.at(-1)!;
  return { connection, socket, events };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('buildConnectUrl', () => {
  it('builds a ws(s) URL with token and org', () => {
    const url = new URL(buildConnectUrl('https://reflex.example.com', 'rfx_k', 'org_9'));
    expect(url.protocol).toBe('wss:');
    expect(url.pathname).toBe('/api/workstations/connect');
    expect(url.searchParams.get('token')).toBe('rfx_k');
    expect(url.searchParams.get('organizationId')).toBe('org_9');
  });

  it('downgrades to ws: for http origins', () => {
    expect(buildConnectUrl('http://localhost:4000', 'k')).toMatch(/^ws:/);
  });
});

describe('WorkstationConnection', () => {
  it('registers on open with a valid protocol frame', () => {
    const { socket, connection } = makeConnection();
    socket.emit('open');
    const frame = WorkstationClientMessageSchema.parse(socket.lastSent());
    expect(frame.type).toBe('register');
    if (frame.type !== 'register') throw new Error('unreachable');
    expect(frame.v).toBe(WORKSTATION_PROTOCOL_VERSION);
    expect(frame.name).toBe('Test Machine');
    expect(frame.toolRoot).toBe('/tmp/root');
    connection.stop();
  });

  it('answers pings with pongs', async () => {
    const { socket, connection } = makeConnection();
    socket.emit('open');
    socket.emit('message', {
      data: JSON.stringify({ v: WORKSTATION_PROTOCOL_VERSION, type: 'ping' }),
    });
    await flush();
    expect(socket.lastSent()).toMatchObject({ type: 'pong' });
    connection.stop();
  });

  it('executes tool calls and replies with the result', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: 'done' });
    const { socket, connection, events } = makeConnection({ execute });
    socket.emit('open');
    socket.emit('message', {
      data: JSON.stringify({
        v: WORKSTATION_PROTOCOL_VERSION,
        type: 'tool.call',
        id: 'wtc_1',
        tool: 'run_command',
        params: { command: 'echo done' },
        agentId: 'agt_1',
      }),
    });
    await flush();
    expect(execute).toHaveBeenCalledWith(
      'run_command',
      { command: 'echo done' },
      expect.any(AbortSignal),
    );
    expect(socket.lastSent()).toMatchObject({
      type: 'tool.result',
      id: 'wtc_1',
      ok: true,
      result: { stdout: 'done' },
    });
    expect(events.find((e) => e.kind === 'tool-start')).toMatchObject({
      id: 'wtc_1',
      tool: 'run_command',
      summary: 'echo done',
    });
    const toolEvent = events.find((e) => e.kind === 'tool');
    expect(toolEvent).toMatchObject({
      id: 'wtc_1',
      outcome: 'ok',
      tool: 'run_command',
      agentId: 'agt_1',
    });
    connection.stop();
  });

  it('reports executor failures as ok:false results', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('denied'));
    const { socket, connection } = makeConnection({ execute });
    socket.emit('open');
    socket.emit('message', {
      data: JSON.stringify({
        v: WORKSTATION_PROTOCOL_VERSION,
        type: 'tool.call',
        id: 'wtc_2',
        tool: 'read_file',
        params: { path: 'x' },
      }),
    });
    await flush();
    expect(socket.lastSent()).toMatchObject({
      type: 'tool.result',
      id: 'wtc_2',
      ok: false,
      error: 'denied',
    });
    connection.stop();
  });

  it('surfaces registered status with the workstation row', async () => {
    const { socket, connection, events } = makeConnection();
    socket.emit('open');
    socket.emit('message', {
      data: JSON.stringify({
        v: WORKSTATION_PROTOCOL_VERSION,
        type: 'registered',
        workstation: {
          id: 'wks_1',
          name: 'Test Machine',
          hostname: 'host',
          platform: 'linux',
          toolRoot: '/tmp/root',
          status: 'online',
          userId: 'usr_1',
          organizationId: 'org_1',
          connectedAt: 1,
          lastSeenAt: 1,
          createdAt: 1,
        },
      }),
    });
    await flush();
    expect(connection.workstation?.id).toBe('wks_1');
    expect(events.some((e) => e.kind === 'status' && e.status === 'registered')).toBe(true);
    connection.stop();
  });

  it('relays approver denials as ok:false results without executing', async () => {
    const execute = vi.fn();
    const gate = vi.fn().mockResolvedValue({ allowed: false, reason: 'denied by the owner' });
    const { socket, connection, events } = makeConnection({ execute }, { gate });
    socket.emit('open');
    socket.emit('message', {
      data: JSON.stringify({
        v: WORKSTATION_PROTOCOL_VERSION,
        type: 'tool.call',
        id: 'wtc_3',
        tool: 'run_command',
        params: { command: 'rm -rf /' },
      }),
    });
    await flush();
    expect(gate).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'wtc_3', tool: 'run_command', summary: 'rm -rf /' }),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(socket.lastSent()).toMatchObject({
      type: 'tool.result',
      id: 'wtc_3',
      ok: false,
      error: 'denied by the owner',
    });
    expect(events.find((e) => e.kind === 'tool')).toMatchObject({ outcome: 'denied' });
    connection.stop();
  });

  it('sends tool.progress heartbeats while a call is in flight', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: unknown) => void;
      const execute = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const { socket, connection } = makeConnection({ execute });
      socket.emit('open');
      socket.emit('message', {
        data: JSON.stringify({
          v: WORKSTATION_PROTOCOL_VERSION,
          type: 'tool.call',
          id: 'wtc_4',
          tool: 'run_command',
          params: { command: 'slow build' },
        }),
      });
      await vi.advanceTimersByTimeAsync(25_000);
      const progress = socket.sent
        .map((s) => JSON.parse(s) as { type: string; id?: string })
        .filter((f) => f.type === 'tool.progress');
      expect(progress.length).toBeGreaterThanOrEqual(2);
      expect(progress[0]).toMatchObject({ id: 'wtc_4' });

      finish({ done: true });
      await vi.advanceTimersByTimeAsync(1);
      expect(socket.lastSent()).toMatchObject({ type: 'tool.result', id: 'wtc_4', ok: true });
      // Heartbeats stop once the call settles.
      const before = socket.sent.length;
      await vi.advanceTimersByTimeAsync(60_000);
      const later = socket.sent
        .slice(before)
        .map((s) => JSON.parse(s) as { type: string })
        .filter((f) => f.type === 'tool.progress');
      expect(later).toHaveLength(0);
      connection.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts in-flight execution and does not reply on a stopped socket', async () => {
    let receivedSignal: AbortSignal | undefined;
    const execute = vi.fn().mockImplementation((_tool, _params, signal: AbortSignal) => {
      receivedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const { socket, connection } = makeConnection({ execute });
    socket.emit('open');
    socket.emit('message', {
      data: JSON.stringify({
        v: WORKSTATION_PROTOCOL_VERSION,
        type: 'tool.call',
        id: 'wtc_cancel',
        tool: 'run_command',
        params: { command: 'slow build' },
      }),
    });
    await flush();
    const beforeStop = socket.sent.length;

    connection.stop();
    await flush();

    expect(receivedSignal?.aborted).toBe(true);
    expect(socket.sent.slice(beforeStop)).toHaveLength(0);
  });

  it('ignores malformed frames without dying', async () => {
    const { socket, connection, events } = makeConnection();
    socket.emit('open');
    socket.emit('message', { data: 'not json' });
    socket.emit('message', { data: JSON.stringify({ hello: 'world' }) });
    await flush();
    expect(events.filter((e) => e.kind === 'error')).toHaveLength(2);
    connection.stop();
  });
});
