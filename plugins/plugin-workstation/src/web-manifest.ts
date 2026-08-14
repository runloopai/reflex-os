import { definePage } from '@reflex/plugin-api/web';
import type { PluginWebManifest } from '@reflex/plugin-api/web';
import { WORKSTATION_ATTACHMENT_ID } from '@runloop/reflex-workstation';

/**
 * The Workstations page under Misc: your machines running the Reflex TUI,
 * with live presence and the connect flow for adding one.
 */
const workstationsPage = definePage({
  path: '/workstations',
  label: 'Workstations',
  icon: 'MonitorSmartphone',
  group: 'misc',
  componentPath: '@reflex/plugin-workstation/web/WorkstationsPage',
  description: 'Your machines running the Reflex TUI, ready for agents to work on.',
  details:
    'Lists every machine you have registered with `reflex-cli connect`, with live online/offline presence, hostname, platform, and the directory tool access is confined to. Agents launched with the Connect attachment get run/read/write/list tools that execute on the chosen machine, with optional per-call approval (`--ask`).',
  features: [
    'Live presence for each machine over the shared socket',
    'Hostname, platform, and confined tool root per machine',
    'Step-by-step connect flow when you have no workstations yet',
  ],
});

/**
 * The plugin's main web surface is the "Connect" launch attachment: pick
 * one of your machines running `reflex-cli connect` and the launched agent
 * gets tools on it. Rendered by the host's generic attachment editor in the
 * launch dialog — no host changes needed. The Workstations page under Misc
 * lists those machines and teaches the connect flow.
 */
export const workstationWeb: PluginWebManifest = {
  ...workstationsPage.web,
  attachments: [
    {
      id: WORKSTATION_ATTACHMENT_ID,
      label: 'Connect',
      icon: 'MonitorSmartphone',
      order: 30,
      pickerComponentPath: '@reflex/plugin-workstation/web/WorkstationAttachmentPicker',
      summaryComponentPath: '@reflex/plugin-workstation/web/WorkstationAttachmentSummary',
    },
  ],
  launchMentionProviders: [
    {
      id: 'launch-mention-workstation',
      label: 'Workstations',
      keyword: 'workstation',
      icon: 'MonitorSmartphone',
      componentPath: '@reflex/plugin-workstation/web/WorkstationMentionProvider',
      order: 40,
    },
  ],
  // Rich chat displays for the workstation MCP tools: terminal-style command
  // output, file/list views, and human explanations for offline/denied/
  // read-only failures. One lazy component serves all four tools.
  toolCallRenderers: [
    {
      toolName: 'workstation_run_command',
      label: 'Ran on workstation',
      labelInProgress: 'Running on workstation',
      labelFailed: "Couldn't run on workstation",
      icon: 'MonitorSmartphone',
      componentPath: '@reflex/plugin-workstation/web/WorkstationToolCallView',
    },
    {
      toolName: 'workstation_read_file',
      label: 'Read from workstation',
      labelInProgress: 'Reading from workstation',
      labelFailed: "Couldn't read from workstation",
      icon: 'MonitorSmartphone',
      componentPath: '@reflex/plugin-workstation/web/WorkstationToolCallView',
    },
    {
      toolName: 'workstation_write_file',
      label: 'Wrote on workstation',
      labelInProgress: 'Writing on workstation',
      labelFailed: "Couldn't write on workstation",
      icon: 'MonitorSmartphone',
      componentPath: '@reflex/plugin-workstation/web/WorkstationToolCallView',
    },
    {
      toolName: 'workstation_list_directory',
      label: 'Listed on workstation',
      labelInProgress: 'Listing on workstation',
      labelFailed: "Couldn't list on workstation",
      icon: 'MonitorSmartphone',
      componentPath: '@reflex/plugin-workstation/web/WorkstationToolCallView',
    },
  ],
  agentHeaderBadges: [
    {
      id: 'workstation-badge',
      componentPath: '@reflex/plugin-workstation/web/WorkstationAgentBadge',
      order: 30,
    },
  ],
  agentDetailSections: [
    {
      id: 'workstation',
      label: 'Workstation',
      icon: 'MonitorSmartphone',
      componentPath: '@reflex/plugin-workstation/web/WorkstationAgentSection',
      order: 40,
    },
  ],
};
