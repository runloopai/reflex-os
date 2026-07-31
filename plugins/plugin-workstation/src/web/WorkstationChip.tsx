import { Clock, FolderOpen, HardDrive, Monitor, TerminalSquare } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@reflex/ui/components/ui/hover-card';
import { Badge } from '@reflex/ui/components/ui/badge';
import { ResourcePreviewCard } from '@reflex/ui/components/resource-preview/ResourcePreviewCard';
import { formatRelativeTime } from '@reflex/ui/lib/format';
import { cn } from '@reflex/ui/lib/utils';
import {
  WORKSTATION_DEFAULT_ACCESS_MODE,
  type Workstation,
  type WorkstationAttachmentConfig,
} from '@runloop/reflex-workstation';
import { useWorkstations } from './useWorkstations.js';

/**
 * Compact identity chip for a workstation attachment: monitor icon, name,
 * and a live presence dot, with the full detail popover on hover. The agent
 * header badge and the per-tool-call source row both render through this so
 * "which machine is this?" always answers the same way.
 */
export function WorkstationChip({
  config,
  className,
  'data-testid': testId = 'workstation-chip',
}: {
  config: WorkstationAttachmentConfig;
  className?: string;
  'data-testid'?: string;
}) {
  const { data: workstations = [] } = useWorkstations();
  const live = workstations.find((w) => w.id === config.workstationId);
  const name = live?.name ?? config.workstationName ?? config.workstationId;
  const online = live?.status === 'online';

  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span
          data-testid={testId}
          className={cn(
            'inline-flex cursor-default items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground',
            className,
          )}
        >
          <Monitor className="h-3 w-3" />
          <span className="max-w-32 truncate">{name}</span>
          {live ? (
            <span
              aria-hidden
              data-testid={`${testId}-dot-${live.status}`}
              className={cn('h-1.5 w-1.5 rounded-full', online ? 'bg-emerald-500' : 'bg-amber-500')}
            />
          ) : null}
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 p-3" aria-label={`Workstation ${name}`}>
        <WorkstationPreview config={config} live={live} name={name} />
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Popover body for a workstation attachment, in the shared resource-preview
 * shell: access mode + presence chips, host/tool-root/last-seen rows, and a
 * reconnect hint when the machine is offline. Non-owners (no `live` row) get
 * the attachment-level details without presence.
 */
export function WorkstationPreview({
  config,
  live,
  name,
}: {
  config: WorkstationAttachmentConfig;
  live: Workstation | undefined;
  name: string;
}) {
  const mode = config.mode ?? WORKSTATION_DEFAULT_ACCESS_MODE;
  const readOnly = mode === 'read';
  const online = live?.status === 'online';

  const meta = (
    <>
      <Badge
        variant={readOnly ? 'subtle' : 'outline'}
        className="gap-1 px-1.5 py-0 text-[10px]"
        data-testid="workstation-preview-mode"
      >
        <TerminalSquare className="h-2.5 w-2.5" aria-hidden="true" />
        {readOnly ? 'Read-only' : 'Read & write'}
      </Badge>
      {live ? (
        <Badge
          variant={online ? 'outline' : 'subtle'}
          className="gap-1 px-1.5 py-0 text-[10px]"
          data-testid="workstation-preview-status"
        >
          <span
            aria-hidden
            className={cn('h-1.5 w-1.5 rounded-full', online ? 'bg-emerald-500' : 'bg-amber-500')}
          />
          {online ? 'Online' : 'Offline'}
        </Badge>
      ) : null}
    </>
  );

  const description = live ? (
    <>
      <p className="flex items-start gap-1.5">
        <HardDrive className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate font-mono">
          {live.hostname} · {live.platform}
        </span>
      </p>
      {live.toolRoot ? (
        <p className="flex items-start gap-1.5">
          <FolderOpen className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono" title={live.toolRoot}>
            {live.toolRoot}
          </span>
        </p>
      ) : null}
      <p className="flex items-start gap-1.5">
        <Clock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>
          {online
            ? live.connectedAt
              ? `Connected ${formatRelativeTime(live.connectedAt)}`
              : 'Connected'
            : `Last seen ${formatRelativeTime(live.lastSeenAt)}`}
        </span>
      </p>
      {!online ? (
        <p className="text-foreground/80">
          Run <code className="font-mono">reflex-cli connect</code> on {live.hostname} to reconnect.
        </p>
      ) : null}
    </>
  ) : (
    <p>Presence and machine details are only visible to the workstation's owner.</p>
  );

  return (
    <ResourcePreviewCard
      kindLabel="Workstation"
      icon={Monitor}
      name={name}
      subtitle={live ? live.status : undefined}
      meta={meta}
      description={description}
      id={config.workstationId}
      detailHref="/workstations"
      openLinkLabel="Open Workstations"
    />
  );
}
