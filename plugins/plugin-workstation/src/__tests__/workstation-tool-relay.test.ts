import { describe, it, expect, vi } from 'vitest';
import type { BridgeToolCallContext } from '@reflex/plugin-api/services';
import {
  WORKSTATION_ATTACHMENT_ID,
  type WorkstationAttachmentConfig,
} from '@runloop/reflex-workstation';
import { createWorkstationToolCallHandler } from '../server/workstation-tool-relay.js';
import type { WorkstationRegistryService } from '../server/workstation-registry.service.js';

/** Minimal registry fake: records the last callTool input and echoes a result. */
function fakeRegistry() {
  const callTool = vi.fn(async (input: unknown) => ({ echoed: input }));
  return { callTool } as unknown as WorkstationRegistryService & {
    callTool: ReturnType<typeof vi.fn>;
  };
}

function ctxFor(
  config: WorkstationAttachmentConfig | undefined,
  overrides: Partial<BridgeToolCallContext['agent']> = {},
): BridgeToolCallContext {
  return {
    agent: {
      id: 'agt_1',
      organizationId: 'org_1',
      userId: 'usr_1',
      attachments: config
        ? [{ attachmentId: WORKSTATION_ATTACHMENT_ID, pluginName: 'workstation', config }]
        : [],
      ...overrides,
    },
  };
}

describe('createWorkstationToolCallHandler', () => {
  it('read-only attachment denies write_file and run_command without touching the registry', async () => {
    const registry = fakeRegistry();
    const handler = createWorkstationToolCallHandler(registry);
    const ctx = ctxFor({ workstationId: 'wks_1', mode: 'read' });

    await expect(handler('workstation_run_command', { command: 'rm -rf /' }, ctx)).rejects.toThrow(
      /workstation_read_only/,
    );
    await expect(
      handler('workstation_write_file', { path: 'a', content: 'x' }, ctx),
    ).rejects.toThrow(/workstation_read_only/);
    expect(registry.callTool).not.toHaveBeenCalled();
  });

  it('read-only attachment allows read_file and derives the workstation id + owner from the attachment', async () => {
    const registry = fakeRegistry();
    const handler = createWorkstationToolCallHandler(registry);
    // A malicious shim tries to retarget another machine via params — ignored.
    await handler(
      'workstation_read_file',
      { path: 'notes.txt', workstationId: 'wks_evil' },
      ctxFor({ workstationId: 'wks_1', mode: 'read' }),
    );
    expect(registry.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        workstationId: 'wks_1',
        organizationId: 'org_1',
        userId: 'usr_1',
        agentId: 'agt_1',
        tool: 'read_file',
        params: { path: 'notes.txt' },
      }),
    );
  });

  it('read-write attachment allows every tool and forwards run_command timeout', async () => {
    const registry = fakeRegistry();
    const handler = createWorkstationToolCallHandler(registry);
    await handler(
      'workstation_run_command',
      { command: 'ls', timeoutMs: 1234 },
      ctxFor({ workstationId: 'wks_1', mode: 'read-write' }),
    );
    expect(registry.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'run_command', timeoutMs: 1234 }),
    );
  });

  it('defaults a mode-less (legacy) attachment to full access', async () => {
    const registry = fakeRegistry();
    const handler = createWorkstationToolCallHandler(registry);
    await handler('workstation_run_command', { command: 'ls' }, ctxFor({ workstationId: 'wks_1' }));
    expect(registry.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'run_command' }),
    );
  });

  it('rejects when the agent has no workstation attachment', async () => {
    const registry = fakeRegistry();
    const handler = createWorkstationToolCallHandler(registry);
    await expect(
      handler('workstation_read_file', { path: 'a' }, ctxFor(undefined)),
    ).rejects.toThrow(/workstation_not_attached/);
    expect(registry.callTool).not.toHaveBeenCalled();
  });

  it('rejects when the agent has no active organization', async () => {
    const registry = fakeRegistry();
    const handler = createWorkstationToolCallHandler(registry);
    const ctx = ctxFor({ workstationId: 'wks_1', mode: 'read-write' }, { organizationId: '' });
    await expect(handler('workstation_read_file', { path: 'a' }, ctx)).rejects.toThrow(
      /no_active_organization/,
    );
    expect(registry.callTool).not.toHaveBeenCalled();
  });

  it('rejects an unowned/system agent', async () => {
    const registry = fakeRegistry();
    const handler = createWorkstationToolCallHandler(registry);
    const ctx = ctxFor({ workstationId: 'wks_1', mode: 'read-write' }, { userId: null });
    await expect(handler('workstation_read_file', { path: 'a' }, ctx)).rejects.toThrow(
      /no_agent_owner/,
    );
    expect(registry.callTool).not.toHaveBeenCalled();
  });

  it('rejects an unknown tool name', async () => {
    const registry = fakeRegistry();
    const handler = createWorkstationToolCallHandler(registry);
    await expect(
      handler('workstation_delete_everything', {}, ctxFor({ workstationId: 'wks_1' })),
    ).rejects.toThrow(/unknown_workstation_tool/);
    expect(registry.callTool).not.toHaveBeenCalled();
  });

  it('rejects params that fail the tool schema', async () => {
    const registry = fakeRegistry();
    const handler = createWorkstationToolCallHandler(registry);
    await expect(
      handler('workstation_run_command', { command: '' }, ctxFor({ workstationId: 'wks_1' })),
    ).rejects.toThrow();
    expect(registry.callTool).not.toHaveBeenCalled();
  });
});
