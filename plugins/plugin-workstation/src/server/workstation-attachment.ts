import type {
  AttachmentResolver,
  DevboxProvisionParams,
  DevboxSetupHook,
  PluginAgentRef,
  PluginContext,
} from '@reflex/plugin-api';
import {
  WORKSTATION_ATTACHMENT_ID,
  WORKSTATION_DEFAULT_ACCESS_MODE,
  WorkstationAttachmentConfigSchema,
  type Workstation,
  type WorkstationAccessMode,
} from '@runloop/reflex-workstation';
import { buildWorkstationShimProvisionParams } from './workstation-mcp-shim.js';
import type { WorkstationRegistryService } from './workstation-registry.service.js';

export interface ResolvedWorkstationAttachment {
  workstation: Workstation;
  /** Access level the launch requested for this machine. */
  mode: WorkstationAccessMode;
  /**
   * Whether the `workstation_*` tools will actually be reachable for this
   * run. With the flex-bridge relay + on-box MCP shim this is true whenever
   * the attachment resolves — the shim is mounted and registered regardless
   * of `APP_URL`, and the per-agent control socket carries the calls. Kept on
   * the resolved shape (and threaded into the prompt) so the "tools
   * unavailable" wording remains a first-class rendering the helper can still
   * produce if a future transport can't be wired up.
   */
  toolsAvailable: boolean;
}

/**
 * Build the markdown prompt section that tells the agent which workstation
 * it is connected to, which tools it may use, and how to reach it. The tool
 * list and guidance vary by `mode`: a read-only attachment never advertises
 * the write/command tools and tells the agent inspection is all it may do.
 * When `toolsAvailable` is false the section names the machine but makes
 * clear the tools could not be wired up this run, so the agent never tries
 * to call tools it does not have. Exposed as a helper so the hook and tests
 * produce identical text.
 */
export function buildWorkstationPromptSection(
  workstation: Workstation,
  mode: WorkstationAccessMode = WORKSTATION_DEFAULT_ACCESS_MODE,
  toolsAvailable = true,
): string {
  if (!toolsAvailable) {
    return [
      `## Connected workstation\n`,
      `Your owner attached their workstation **${workstation.name}** ` +
        `(host \`${workstation.hostname}\`, platform \`${workstation.platform}\`), but the ` +
        `\`workstation_*\` tools could not be wired up for this run, so you cannot reach that ` +
        `machine right now.`,
      ``,
      `Do not attempt to call \`workstation_*\` tools — they are not available. Tell the user the ` +
        `workstation connection is unavailable this run (their Reflex server may be unreachable ` +
        `from the tool relay) and continue with whatever you can do without it.`,
    ].join('\n');
  }
  const readOnly = mode === 'read';
  const lines = [
    `## Connected workstation\n`,
    `This agent is connected to its owner's workstation **${workstation.name}** ` +
      `(host \`${workstation.hostname}\`, platform \`${workstation.platform}\`).`,
    ``,
    readOnly
      ? `You have **read-only** access. Use the \`workstation_*\` MCP tools with ` +
        `\`workstationId: "${workstation.id}"\` to inspect that machine:`
      : `You have **read & write** access. Use the \`workstation_*\` MCP tools with ` +
        `\`workstationId: "${workstation.id}"\` to work on that machine:`,
    ``,
    `- \`workstation_read_file\` — read a file`,
    `- \`workstation_list_directory\` — list a directory`,
  ];
  if (!readOnly) {
    lines.push(
      `- \`workstation_write_file\` — write a file`,
      `- \`workstation_run_command\` — run a shell command`,
    );
  }
  if (workstation.toolRoot) {
    lines.push(
      ``,
      `Access is confined to \`${workstation.toolRoot}\` on the workstation; relative paths resolve against it.`,
    );
  }
  if (readOnly) {
    lines.push(
      ``,
      `This run is read-only: you can inspect files and directories but cannot write files or run ` +
        `commands, and those tools are not available to you. Do not ask the user to run commands on your behalf.`,
      ``,
      `Calls fail with \`workstation_offline\` when the owner's TUI is not running — tell the user instead of retrying.`,
    );
  } else {
    lines.push(
      ``,
      `The workstation is a real person's machine: prefer read-only inspection, make targeted edits, and never run destructive commands. ` +
        `Calls fail with \`workstation_offline\` when the owner's TUI is not running — tell the user instead of retrying.`,
      ``,
      `Commands and file writes may require the owner to approve each call in their TUI, so allow extra time; ` +
        `a result mentioning "denied" means the owner declined — respect it and ask the user how to proceed rather than retrying. ` +
        `For long-running commands, pass \`timeoutMs\` explicitly (up to 10 minutes).`,
    );
  }
  return lines.join('\n');
}

/**
 * {@link AttachmentResolver} for the `workstation` attachment. Validates the
 * config, re-resolves the workstation row in the agent's org, and enforces
 * that the agent's creator owns the workstation. Any failure resolves to
 * `undefined` (hooks are skipped and the launch proceeds without the
 * connection) — the same graceful stance other attachment resolvers take.
 */
export function createWorkstationAttachmentResolver(): AttachmentResolver<ResolvedWorkstationAttachment> {
  return {
    attachmentId: WORKSTATION_ATTACHMENT_ID,
    async resolve(
      ctx: PluginContext,
      attachmentConfig: unknown,
      agent: PluginAgentRef,
    ): Promise<ResolvedWorkstationAttachment | undefined> {
      const parsed = WorkstationAttachmentConfigSchema.safeParse(attachmentConfig);
      if (!parsed.success) return undefined;
      const registry = ctx.services?.workstationRegistry as WorkstationRegistryService | undefined;
      // A workstation is a user-owned resource. System/unowned agents have no
      // owner to match against, so they must never resolve this attachment.
      if (!registry || !agent.organizationId || !agent.userId) return undefined;

      const workstation = await registry.getById(parsed.data.workstationId, agent.organizationId);
      if (!workstation) {
        ctx.log.warn(
          { workstationId: parsed.data.workstationId, agentId: agent.id },
          'workstation attachment points at an unknown workstation; skipping',
        );
        return undefined;
      }
      if (workstation.userId !== agent.userId) {
        ctx.log.warn(
          { workstationId: workstation.id, agentId: agent.id },
          'workstation attachment rejected: agent creator does not own the workstation',
        );
        return undefined;
      }
      return {
        workstation,
        mode: parsed.data.mode ?? WORKSTATION_DEFAULT_ACCESS_MODE,
        // The bridge relay + on-box shim deliver the tools without a Hub/self-MCP
        // dependency, so a resolved attachment always has reachable tools.
        toolsAvailable: true,
      };
    },
  };
}

/**
 * {@link DevboxSetupHook} for the `workstation` attachment. Contributes the
 * prompt section describing the connection, and mounts + registers the on-box
 * stdio MCP shim ({@link buildWorkstationShimProvisionParams}) so the agent's
 * harness spawns it and the `workstation_*` tools are reachable. The shim
 * forwards each call to the flex-bridge IPC surface, which relays it over the
 * per-agent control socket to Reflex — no self-MCP / Runloop-Hub dependency,
 * so it works with a loopback `APP_URL` (dev), and the per-agent socket lets
 * the server strictly enforce owner/org/access-mode.
 *
 * Scoped to `claude-code`: the shim is registered via the Claude config
 * format, matching where the feature is validated today. Other harnesses need
 * their own registration before workstation tools reach them, so gating the
 * whole hook (prompt included) keeps the prompt honest — a non-Claude agent
 * never claims tools it can't call.
 */
export function createWorkstationSetupHook(): DevboxSetupHook<ResolvedWorkstationAttachment> {
  return {
    step: 'connecting_workstation',
    label: 'Connecting workstation',
    icon: 'MonitorSmartphone',
    attachmentId: WORKSTATION_ATTACHMENT_ID,
    agentType: 'claude-code',

    buildPromptSections(
      _ctx: PluginContext,
      attachment: ResolvedWorkstationAttachment | undefined,
    ): string[] {
      if (!attachment) return [];
      return [
        buildWorkstationPromptSection(
          attachment.workstation,
          attachment.mode,
          attachment.toolsAvailable,
        ),
      ];
    },

    async beforeProvision(
      _ctx: PluginContext,
      attachment: ResolvedWorkstationAttachment | undefined,
      _agent: PluginAgentRef,
    ): Promise<DevboxProvisionParams | void> {
      if (!attachment) return;
      // Mount the shim and register it as a local stdio MCP server. The target
      // workstation and access mode are re-derived server-side from the agent's
      // attachment; the mode is passed to the shim only so `tools/list` hides
      // tools the mode forbids.
      return buildWorkstationShimProvisionParams(attachment.mode);
    },
  };
}
