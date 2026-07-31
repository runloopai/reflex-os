import type { AttachmentSummaryProps } from '@reflex/plugin-api';
import {
  WORKSTATION_DEFAULT_ACCESS_MODE,
  type WorkstationAttachmentConfig,
} from '@runloop/reflex-workstation';

/**
 * Compact summary of a configured `workstation` attachment, rendered inside
 * the attachment chip: the machine's name (denormalized into the config at
 * pick time so the chip renders without a fetch) plus a read-only marker when
 * the launch restricted the agent to inspection.
 */
export function WorkstationAttachmentSummary({ value }: AttachmentSummaryProps) {
  const config = (value as WorkstationAttachmentConfig | null) ?? null;
  if (!config?.workstationId) return <>Added</>;
  const readOnly = (config.mode ?? WORKSTATION_DEFAULT_ACCESS_MODE) === 'read';
  return (
    <span className="truncate">
      {config.workstationName ?? config.workstationId}
      {readOnly ? ' (read-only)' : ''}
    </span>
  );
}
