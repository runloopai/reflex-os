import { Monitor } from 'lucide-react';
import type { LaunchMentionProviderProps } from '@reflex/plugin-api';
import { CommandGroup, CommandItem } from '@reflex/ui/components/ui/command';
import {
  MentionRow,
  MentionDetail,
  MentionLoadingRow,
} from '@reflex/ui/components/shared/MentionRow';
import {
  WORKSTATION_ATTACHMENT_ID,
  WORKSTATION_DEFAULT_ACCESS_MODE,
  WORKSTATION_PLUGIN_NAME,
  type WorkstationAttachmentConfig,
} from '@runloop/reflex-workstation';
import { useWorkstations } from './useWorkstations';

/**
 * Launch `@`-mention provider for workstations. Lists the caller's online
 * machines running the Reflex TUI — one row each. Selecting a machine attaches
 * it with read & write access (the default); narrow it to read-only afterward
 * from the attachment's picker. Keeping one entry per machine (rather than one
 * row per access level) matches how the other providers behave and avoids a
 * duplicate entry for every workstation. Offline machines can't be used, so
 * they are omitted (the Workstations page teaches reconnecting). A launch binds
 * exactly one machine, so selecting replaces any previous choice.
 */
export function WorkstationMentionProvider({
  query,
  limit,
  attachments,
  onApply,
  groupHeading,
}: LaunchMentionProviderProps) {
  const { data: workstations = [], isFetching } = useWorkstations();
  const applied =
    (attachments[WORKSTATION_ATTACHMENT_ID]?.config as WorkstationAttachmentConfig | undefined) ??
    null;

  const q = query.toLowerCase();
  const online = workstations
    .filter((w) => w.status === 'online')
    .filter((w) => !q || w.name.toLowerCase().includes(q) || w.hostname.toLowerCase().includes(q))
    .slice(0, limit);

  if (online.length === 0) {
    if (isFetching)
      return <MentionLoadingRow label="Loading workstations…" groupHeading={groupHeading} />;
    // Nothing selectable — render nothing so the flattened root search stays
    // clean and the scoped view falls through to the menu's empty state.
    return null;
  }

  const items = online.map((workstation) => {
    const isApplied = applied?.workstationId === workstation.id;
    return (
      <CommandItem
        key={workstation.id}
        value={`workstation:${workstation.id}`}
        keywords={[workstation.name, workstation.hostname]}
        data-testid={`workstation-mention-${workstation.id}`}
        onSelect={() =>
          onApply({
            kind: 'set-attachment',
            attachmentId: WORKSTATION_ATTACHMENT_ID,
            pluginName: WORKSTATION_PLUGIN_NAME,
            config: {
              workstationId: workstation.id,
              workstationName: workstation.name,
              mode: WORKSTATION_DEFAULT_ACCESS_MODE,
            } satisfies WorkstationAttachmentConfig,
          })
        }
      >
        <MentionRow
          icon={<Monitor />}
          name={
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{workstation.name}</span>
              {isApplied ? (
                <span className="shrink-0 text-[10px] font-medium text-primary">added</span>
              ) : null}
            </span>
          }
          details={
            <MentionDetail
              name={workstation.name}
              kind="Workstation"
              description="The agent gets read & write access to this machine by default — it can read and list files, write files, and run commands. Switch it to read-only from the attachment if you only want inspection, or run the TUI with --ask to approve each call yourself."
              facts={[
                { label: 'Host', value: workstation.hostname },
                { label: 'Platform', value: workstation.platform },
              ]}
            />
          }
        />
      </CommandItem>
    );
  });

  if (groupHeading) {
    return <CommandGroup heading={groupHeading}>{items}</CommandGroup>;
  }

  return <>{items}</>;
}
