import type { Agent } from '@runloop/reflex-client';

/**
 * Filter for the agent list's `/` mode: every whitespace-separated term must
 * appear in the agent's name, status, or type (case-insensitive), so
 * "claude need" finds needs_input claude-code agents regardless of order.
 */
export function filterAgents(agents: Agent[], query: string): Agent[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return agents;
  return agents.filter((agent) => {
    const haystack = `${agent.name} ${agent.status} ${agent.agentType}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * Pinned agents first, mirroring the web sidebar's pinned section; the
 * incoming order (most recently updated first) is preserved within each
 * group.
 */
export function orderAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export interface ListLayout {
  nameWidth: number;
  showType: boolean;
  visibleRows: number;
}

/**
 * Column and row budget for the agent list at a given terminal size. A row
 * is pointer + dot + name + status + [type] + time plus gaps; the name
 * column absorbs the slack and the type column is dropped first, so rows
 * never soft-wrap in narrow panes. Rows scale with terminal height, leaving
 * room for the header, filter line, hint, and footer.
 */
export function listLayout(columns: number, rows: number): ListLayout {
  const STATUS_WIDTH = 12;
  const TYPE_WIDTH = 14;
  // pointer(1) + dot(1) + status + time(~8) + five 1-col gaps.
  const OVERHEAD = 1 + 1 + STATUS_WIDTH + 8 + 5;
  // Type earns its column only when the name still gets 30 cols beside it.
  const showType = columns - OVERHEAD - TYPE_WIDTH - 1 >= 30;
  const nameWidth = Math.max(
    16,
    Math.min(44, columns - OVERHEAD - (showType ? TYPE_WIDTH + 1 : 0)),
  );
  const visibleRows = Math.max(5, Math.min(30, rows - 8));
  return { nameWidth, showType, visibleRows };
}
