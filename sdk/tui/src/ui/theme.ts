/** Terminal color per agent status — mirrors the web badge palette. */
export function statusColor(status: string): string {
  switch (status) {
    case 'running':
      return 'green';
    case 'starting':
    case 'stopping':
      return 'yellow';
    case 'needs_input':
    case 'interrupted':
      return 'yellow';
    case 'completed':
      return 'blue';
    case 'error':
      return 'red';
    default:
      return 'gray';
  }
}

export function relativeTime(epochMs: number | null | undefined, now = Date.now()): string {
  if (!epochMs) return '';
  const deltaSec = Math.max(0, Math.round((now - epochMs) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)}m ago`;
  if (deltaSec < 86_400) return `${Math.round(deltaSec / 3600)}h ago`;
  return `${Math.round(deltaSec / 86_400)}d ago`;
}
