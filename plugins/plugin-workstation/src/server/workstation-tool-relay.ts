import type { BridgeToolCallHandler } from '@reflex/plugin-api/services';
import {
  WORKSTATION_ATTACHMENT_ID,
  WORKSTATION_DEFAULT_ACCESS_MODE,
  WORKSTATION_TOOL_PARAM_SCHEMAS,
  WorkstationAttachmentConfigSchema,
  WorkstationToolNameSchema,
  isWorkstationToolAllowed,
  type WorkstationToolName,
} from '@runloop/reflex-workstation';
import type { WorkstationRegistryService } from './workstation-registry.service.js';

/** Tool-name prefix this plugin claims on the bridge relay. */
export const WORKSTATION_TOOL_PREFIX = 'workstation';

/** Map the fully-qualified relay tool name to the registry's short name. */
function toRegistryTool(fqName: string): WorkstationToolName | undefined {
  const short = fqName.startsWith(`${WORKSTATION_TOOL_PREFIX}_`)
    ? fqName.slice(WORKSTATION_TOOL_PREFIX.length + 1)
    : fqName;
  const parsed = WorkstationToolNameSchema.safeParse(short);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Bridge {@link BridgeToolCallHandler} for `workstation_*` tools. Unlike the
 * legacy self-MCP path (which only knew the caller's org + owner), the bridge
 * socket is per-agent, so this handler receives the calling agent and enforces
 * the full policy server-side:
 *
 *   - **Attachment is the source of truth.** The target workstation id and the
 *     access mode come from the agent's own launch attachment, never from the
 *     devbox-supplied params — a compromised shim can't retarget another
 *     machine or widen its own access.
 *   - **Access mode is strict.** `write_file` / `run_command` are denied on a
 *     read-only attachment regardless of what the shim advertised in its
 *     `tools/list` (defense in depth behind the shim's own filtering).
 *   - **Owner + org** are re-checked in {@link WorkstationRegistryService.callTool}
 *     (org match always; owner match because we pass the agent's creator id).
 *
 * Throwing here becomes a `tool.result { ok: false, error }` the shim surfaces
 * to the agent.
 */
export function createWorkstationToolCallHandler(
  registry: WorkstationRegistryService,
): BridgeToolCallHandler {
  return async (toolName, params, ctx) => {
    const tool = toRegistryTool(toolName);
    if (!tool) throw new Error(`unknown_workstation_tool: "${toolName}"`);

    const { agent } = ctx;
    if (!agent.organizationId) {
      throw new Error('no_active_organization: workstation tools require an org-scoped agent');
    }
    if (!agent.userId) {
      throw new Error('no_agent_owner: workstation tools require a user-owned agent');
    }

    const entry = agent.attachments?.find((a) => a.attachmentId === WORKSTATION_ATTACHMENT_ID);
    const parsed = entry ? WorkstationAttachmentConfigSchema.safeParse(entry.config) : undefined;
    if (!parsed?.success) {
      throw new Error('workstation_not_attached: this agent has no workstation attachment');
    }
    const attachment = parsed.data;
    const mode = attachment.mode ?? WORKSTATION_DEFAULT_ACCESS_MODE;

    if (!isWorkstationToolAllowed(tool, mode)) {
      throw new Error(
        `workstation_read_only: "${toolName}" is not permitted under read-only access`,
      );
    }

    // Validate params against the tool's schema after dropping any
    // caller-supplied `workstationId` — the id is bound by the attachment.
    const raw =
      params && typeof params === 'object' ? { ...(params as Record<string, unknown>) } : {};
    delete raw.workstationId;
    const validated: unknown = WORKSTATION_TOOL_PARAM_SCHEMAS[tool].parse(raw);
    const timeoutMs =
      tool === 'run_command' ? (validated as { timeoutMs?: number }).timeoutMs : undefined;

    return registry.callTool({
      workstationId: attachment.workstationId,
      organizationId: agent.organizationId,
      userId: agent.userId,
      tool,
      params: validated,
      timeoutMs,
      agentId: agent.id,
    });
  };
}
