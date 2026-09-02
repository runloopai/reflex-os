/**
 * The card every room panel wears at the top of the sidebar, and the agent
 * status chip that sits in it.
 *
 * The panels are three tabs in one column, so they only read as one surface
 * if their headers are the same object: same radius, same glass, same
 * padding. Presentational on purpose — the panel owns the state, this owns
 * the shape.
 */
import { Bot } from 'lucide-react';
import type { ReactNode } from 'react';
import { agentChip } from '../lib/agent-status.ts';

export function PanelHeader({
  title,
  icon,
  right,
  children,
}: {
  /** Left-hand label; omit for a card that is only its children. */
  title?: string;
  icon?: ReactNode;
  /** Trailing slot on the title row — a count, a status chip. */
  right?: ReactNode;
  /** Rows under the title: an explainer, a banner. */
  children?: ReactNode;
}) {
  return (
    <header className="mx-1 mt-1 rounded-2xl bg-zinc-900/70 px-3.5 py-2.5 shadow-xl shadow-black/50 backdrop-blur-xl">
      {title || right ? (
        <div className="flex items-center gap-2">
          {/* Below `lg` the panel is a sheet that already carries the tab's
              name in its own title bar, so only the trailing slot survives —
              two headings stacked is the sheet saying "Suggestions" twice. */}
          {title ? (
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-100 max-lg:hidden">
              {icon ? <span className="shrink-0 text-violet-300">{icon}</span> : null}
              <span className="min-w-0 truncate">{title}</span>
            </h2>
          ) : null}
          {right ? <span className="ml-auto shrink-0">{right}</span> : null}
        </div>
      ) : null}
      {children}
    </header>
  );
}

/**
 * The agent's own state as a chip: colour and pulse come from `agentChip`,
 * so a tile, a banner and this all say the same word for the same state.
 */
export function AgentStatusChip({ status }: { status: string | null }) {
  const agent = agentChip(status);
  if (!agent) return null;
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium ${agent.className}`}
    >
      <Bot size={12} aria-hidden className={agent.pulse ? 'animate-pulse' : ''} />
      Agent {agent.label}
    </span>
  );
}
