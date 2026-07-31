import type { AgentHeaderBadgeProps } from '@reflex/plugin-api';
import { getAgentWorkstation } from './agent-workstation.js';
import { WorkstationChip } from './WorkstationChip.js';

/**
 * Header badge for agents launched with a Connect attachment: the
 * workstation's name plus a live presence dot. Amber means the machine
 * dropped offline while the agent may still want it. Hovering opens a
 * detail popover (access mode, host, tool root, presence) rendered in the
 * shared resource-preview shell. Renders nothing for agents without the
 * attachment; viewers who can't see the workstation (non-owners) get the
 * attachment-level details without presence.
 */
export function WorkstationAgentBadge({ agent }: AgentHeaderBadgeProps) {
  const config = getAgentWorkstation(agent);
  if (!config) return null;
  return <WorkstationChip config={config} data-testid="workstation-agent-badge" />;
}
