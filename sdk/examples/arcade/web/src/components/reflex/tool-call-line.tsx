/**
 * One tool invocation as a compact mono line (`⚙ Bash command: ...`,
 * turning `✓` when its result folds in), plus `ToolCallGroup`: a run of
 * consecutive calls collapsed behind an expander — the "N more" pattern
 * from the Reflex transcript.
 *
 * `message-list` composes these; import them directly to render tool
 * activity in your own layouts. Colors come from `--reflex-chat-*` CSS
 * variables. You own this file.
 */
import { useState } from 'react';
import type { AgentTimelineItem } from '../../lib/reflex/event-utils';

export type ToolTimelineItem = Extract<AgentTimelineItem, { kind: 'tool' }>;

export interface ToolCallLineProps {
  tool: ToolTimelineItem;
}

export function ToolCallLine({ tool }: ToolCallLineProps) {
  return (
    <div
      // A sidebar truncates the detail well before `buildAgentTimeline`'s own
      // 100-char clamp does, so the tooltip is worth having — but it can only
      // ever show what the timeline kept, not the whole command.
      title={tool.detail ? `${tool.name} ${tool.detail}` : tool.name}
      className="mx-1 flex items-center gap-2 rounded-lg bg-white/[0.05] px-2.5 py-1.5 font-mono text-xs text-[var(--reflex-chat-muted-fg,#6b7280)] shadow-sm shadow-black/20 backdrop-blur-sm"
    >
      {tool.done ? (
        <span aria-hidden className="shrink-0 text-emerald-400">
          ✓
        </span>
      ) : (
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--reflex-chat-accent,#4f46e5)]"
        />
      )}
      <span className="shrink-0 font-semibold text-[var(--reflex-chat-fg,#111827)]">
        {tool.name}
      </span>
      <span className="truncate">{tool.detail}</span>
    </div>
  );
}

export interface ToolCallGroupProps {
  tools: ToolTimelineItem[];
  /** How many lines stay visible while collapsed. */
  visibleCount?: number;
}

export function ToolCallGroup({ tools, visibleCount = 2 }: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const hidden = tools.length - visibleCount;
  const shown = expanded ? tools : tools.slice(0, visibleCount);

  return (
    <div className="space-y-1">
      {shown.map((tool) => (
        <ToolCallLine key={tool.id} tool={tool} />
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((old) => !old)}
          className="mx-1 flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 py-1 text-[11px] text-[var(--reflex-chat-muted-fg,#6b7280)] transition hover:bg-white/10 hover:text-[var(--reflex-chat-fg,#111827)]"
        >
          <span
            aria-hidden
            className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            ▸
          </span>
          {expanded ? 'Show less' : `${hidden} more`}
        </button>
      ) : null}
    </div>
  );
}
