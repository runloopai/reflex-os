import { Check, Monitor, X } from 'lucide-react';
import type { AgentDetailSectionProps } from '@reflex/plugin-api';
import { timeAgo } from '@reflex/ui/lib/format';
import { cn } from '@reflex/ui/lib/utils';
import type { WorkstationToolCallRecord } from '@runloop/reflex-workstation';
import { getAgentWorkstation } from './agent-workstation.js';
import { useWorkstationCalls } from './useWorkstationCalls.js';
import { useWorkstations } from './useWorkstations.js';

const VISIBLE_CALLS = 8;

/**
 * Agent-detail section for the Connect attachment: which machine the agent
 * is bound to, whether it is reachable right now, and the most recent tool
 * calls from the owner-scoped audit trail. Updates live via the
 * `workstation:*` plugin events the hooks subscribe to.
 */
export function WorkstationAgentSection({ agent }: AgentDetailSectionProps) {
  const config = getAgentWorkstation(agent);
  const { data: workstations = [] } = useWorkstations();
  const { data: calls = [], isError } = useWorkstationCalls(config?.workstationId ?? null);

  if (!config) {
    return (
      <div className="text-xs text-muted-foreground" data-testid="workstation-section-empty">
        Not connected to a workstation.
      </div>
    );
  }

  const live = workstations.find((w) => w.id === config.workstationId);
  const name = live?.name ?? config.workstationName ?? config.workstationId;
  const online = live?.status === 'online';

  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="workstation-section">
      <div className="flex items-center gap-1.5">
        <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="truncate font-medium">{name}</span>
        {live ? (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px]',
              online ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600',
            )}
          >
            {online ? 'online' : 'offline'}
          </span>
        ) : null}
      </div>
      {live ? (
        <div className="text-muted-foreground">
          {live.hostname} · {live.platform}
          {live.toolRoot ? (
            <>
              {' · '}
              <code className="rounded bg-muted px-1 font-mono text-[10px]">{live.toolRoot}</code>
            </>
          ) : null}
        </div>
      ) : null}
      {isError ? (
        <div className="text-muted-foreground">
          Activity is visible to the workstation owner only.
        </div>
      ) : (
        <CallList calls={calls} />
      )}
    </div>
  );
}

function CallList({ calls }: { calls: WorkstationToolCallRecord[] }) {
  if (calls.length === 0) {
    return <div className="text-muted-foreground">No tool calls yet.</div>;
  }
  return (
    <div className="flex flex-col gap-1" data-testid="workstation-section-calls">
      {calls.slice(0, VISIBLE_CALLS).map((call) => (
        <div key={call.id} className="flex items-center gap-1.5">
          {call.ok ? (
            <Check className="h-3 w-3 shrink-0 text-emerald-500" />
          ) : (
            <X className="h-3 w-3 shrink-0 text-red-500" />
          )}
          <span className="text-muted-foreground">{call.tool.replace(/^workstation_/, '')}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{call.summary}</span>
          <span className="shrink-0 text-muted-foreground">
            {timeAgo(call.createdAt, { compact: true })}
          </span>
        </div>
      ))}
    </div>
  );
}
