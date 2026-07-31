import type { PluginAgentRef } from '@reflex/plugin-api';
import {
  WORKSTATION_ATTACHMENT_ID,
  WorkstationAttachmentConfigSchema,
  type WorkstationAttachmentConfig,
} from '@runloop/reflex-workstation';

/**
 * Read the workstation ("Connect") attachment off an agent, if any. The
 * agent ref types attachments loosely, so this parses defensively — an
 * agent without the attachment (or with a malformed one) yields `null` and
 * the workstation surfaces render nothing.
 */
export function getAgentWorkstation(agent: PluginAgentRef): WorkstationAttachmentConfig | null {
  const attachments = agent.attachments;
  if (!Array.isArray(attachments)) return null;
  for (const entry of attachments) {
    const rec = entry as { attachmentId?: unknown; config?: unknown } | null;
    if (rec?.attachmentId !== WORKSTATION_ATTACHMENT_ID) continue;
    const parsed = WorkstationAttachmentConfigSchema.safeParse(rec.config);
    if (parsed.success) return parsed.data;
  }
  return null;
}
