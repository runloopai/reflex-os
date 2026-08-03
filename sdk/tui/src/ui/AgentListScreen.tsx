import { Box, Text, useInput } from 'ink';
import { useEffect, useReducer, useState } from 'react';
import type { Agent } from '@runloop/reflex-client';
import { filterAgents, listLayout, orderAgents } from './agent-list-model.js';
import { relativeTime, statusColor } from './theme.js';
import { UpdateNotice } from './UpdateNotice.js';
import type { UpdateState } from './useUpdateCheck.js';
import { useTerminalSize } from './useTerminalSize.js';

interface AgentListScreenProps {
  agents: Agent[];
  loading: boolean;
  error: string | null;
  /** Set once npm reports a newer CLI than the one running; null otherwise. */
  update: UpdateState | null;
  onOpen: (agent: Agent) => void;
  onLaunch: () => void;
  onTogglePin: (agent: Agent) => void;
  onToggleArchive: (agent: Agent) => void;
  onRefresh: () => void;
  onUpdate: () => void;
  onQuit: () => void;
}

export function AgentListScreen({
  agents,
  loading,
  error,
  update,
  onOpen,
  onLaunch,
  onTogglePin,
  onToggleArchive,
  onRefresh,
  onUpdate,
  onQuit,
}: AgentListScreenProps) {
  const [cursor, setCursor] = useState(0);
  /** Filter query while `/` mode is active; null when not filtering. */
  const [filter, setFilter] = useState<string | null>(null);
  /** `a` flips between the active view and the archived view. */
  const [showArchived, setShowArchived] = useState(false);

  // Keep "3m ago" honest while the list sits open.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  const { columns, rows } = useTerminalSize();
  const layout = listLayout(columns, rows);

  const pool = agents.filter((agent) => agent.archived === showArchived);
  const shown = orderAgents(filterAgents(pool, filter ?? ''));
  const clamped = Math.min(cursor, Math.max(0, shown.length - 1));

  useInput((input, key) => {
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(shown.length - 1, c + 1));
    if (key.return && shown[clamped]) onOpen(shown[clamped]);

    // Filter mode: printable keys build the query, so letter shortcuts only
    // apply outside it.
    if (filter !== null) {
      if (key.escape) setFilter(null);
      else if (key.backspace || key.delete) setFilter(filter.slice(0, -1));
      else if (input && !key.ctrl && !key.meta && !key.return) setFilter(filter + input);
      return;
    }
    if (input === '/') {
      setFilter('');
      setCursor(0);
      return;
    }
    if (input === 'k') setCursor((c) => Math.max(0, c - 1));
    if (input === 'j') setCursor((c) => Math.min(shown.length - 1, c + 1));
    if (input === 'p' && shown[clamped]) onTogglePin(shown[clamped]);
    if (input === 'x' && shown[clamped]) onToggleArchive(shown[clamped]);
    if (input === 'a') {
      setShowArchived((v) => !v);
      setCursor(0);
    }
    if (input === 'n') onLaunch();
    if (input === 'r') onRefresh();
    if (input === 'u' && update) onUpdate();
    if (input === 'q') onQuit();
  });

  const start = Math.max(
    0,
    Math.min(clamped - Math.floor(layout.visibleRows / 2), shown.length - layout.visibleRows),
  );
  const visible = shown.slice(start, start + layout.visibleRows);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan">
          {showArchived ? 'Archived agents' : 'Agents'}
        </Text>
        <Text dimColor> {loading ? '(loading...)' : `(${pool.length})`}</Text>
      </Box>
      {error ? <Text color="red">{error}</Text> : null}
      {filter !== null ? (
        <Box gap={1}>
          <Text color="cyan">/</Text>
          <Text>{filter}</Text>
          <Text inverse> </Text>
          <Text dimColor>
            {shown.length} match{shown.length === 1 ? '' : 'es'}
          </Text>
        </Box>
      ) : null}
      {!loading && pool.length === 0 ? (
        <Text dimColor>
          {showArchived
            ? 'No archived agents — a returns to the active list.'
            : agents.length === 0
              ? 'No agents yet — press n to launch one.'
              : 'No active agents — a shows the archived ones.'}
        </Text>
      ) : null}
      {!loading && pool.length > 0 && shown.length === 0 ? (
        <Text dimColor>No agents match — esc clears the filter.</Text>
      ) : null}
      {visible.map((agent, i) => {
        const selected = start + i === clamped;
        // The list is scanned for agents waiting on the user — those states
        // read in their status color while the rest stay dim.
        const attention = agent.status === 'needs_input' || agent.status === 'error';
        return (
          <Box key={agent.id} gap={1}>
            <Text color={selected ? 'cyan' : undefined}>{selected ? '›' : ' '}</Text>
            <Text color={statusColor(agent.status)}>●</Text>
            <Box width={layout.nameWidth}>
              <Text wrap="truncate" bold={selected}>
                {agent.pinned ? <Text color="cyan">✦ </Text> : null}
                {agent.name}
              </Text>
            </Box>
            <Box width={12}>
              <Text color={attention ? statusColor(agent.status) : undefined} dimColor={!attention}>
                {agent.status}
              </Text>
            </Box>
            {layout.showType ? (
              <Box width={14}>
                <Text dimColor>{agent.agentType}</Text>
              </Box>
            ) : null}
            <Text dimColor>{relativeTime(agent.lastActiveAt ?? agent.createdAt)}</Text>
          </Box>
        );
      })}
      {/* Hidden while filtering: `u` types into the query there, so the
          "press u to install" hint would be a lie. */}
      {update && filter === null ? (
        <Box marginTop={1}>
          <UpdateNotice update={update} />
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>
          {filter !== null
            ? 'type to filter · ↑/↓ select · enter open · esc clear'
            : `↑/↓ · enter open · / filter · p pin · x ${showArchived ? 'unarchive' : 'archive'} · a ${showArchived ? 'active' : 'archived'} · n new · r refresh${update ? ' · u update' : ''} · q quit`}
        </Text>
      </Box>
    </Box>
  );
}
