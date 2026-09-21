import { describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@reflex/plugin-api';

/**
 * The plugin's `register()` wires routes, attachment resolvers, and the
 * sandbox-bridge relay, none of which matter for the two boot fire-and-forget
 * catches under test (`resetPresence` / `pruneAuditLog`). Mock those sibling
 * modules so importing the plugin definition is cheap and the only observable
 * behavior is the boot catch logging.
 */
vi.mock('../server/workstation.routes.js', () => ({
  registerWorkstationRoutes: vi.fn(),
}));
vi.mock('../server/workstation-attachment.js', () => ({
  createWorkstationAttachmentResolver: vi.fn(() => ({})),
  createWorkstationSetupHook: vi.fn(() => ({})),
}));
vi.mock('../server/workstation-tool-relay.js', () => ({
  WORKSTATION_TOOL_PREFIX: 'workstation_',
  createWorkstationToolCallHandler: vi.fn(),
}));
vi.mock('../server/workstation-mcp.js', () => ({ workstationMcp: {} }));
vi.mock('../web-manifest.js', () => ({ workstationWeb: {} }));
vi.mock('../server/schema.js', () => ({}));

import { workstationPlugin } from '../index.js';

type FakeLog = PluginContext['log'] & { warn: ReturnType<typeof vi.fn> };

function makeLog(): FakeLog {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  log.child.mockReturnValue(log);
  return log as unknown as FakeLog;
}

function makeFakeRegistry(overrides: {
  resetPresence: () => Promise<unknown>;
  pruneAuditLog: () => Promise<unknown>;
}) {
  return {
    attachBroadcast: vi.fn(),
    resetPresence: vi.fn(overrides.resetPresence),
    pruneAuditLog: vi.fn(overrides.pruneAuditLog),
    startHeartbeat: vi.fn(),
  };
}

function makeCtx(log: FakeLog, fakeRegistry: ReturnType<typeof makeFakeRegistry>): PluginContext {
  return {
    log,
    services: {
      workstationRegistry: fakeRegistry,
      broadcastService: {},
      sandboxBridgeService: { registerToolCallHandler: vi.fn() },
    },
  } as unknown as PluginContext;
}

/** Drain the fire-and-forget `.catch()` microtasks. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('workstation plugin boot — structured logging', () => {
  it('logs the real Error when resetPresence fails at boot', async () => {
    const log = makeLog();
    const fakeRegistry = makeFakeRegistry({
      resetPresence: () => Promise.reject(new Error('reset boom')),
      pruneAuditLog: () => Promise.resolve(),
    });

    workstationPlugin.server?.register?.({} as never, makeCtx(log, fakeRegistry));
    await flushMicrotasks();

    const resetWarn = log.warn.mock.calls.find(
      (call) => call[1] === 'failed to reset workstation presence at boot',
    );
    expect(resetWarn).toBeDefined();
    expect(resetWarn![0]).toMatchObject({ err: expect.any(Error) });
    expect((resetWarn![0] as { err: Error }).err.message).toBe('reset boom');
    expect(fakeRegistry.resetPresence).toHaveBeenCalledTimes(1);
  });

  it('logs the real Error when pruneAuditLog fails at boot', async () => {
    const log = makeLog();
    const fakeRegistry = makeFakeRegistry({
      resetPresence: () => Promise.resolve(),
      pruneAuditLog: () => Promise.reject(new Error('prune boom')),
    });

    workstationPlugin.server?.register?.({} as never, makeCtx(log, fakeRegistry));
    await flushMicrotasks();

    const pruneWarn = log.warn.mock.calls.find(
      (call) => call[1] === 'failed to prune workstation audit log at boot',
    );
    expect(pruneWarn).toBeDefined();
    expect(pruneWarn![0]).toMatchObject({ err: expect.any(Error) });
    expect((pruneWarn![0] as { err: Error }).err.message).toBe('prune boom');
    expect(fakeRegistry.pruneAuditLog).toHaveBeenCalledTimes(1);
  });
});
