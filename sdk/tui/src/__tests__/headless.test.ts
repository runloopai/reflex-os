import { describe, expect, it, vi } from 'vitest';
import { formatConnectEvent, runHeadlessConnect } from '../connect/headless.js';
import type { ConnectEvent } from '../connect/workstation-client.js';

const AT = new Date('2026-07-13T12:00:00.000Z');

describe('formatConnectEvent', () => {
  it('renders registration with name and id', () => {
    const line = formatConnectEvent(
      {
        kind: 'status',
        status: 'registered',
        workstation: { id: 'wks_1', name: 'laptop' } as never,
      },
      AT,
    );
    expect(line).toBe('2026-07-13T12:00:00.000Z registered as laptop (wks_1)');
  });

  it('renders closed status with an optional detail', () => {
    expect(formatConnectEvent({ kind: 'status', status: 'closed', detail: 'network' }, AT)).toBe(
      '2026-07-13T12:00:00.000Z closed — network',
    );
  });

  it('renders a completed tool call with outcome, timing, and agent', () => {
    const event: ConnectEvent = {
      kind: 'tool',
      id: 't1',
      tool: 'run_command',
      summary: 'ls',
      outcome: 'ok',
      durationMs: 42,
      agentId: 'agt_1',
    };
    expect(formatConnectEvent(event, AT)).toBe(
      '2026-07-13T12:00:00.000Z ok run_command ls (42ms · agt_1)',
    );
  });

  it('renders errors', () => {
    expect(formatConnectEvent({ kind: 'error', message: 'boom' }, AT)).toBe(
      '2026-07-13T12:00:00.000Z error: boom',
    );
  });
});

describe('runHeadlessConnect', () => {
  it('logs events and stops the connection on SIGTERM', async () => {
    const lines: string[] = [];
    let emit: ((event: ConnectEvent) => void) | undefined;
    const handlers: Record<string, () => void> = {};
    const stop = vi.fn();

    const done = runHeadlessConnect({
      connection: { stop },
      registerListener: (listener) => {
        emit = listener;
        return () => undefined;
      },
      write: (line) => lines.push(line),
      proc: {
        once: ((signal: string, handler: () => void) => {
          handlers[signal] = handler;
          return process;
        }) as NodeJS.Process['once'],
      },
    });

    emit?.({ kind: 'error', message: 'boom' });
    expect(lines.some((l) => l.endsWith('error: boom'))).toBe(true);

    handlers.SIGTERM?.();
    await done;
    expect(stop).toHaveBeenCalledTimes(1);
    expect(lines.some((l) => l.includes('received SIGTERM'))).toBe(true);
  });
});
