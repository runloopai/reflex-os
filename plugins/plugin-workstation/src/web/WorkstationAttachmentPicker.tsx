import { Monitor } from 'lucide-react';
import type { PluginAttachmentPickerProps } from '@reflex/plugin-api';
import { Tooltip, TooltipContent, TooltipTrigger } from '@reflex/ui/components/ui/tooltip';
import { cn } from '@reflex/ui/lib/utils';
import {
  WORKSTATION_DEFAULT_ACCESS_MODE,
  type Workstation,
  type WorkstationAccessMode,
  type WorkstationAttachmentConfig,
} from '@runloop/reflex-workstation';
import { useWorkstations } from './useWorkstations';

const MODE_OPTIONS: { mode: WorkstationAccessMode; label: string; hint: string }[] = [
  { mode: 'read', label: 'Read-only', hint: 'Read and list files only' },
  { mode: 'read-write', label: 'Read & write', hint: 'Also write files and run commands' },
];

/**
 * Attachment picker for the `workstation` ("Connect") attachment. Lists the
 * caller's machines running the Reflex TUI; exactly one can be connected to
 * a launch. Offline machines stay visible but unselectable, so the user
 * learns the fix (start the TUI) instead of wondering where the machine
 * went. Clicking the selected pill clears the attachment.
 */
export function WorkstationAttachmentPicker({ value, onChange }: PluginAttachmentPickerProps) {
  const { data: workstations = [], isLoading } = useWorkstations();
  const config = (value as WorkstationAttachmentConfig | null) ?? null;
  const selectedMode = config?.mode ?? WORKSTATION_DEFAULT_ACCESS_MODE;

  function toggle(workstation: Workstation) {
    if (config?.workstationId === workstation.id) {
      onChange(null);
      return;
    }
    onChange({
      workstationId: workstation.id,
      workstationName: workstation.name,
      mode: config?.mode ?? WORKSTATION_DEFAULT_ACCESS_MODE,
    } satisfies WorkstationAttachmentConfig);
  }

  function setMode(mode: WorkstationAccessMode) {
    if (!config?.workstationId) return;
    onChange({ ...config, mode } satisfies WorkstationAttachmentConfig);
  }

  if (!isLoading && workstations.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground" data-testid="workstation-picker-empty">
        No workstations yet. Run{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono">reflex-cli connect</code> on your
        machine to make it connectable.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {workstations.map((workstation) => (
          <WorkstationPill
            key={workstation.id}
            workstation={workstation}
            selected={config?.workstationId === workstation.id}
            onToggle={() => toggle(workstation)}
          />
        ))}
      </div>
      {config?.workstationId ? (
        <div
          className="flex items-center gap-1"
          role="radiogroup"
          aria-label="Workstation access"
          data-testid="workstation-mode-toggle"
        >
          {MODE_OPTIONS.map(({ mode, label, hint }) => {
            const active = selectedMode === mode;
            return (
              <Tooltip key={mode}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setMode(mode)}
                    data-testid={`workstation-mode-${mode}`}
                    className={cn(
                      'rounded-md border px-2 py-0.5 text-[11px] transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{hint}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

interface WorkstationPillProps {
  workstation: Workstation;
  selected: boolean;
  onToggle: () => void;
}

function WorkstationPill({ workstation, selected, onToggle }: WorkstationPillProps) {
  const online = workstation.status === 'online';
  const pill = (
    <button
      type="button"
      onClick={onToggle}
      disabled={!online}
      aria-disabled={!online || undefined}
      data-testid={`workstation-pill-${workstation.id}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition-colors',
        selected
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:text-foreground',
        !online && 'border-dashed opacity-60 hover:text-muted-foreground',
      )}
    >
      <Monitor className="h-3 w-3" />
      <span className="truncate">{workstation.name}</span>
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          online ? 'bg-emerald-500' : 'bg-muted-foreground/40',
        )}
      />
    </button>
  );

  if (online) return pill;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="top">
        Offline — run <code>reflex-cli connect</code> on {workstation.hostname} to reconnect
      </TooltipContent>
    </Tooltip>
  );
}
