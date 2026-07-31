import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@reflex/plugin-api';
import {
  WORKSTATION_PROTOCOL_VERSION,
  WorkstationServerMessageSchema,
} from '@runloop/reflex-workstation';
import { workstationToolCalls } from '../server/schema.js';
import {
  WorkstationRegistryService,
  WorkstationServiceError,
  type WorkstationSocketLike,
} from '../server/workstation-registry.service.js';

/**
 * The registry's DB access is a handful of drizzle calls; rather than boot
 * PGLite for unit tests we fake the query-builder chains the service uses,
 * with one row store per table. Relay/correlation/presence logic — the part
 * worth specifying — runs for real against fake sockets.
 */

type FakeRow = Record<string, unknown>;

interface FakeDb {
  stores: Map<unknown, FakeRow[]>;
}

function makeDb(): FakeDb & Record<string, unknown> {
  const stores = new Map<unknown, FakeRow[]>();
  const rowsOf = (table: unknown): FakeRow[] => {
    let rows = stores.get(table);
    if (!rows) {
      rows = [];
      stores.set(table, rows);
    }
    return rows;
  };

  const selectResult = (get: () => FakeRow[]) => ({
    limit: (n: number) => Promise.resolve(get().slice(0, n)),
    orderBy: () => ({ limit: (n: number) => Promise.resolve(get().slice(0, n)) }),
    then: (onFulfilled: (rows: FakeRow[]) => unknown, onRejected?: (err: unknown) => unknown) =>
      Promise.resolve(get()).then(onFulfilled, onRejected),
  });

  return {
    stores,
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: () => selectResult(() => rowsOf(table)),
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: (values: FakeRow) => ({
        where: () => {
          const rows = rowsOf(table);
          const updated = rows.map((r) => ({ ...r, ...values }));
          rows.splice(0, rows.length, ...updated);
          const result = Promise.resolve(updated) as Promise<FakeRow[]> & {
            returning: () => Promise<FakeRow[]>;
          };
          result.returning = () => Promise.resolve(updated);
          return result;
        },
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: (values: FakeRow) => {
        const push = () => {
          rowsOf(table).push(values);
          return [values];
        };
        const result = Promise.resolve().then(push) as Promise<FakeRow[]> & {
          returning: () => Promise<FakeRow[]>;
        };
        result.returning = () => Promise.resolve(push());
        return result;
      },
    })),
    delete: vi.fn((table: unknown) => ({
      where: () => {
        const rows = rowsOf(table);
        const deleted = rows.splice(0, rows.length);
        const result = Promise.resolve(deleted) as Promise<FakeRow[]> & {
          returning: () => Promise<FakeRow[]>;
        };
        result.returning = () => Promise.resolve(deleted);
        return result;
      },
    })),
  };
}

function makeCtx(db: ReturnType<typeof makeDb>): PluginContext {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  log.child.mockReturnValue(log);
  return {
    db: db as unknown as PluginContext['db'],
    log: log as unknown as PluginContext['log'],
    secrets: { get: () => undefined },
    config: { get: () => undefined, set: () => undefined, delete: () => undefined },
  } as unknown as PluginContext;
}

class FakeSocket implements WorkstationSocketLike {
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(data: string): void {
    if (this.closed) throw new Error('socket closed');
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  lastFrame(): unknown {
    return JSON.parse(this.sent.at(-1)!);
  }
}

const REGISTER_INPUT = {
  organizationId: 'org_1',
  userId: 'usr_1',
  name: 'MacBook Pro',
  hostname: 'mbp.local',
  platform: 'darwin',
  toolRoot: '/Users/alice/dev',
};

/** Insert of the audit row is fire-and-forget — drain microtasks first. */
async function flushAudit() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('WorkstationRegistryService', () => {
  let registry: WorkstationRegistryService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    registry = new WorkstationRegistryService(makeCtx(db));
  });

  function auditRows(): FakeRow[] {
    return db.stores.get(workstationToolCalls) ?? [];
  }

  it('registers a new workstation online and reuses the row on reconnect', async () => {
    const socketA = new FakeSocket();
    const first = await registry.register({ ...REGISTER_INPUT, socket: socketA });
    expect(first.id).toMatch(/^wks_/);
    expect(first.status).toBe('online');
    expect(registry.isOnline(first.id)).toBe(true);

    const socketB = new FakeSocket();
    const second = await registry.register({ ...REGISTER_INPUT, socket: socketB });
    expect(second.id).toBe(first.id);
    // The replaced socket is closed so two connections never race one row.
    expect(socketA.closed).not.toBeNull();
    expect(registry.isOnline(first.id)).toBe(true);
  });

  it('relays a tool call, resolves with the result, and records an audit row', async () => {
    const socket = new FakeSocket();
    const workstation = await registry.register({ ...REGISTER_INPUT, socket });

    const call = registry.callTool({
      workstationId: workstation.id,
      organizationId: 'org_1',
      userId: 'usr_1',
      agentId: 'agt_1',
      tool: 'run_command',
      params: { command: 'echo hi' },
    });

    const frame = WorkstationServerMessageSchema.parse(socket.lastFrame());
    expect(frame.type).toBe('tool.call');
    if (frame.type !== 'tool.call') throw new Error('unreachable');
    expect(frame.tool).toBe('run_command');

    registry.handleMessage(workstation.id, {
      v: WORKSTATION_PROTOCOL_VERSION,
      type: 'tool.result',
      id: frame.id,
      ok: true,
      result: {
        stdout: 'hi\n',
        stderr: '',
        exitCode: 0,
        durationMs: 5,
        truncated: false,
        timedOut: false,
      },
    });

    await expect(call).resolves.toMatchObject({ stdout: 'hi\n', exitCode: 0 });
    await flushAudit();
    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0]).toMatchObject({
      id: frame.id,
      workstationId: workstation.id,
      userId: 'usr_1',
      agentId: 'agt_1',
      tool: 'run_command',
      summary: 'echo hi',
      ok: true,
      error: null,
    });
  });

  it('rejects the pending call when the workstation reports failure and audits it', async () => {
    const socket = new FakeSocket();
    const workstation = await registry.register({ ...REGISTER_INPUT, socket });
    const call = registry.callTool({
      workstationId: workstation.id,
      organizationId: 'org_1',
      tool: 'read_file',
      params: { path: 'nope.txt' },
    });
    const frame = WorkstationServerMessageSchema.parse(socket.lastFrame());
    if (frame.type !== 'tool.call') throw new Error('unreachable');
    registry.handleMessage(workstation.id, {
      v: WORKSTATION_PROTOCOL_VERSION,
      type: 'tool.result',
      id: frame.id,
      ok: false,
      error: 'ENOENT',
    });
    await expect(call).rejects.toMatchObject({ code: 'workstation_tool_failed' });
    await flushAudit();
    expect(auditRows()[0]).toMatchObject({ ok: false, error: 'ENOENT', summary: 'nope.txt' });
  });

  it('refuses calls for offline, cross-org, and non-owner targets', async () => {
    const socket = new FakeSocket();
    const workstation = await registry.register({ ...REGISTER_INPUT, socket });

    await expect(
      registry.callTool({
        workstationId: 'wks_missing',
        organizationId: 'org_1',
        tool: 'list_directory',
        params: {},
      }),
    ).rejects.toMatchObject({ code: 'workstation_offline' });

    await expect(
      registry.callTool({
        workstationId: workstation.id,
        organizationId: 'org_other',
        tool: 'list_directory',
        params: {},
      }),
    ).rejects.toMatchObject({ code: 'workstation_offline' });

    await expect(
      registry.callTool({
        workstationId: workstation.id,
        organizationId: 'org_1',
        userId: 'usr_intruder',
        tool: 'list_directory',
        params: {},
      }),
    ).rejects.toMatchObject({ code: 'workstation_not_owned', status: 403 });
  });

  it('rejects in-flight calls when the workstation disconnects', async () => {
    const socket = new FakeSocket();
    const workstation = await registry.register({ ...REGISTER_INPUT, socket });
    const call = registry.callTool({
      workstationId: workstation.id,
      organizationId: 'org_1',
      tool: 'run_command',
      params: { command: 'sleep 100' },
    });
    await registry.disconnect(workstation.id, socket);
    await expect(call).rejects.toMatchObject({ code: 'workstation_disconnected' });
    expect(registry.isOnline(workstation.id)).toBe(false);
    await flushAudit();
    expect(auditRows()[0]).toMatchObject({ ok: false });
  });

  it('ignores a stale disconnect from a socket that was already replaced', async () => {
    const socketA = new FakeSocket();
    const workstation = await registry.register({ ...REGISTER_INPUT, socket: socketA });
    const socketB = new FakeSocket();
    await registry.register({ ...REGISTER_INPUT, socket: socketB });

    // The old socket's close event fires after the replacement registered.
    await registry.disconnect(workstation.id, socketA);
    expect(registry.isOnline(workstation.id)).toBe(true);
  });

  it('times out calls the workstation never answers', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const workstation = await registry.register({ ...REGISTER_INPUT, socket });
      const call = registry.callTool({
        workstationId: workstation.id,
        organizationId: 'org_1',
        tool: 'run_command',
        params: { command: 'hang' },
        timeoutMs: 1_000,
      });
      const rejection = expect(call).rejects.toMatchObject({ code: 'workstation_call_timeout' });
      await vi.advanceTimersByTimeAsync(20_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('slides the timeout window on tool.progress frames', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const workstation = await registry.register({ ...REGISTER_INPUT, socket });
      const call = registry.callTool({
        workstationId: workstation.id,
        organizationId: 'org_1',
        tool: 'run_command',
        params: { command: 'slow build' },
        timeoutMs: 1_000, // window = 1s + 15s grace = 16s
      });
      const frame = WorkstationServerMessageSchema.parse(socket.lastFrame());
      if (frame.type !== 'tool.call') throw new Error('unreachable');

      // Two 12s waits with a progress frame in between: 24s total, past the
      // 16s window — but the frame re-armed it, so the call is still alive.
      await vi.advanceTimersByTimeAsync(12_000);
      registry.handleMessage(workstation.id, {
        v: WORKSTATION_PROTOCOL_VERSION,
        type: 'tool.progress',
        id: frame.id,
      });
      await vi.advanceTimersByTimeAsync(12_000);

      registry.handleMessage(workstation.id, {
        v: WORKSTATION_PROTOCOL_VERSION,
        type: 'tool.result',
        id: frame.id,
        ok: true,
        result: { done: true },
      });
      await expect(call).resolves.toEqual({ done: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces the hard per-call lifetime even with steady progress', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const workstation = await registry.register({ ...REGISTER_INPUT, socket });
      const call = registry.callTool({
        workstationId: workstation.id,
        organizationId: 'org_1',
        tool: 'run_command',
        params: { command: 'immortal' },
        timeoutMs: 600_000,
      });
      const frame = WorkstationServerMessageSchema.parse(socket.lastFrame());
      if (frame.type !== 'tool.call') throw new Error('unreachable');
      const rejection = expect(call).rejects.toMatchObject({ code: 'workstation_call_timeout' });

      // Progress every 10s for 31 minutes — past the 30-minute lifetime.
      for (let i = 0; i < 31 * 6; i++) {
        await vi.advanceTimersByTimeAsync(10_000);
        registry.handleMessage(workstation.id, {
          v: WORKSTATION_PROTOCOL_VERSION,
          type: 'tool.progress',
          id: frame.id,
        });
      }
      await vi.advanceTimersByTimeAsync(700_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists audit rows only for the owning user', async () => {
    const socket = new FakeSocket();
    const workstation = await registry.register({ ...REGISTER_INPUT, socket });

    await expect(registry.listCalls(workstation.id, 'org_1', 'usr_intruder')).rejects.toMatchObject(
      { code: 'workstation_not_found', status: 404 },
    );
    await expect(registry.listCalls(workstation.id, 'org_1', 'usr_1')).resolves.toEqual([]);
  });

  it('refuses to delete an online workstation', async () => {
    const socket = new FakeSocket();
    const workstation = await registry.register({ ...REGISTER_INPUT, socket });
    await expect(registry.delete(workstation.id, 'org_1', 'usr_1')).rejects.toSatisfy(
      (err: unknown) => WorkstationServiceError.is(err) && err.status === 409,
    );
  });
});
