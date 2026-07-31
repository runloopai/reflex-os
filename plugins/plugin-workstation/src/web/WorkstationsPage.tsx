import type { ReactNode } from 'react';
import { Loader2, Monitor, MonitorSmartphone } from 'lucide-react';
import { PageHeader, PageLayout } from '@reflex/ui/components/layout/PageLayout';
import { SectionLabel } from '@reflex/ui/components/layout/Typography';
import { timeAgo } from '@reflex/ui/lib/format';
import { cn } from '@reflex/ui/lib/utils';
import type { Workstation } from '@runloop/reflex-workstation';
import { useWorkstations } from './useWorkstations';

/**
 * Misc page listing the caller's workstations: every machine that has
 * registered via `reflex-cli connect`, with live presence and the details
 * the server knows (hostname, platform, tool root, last seen). Presence
 * flips arrive over the shared socket, so rows go online/offline without
 * a refresh. When there are no machines yet, the page teaches the connect
 * flow instead of showing an empty table.
 */
export function WorkstationsPage() {
  const { data: workstations = [], isLoading } = useWorkstations();

  return (
    <PageLayout maxWidth="4xl">
      <PageHeader
        icon={<MonitorSmartphone className="h-5 w-5" />}
        title="Workstations"
        description="Your machines running the Reflex TUI. Launch an agent with the Connect attachment and it gets tools that run on one of them."
      />

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading workstations...</span>
        </div>
      ) : workstations.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 py-16 text-center"
          data-testid="workstations-empty"
        >
          <MonitorSmartphone className="h-10 w-10 text-muted-foreground opacity-30" />
          <p className="text-sm text-muted-foreground">
            No workstations yet. Connecting one takes a minute:
          </p>
          <div className="w-full max-w-xl text-left">
            <ConnectSteps />
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <SectionLabel className="mb-3">Your machines</SectionLabel>
            <div
              className="divide-y divide-border/40 rounded-xl border border-border/40 bg-card/50"
              data-testid="workstations-list"
            >
              {workstations.map((workstation) => (
                <WorkstationRow key={workstation.id} workstation={workstation} />
              ))}
            </div>
          </section>

          <section className="pb-8">
            <SectionLabel className="mb-3">Connect another machine</SectionLabel>
            <ConnectSteps />
          </section>
        </div>
      )}
    </PageLayout>
  );
}

function WorkstationRow({ workstation }: { workstation: Workstation }) {
  const online = workstation.status === 'online';
  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      data-testid={`workstation-row-${workstation.id}`}
    >
      <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{workstation.name}</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px]',
              online ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground',
            )}
          >
            {online ? 'online' : 'offline'}
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {workstation.hostname} · {workstation.platform}
          {workstation.toolRoot ? (
            <>
              {' · '}
              <code className="rounded bg-muted px-1 font-mono text-[10px]">
                {workstation.toolRoot}
              </code>
            </>
          ) : null}
        </div>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {online
          ? workstation.connectedAt
            ? `connected ${timeAgo(workstation.connectedAt)}`
            : 'connected'
          : `last seen ${timeAgo(workstation.lastSeenAt)}`}
      </span>
    </div>
  );
}

/**
 * The short version of the connect flow. The full permission and security
 * story lives in the TUI's README; this is just enough to get a machine
 * on the list.
 */
function ConnectSteps() {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
      <li>
        On the machine, run <Cmd>reflex-cli</Cmd>. The first launch opens a connect link in your
        browser — approve this machine and pick an organization, and the CLI signs in automatically.
      </li>
      <li>
        Register it as a workstation with <Cmd>reflex-cli connect --dir ~/dev</Cmd>. Agents only get
        tool access inside that directory. Add <Cmd>--ask</Cmd> to approve each command and file
        write yourself, or <Cmd>--read-only</Cmd> to allow inspection only.
      </li>
      <li>
        Keep the TUI running, then launch an agent with the Connect attachment. It appears here as
        online while connected.
      </li>
    </ol>
  );
}

function Cmd({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}
