import { z } from 'zod';
import type { PluginMcpDefinition, PluginMcpToolContext } from '@reflex/plugin-api';
import {
  ListDirectoryParamsSchema,
  ReadFileParamsSchema,
  RunCommandParamsSchema,
  WriteFileParamsSchema,
  type WorkstationToolName,
} from '@runloop/reflex-workstation';
import type { WorkstationRegistryService } from './workstation-registry.service.js';

/**
 * MCP tools agents use to reach a connected workstation. They ride on
 * Reflex's own `/api/mcp` endpoint: the per-agent session bearer minted by
 * plugin-mcp's self-MCP provider authenticates the call as the agent's
 * owner, so `ctx.userId`/`ctx.organizationId` here are the owner's — and
 * the registry enforces that only the owner can target their workstation.
 *
 * Every tool takes an explicit `workstationId`; the launch-time prompt
 * section (see `buildWorkstationPromptSection`) tells the agent which id
 * its Connect attachment bound.
 */

const WorkstationIdSchema = z.object({
  workstationId: z.string().min(1).describe('Target workstation id (wks_...)'),
});

function requireScope(ctx: PluginMcpToolContext): { organizationId: string; userId?: string } {
  if (typeof ctx.organizationId !== 'string') {
    throw new Error('no_active_organization: workstation tools require an org-scoped session');
  }
  return { organizationId: ctx.organizationId, userId: ctx.userId };
}

function registryFrom(ctx: PluginMcpToolContext): WorkstationRegistryService {
  const registry = ctx.services.workstationRegistry as WorkstationRegistryService | undefined;
  if (!registry) throw new Error('workstation plugin is not active');
  return registry;
}

function makeHandler(tool: WorkstationToolName, paramsSchema: z.ZodTypeAny) {
  return async (input: unknown, ctx: PluginMcpToolContext): Promise<unknown> => {
    const { workstationId, ...rest } = WorkstationIdSchema.loose().parse(input);
    const params = paramsSchema.parse(rest);
    const { organizationId, userId } = requireScope(ctx);
    const timeoutMs =
      tool === 'run_command' ? (params as { timeoutMs?: number }).timeoutMs : undefined;
    return registryFrom(ctx).callTool({
      workstationId,
      organizationId,
      userId,
      tool,
      params,
      timeoutMs,
    });
  };
}

export const workstationMcp: PluginMcpDefinition = {
  tools: [
    {
      name: 'workstation_run_command',
      title: 'Run command on workstation',
      description:
        "Run a shell command on the owner's connected workstation (their real machine — be conservative). " +
        'Requires the workstation to be online in the Reflex TUI. Paths and cwd resolve inside its tool root.',
      inputSchema: WorkstationIdSchema.extend(RunCommandParamsSchema.shape),
      rbac: { read: 'agents:read', write: 'agents:write' },
      handler: makeHandler('run_command', RunCommandParamsSchema),
    },
    {
      name: 'workstation_read_file',
      title: 'Read file from workstation',
      description:
        "Read a file from the owner's connected workstation. Text returns utf8; binary returns base64. " +
        'Paths resolve inside the workstation tool root.',
      inputSchema: WorkstationIdSchema.extend(ReadFileParamsSchema.shape),
      readOnly: true,
      rbac: { read: 'agents:read' },
      handler: makeHandler('read_file', ReadFileParamsSchema),
    },
    {
      name: 'workstation_write_file',
      title: 'Write file on workstation',
      description:
        "Write a file on the owner's connected workstation (creates parent directories). " +
        'Paths resolve inside the workstation tool root.',
      inputSchema: WorkstationIdSchema.extend(WriteFileParamsSchema.shape),
      rbac: { read: 'agents:read', write: 'agents:write' },
      handler: makeHandler('write_file', WriteFileParamsSchema),
    },
    {
      name: 'workstation_list_directory',
      title: 'List workstation directory',
      description:
        "List a directory on the owner's connected workstation. Defaults to the workstation tool root.",
      inputSchema: WorkstationIdSchema.extend(ListDirectoryParamsSchema.shape),
      readOnly: true,
      rbac: { read: 'agents:read' },
      handler: makeHandler('list_directory', ListDirectoryParamsSchema),
    },
  ],
};
