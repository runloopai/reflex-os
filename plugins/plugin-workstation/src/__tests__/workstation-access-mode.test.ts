import { describe, it, expect, vi } from 'vitest';
import type { PluginAgentRef, PluginContext } from '@reflex/plugin-api';
import {
  WORKSTATION_DEFAULT_ACCESS_MODE,
  WorkstationAttachmentConfigSchema,
  isWorkstationToolAllowed,
  workstationToolsForMode,
} from '@runloop/reflex-workstation';
import {
  buildWorkstationPromptSection,
  createWorkstationAttachmentResolver,
} from '../server/workstation-attachment.js';
import type { Workstation } from '@runloop/reflex-workstation';

const workstation: Workstation = {
  id: 'wks_abc',
  name: 'MacBook Pro',
  hostname: 'mbp.local',
  platform: 'darwin',
  toolRoot: '/Users/alice/dev',
  status: 'online',
  userId: 'usr_1',
  organizationId: 'org_1',
  connectedAt: 1,
  lastSeenAt: 1,
  createdAt: 1,
};

describe('workstation access mode', () => {
  it('defaults to full access for backward compatibility', () => {
    expect(WORKSTATION_DEFAULT_ACCESS_MODE).toBe('read-write');
  });

  it('read mode permits only inspection tools', () => {
    expect([...workstationToolsForMode('read')]).toEqual(['read_file', 'list_directory']);
    expect(isWorkstationToolAllowed('read_file', 'read')).toBe(true);
    expect(isWorkstationToolAllowed('list_directory', 'read')).toBe(true);
    expect(isWorkstationToolAllowed('write_file', 'read')).toBe(false);
    expect(isWorkstationToolAllowed('run_command', 'read')).toBe(false);
  });

  it('read-write mode permits every tool', () => {
    for (const tool of ['run_command', 'read_file', 'write_file', 'list_directory'] as const) {
      expect(isWorkstationToolAllowed(tool, 'read-write')).toBe(true);
    }
  });
});

describe('WorkstationAttachmentConfigSchema', () => {
  it('accepts a config without a mode (legacy attachments)', () => {
    const parsed = WorkstationAttachmentConfigSchema.parse({ workstationId: 'wks_abc' });
    expect(parsed.mode).toBeUndefined();
  });

  it('accepts a valid mode and rejects an unknown one', () => {
    expect(WorkstationAttachmentConfigSchema.parse({ workstationId: 'w', mode: 'read' }).mode).toBe(
      'read',
    );
    expect(
      WorkstationAttachmentConfigSchema.safeParse({ workstationId: 'w', mode: 'admin' }).success,
    ).toBe(false);
  });
});

describe('workstation attachment ownership', () => {
  const config = { workstationId: workstation.id };
  const agent = (userId: string | null): PluginAgentRef => ({
    id: 'agt_1',
    devboxId: null,
    streamId: null,
    status: 'running',
    organizationId: workstation.organizationId,
    ownerId: userId,
    userId,
  });

  it('does not resolve a workstation for an unowned/system agent', async () => {
    const getById = vi.fn().mockResolvedValue(workstation);
    const ctx = {
      services: { workstationRegistry: { getById } },
      log: { warn: vi.fn() },
    } as unknown as PluginContext;

    const resolved = await createWorkstationAttachmentResolver().resolve(ctx, config, agent(null));

    expect(resolved).toBeUndefined();
    expect(getById).not.toHaveBeenCalled();
  });

  it("resolves only the owning user's workstation", async () => {
    const getById = vi.fn().mockResolvedValue(workstation);
    const ctx = {
      services: { workstationRegistry: { getById } },
      log: { warn: vi.fn() },
    } as unknown as PluginContext;
    const resolver = createWorkstationAttachmentResolver();

    await expect(resolver.resolve(ctx, config, agent('usr_other'))).resolves.toBeUndefined();
    await expect(resolver.resolve(ctx, config, agent(workstation.userId))).resolves.toMatchObject({
      workstation,
    });
  });
});

describe('buildWorkstationPromptSection', () => {
  it('advertises the write and command tools under read-write', () => {
    const section = buildWorkstationPromptSection(workstation, 'read-write');
    expect(section).toContain('workstation_run_command');
    expect(section).toContain('workstation_write_file');
    expect(section).toContain('read & write');
  });

  it('omits the write and command tools under read-only', () => {
    const section = buildWorkstationPromptSection(workstation, 'read');
    expect(section).toContain('read-only');
    expect(section).toContain('workstation_read_file');
    expect(section).not.toContain('workstation_run_command');
    expect(section).not.toContain('workstation_write_file');
  });

  it('defaults to full access when no mode is given', () => {
    expect(buildWorkstationPromptSection(workstation)).toContain('workstation_run_command');
  });

  it('names the machine but advertises no tools when they are unavailable', () => {
    const section = buildWorkstationPromptSection(workstation, 'read-write', false);
    // Still identifies the connected machine…
    expect(section).toContain(workstation.name);
    expect(section).toContain(workstation.hostname);
    // …but never instructs the agent to call tools it does not have.
    expect(section).not.toContain('workstation_run_command');
    expect(section).not.toContain('workstation_read_file');
    expect(section).toContain('could not be wired up');
    expect(section).toContain('unavailable this run');
  });

  it('advertises tools when explicitly available', () => {
    const section = buildWorkstationPromptSection(workstation, 'read-write', true);
    expect(section).toContain('workstation_run_command');
  });
});
