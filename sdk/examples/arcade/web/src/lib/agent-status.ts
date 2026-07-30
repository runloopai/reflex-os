/**
 * The Reflex agent's own state, condensed for a tile chip. "Idle" covers
 * every between-turns state (needs_input / completed / interrupted): the
 * agent is alive and waiting for the next suggestion.
 */
export function agentChip(
  status: string | null,
): { label: string; className: string; pulse: boolean } | null {
  if (!status) return null;
  if (status === 'running') return { label: 'working', className: 'text-violet-300', pulse: true };
  if (status === 'needs_input' || status === 'completed' || status === 'interrupted')
    return { label: 'idle', className: 'text-emerald-300', pulse: false };
  // Stream-derived: the devbox suspended between turns (see the server's
  // deriveAgentStatus). The next suggestion or message wakes it.
  if (status === 'suspended') return { label: 'asleep', className: 'text-sky-300', pulse: false };
  if (status === 'starting' || status === 'stopping')
    return { label: status, className: 'text-amber-300', pulse: true };
  if (status === 'stopped' || status === 'terminated')
    return { label: 'offline', className: 'text-zinc-400', pulse: false };
  if (status === 'error') return { label: 'error', className: 'text-rose-300', pulse: false };
  return { label: status.replace(/_/g, ' '), className: 'text-zinc-300', pulse: false };
}
