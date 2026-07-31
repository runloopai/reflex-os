import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPluginMeta } from '@reflex/plugin-api/meta';
import {
  definePlugin,
  requireServices,
  type PluginContext,
  type PluginRegisterResult,
} from '@reflex/plugin-api';
import { dbTablesStartup } from '@reflex/plugin-api/services';
import { workstationIds } from '@runloop/reflex-workstation';
import * as schema from './server/schema.js';
import { WorkstationRegistryService } from './server/workstation-registry.service.js';
import { registerWorkstationRoutes } from './server/workstation.routes.js';
import {
  createWorkstationAttachmentResolver,
  createWorkstationSetupHook,
} from './server/workstation-attachment.js';
import {
  WORKSTATION_TOOL_PREFIX,
  createWorkstationToolCallHandler,
} from './server/workstation-tool-relay.js';
import { workstationMcp } from './server/workstation-mcp.js';
import { workstationWeb } from './web-manifest.js';

const meta = createPluginMeta(import.meta.url);

/**
 * Workstations: connect a launched agent to the user's own machine.
 *
 * The `reflex-cli connect` command opens a WebSocket to this plugin's
 * `/api/workstations/connect` endpoint and registers the machine. The
 * launch dialog then offers a "Connect" attachment listing the user's
 * online workstations; agents launched with one attached get `workstation_*`
 * MCP tools via an on-box stdio shim whose calls ride the flex-bridge control
 * socket back to Reflex, which relays them over this plugin's WebSocket to the
 * machine. The per-agent socket lets the server enforce owner/org/access-mode.
 */
export const workstationPlugin = definePlugin({
  name: 'workstation',
  version: meta.version,
  description:
    'Connect agents to your own machine. Run the Reflex TUI in connect mode and attach the workstation at launch to give the agent shell and file tools on it.',
  tags: ['integration', 'tools'],
  // Per-org opt-in. Connecting an agent to a user's own machine is a
  // security-sensitive capability, so it ships behind the preview channel and
  // is not installed by default: orgs that have not enabled the preview channel
  // and installed the plugin never see any workstation UI (the Workstations
  // page, the Connect launch attachment, the mention provider, or the
  // `workstation_*` tool-call renderers) because the host strips this plugin's
  // entire web manifest per-request for orgs without it installed.
  orgInstall: { installable: true, defaultInstalled: false, releaseStatus: 'preview' },
  dependencies: ['mcp'],
  idPrefixes: workstationIds.prefixes,
  server: {
    routePrefix: '/workstations',
    healthChecks: {
      startup: dbTablesStartup(['workstations']),
    },
    schema: { ...schema },
    migrationsFolder: path.resolve(dirname(fileURLToPath(import.meta.url)), 'server/migrations'),
    mcp: workstationMcp,
    provides(ctx) {
      return { workstationRegistry: new WorkstationRegistryService(ctx) };
    },
    register(app, ctx: PluginContext): PluginRegisterResult {
      const { workstationRegistry: rawWorkstationRegistry } = requireServices(
        ctx,
        'workstationRegistry',
      );
      const workstationRegistry = rawWorkstationRegistry as WorkstationRegistryService;
      workstationRegistry.attachBroadcast(ctx.services?.broadcastService);
      void workstationRegistry.resetPresence().catch((err: unknown) => {
        ctx.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'failed to reset workstation presence at boot',
        );
      });
      void workstationRegistry.pruneAuditLog().catch((err: unknown) => {
        ctx.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'failed to prune workstation audit log at boot',
        );
      });
      workstationRegistry.startHeartbeat();
      registerWorkstationRoutes(app, workstationRegistry, ctx.log);

      // Relay `workstation_*` tool calls that arrive over each agent's
      // flex-bridge control socket (the on-box MCP shim's transport). This is
      // the delivery path that works in dev (loopback APP_URL) and carries
      // agent identity for strict read-only enforcement.
      const bridge = ctx.services?.sandboxBridgeService;
      if (bridge) {
        bridge.registerToolCallHandler(
          WORKSTATION_TOOL_PREFIX,
          createWorkstationToolCallHandler(workstationRegistry),
        );
      } else {
        ctx.log.warn(
          'sandbox bridge service unavailable; workstation tools will not be reachable via the bridge relay',
        );
      }

      return {
        attachmentResolvers: [createWorkstationAttachmentResolver()],
        devboxSetupHooks: [createWorkstationSetupHook()],
      };
    },
  },
  web: workstationWeb,
});
