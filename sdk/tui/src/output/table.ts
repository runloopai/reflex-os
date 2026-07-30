/**
 * Plain-text output helpers shared by every scriptable command: aligned
 * tables for lists, key-value blocks for single resources, relative
 * timestamps, and status coloring. Color is used only on a TTY and never
 * when NO_COLOR is set, so piped output stays clean.
 */

const ANSI: Record<string, string> = {
  green: '[32m',
  yellow: '[33m',
  red: '[31m',
  cyan: '[36m',
  dim: '[2m',
  reset: '[0m',
};

export function useColor(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

export function color(text: string, name: keyof typeof ANSI): string {
  if (!useColor()) return text;
  return `${ANSI[name]}${text}${ANSI.reset}`;
}

const STATUS_COLORS: Record<string, keyof typeof ANSI> = {
  running: 'green',
  needs_input: 'yellow',
  starting: 'cyan',
  error: 'red',
  failed: 'red',
  stopped: 'dim',
  complete: 'dim',
  completed: 'dim',
};

export function colorStatus(status: string): string {
  const c = STATUS_COLORS[status];
  return c ? color(status, c) : status;
}

export interface Column {
  key: string;
  header: string;
}

/** Render rows as an aligned table. Values are already-formatted strings. */
export function renderTable(columns: Column[], rows: Record<string, string>[]): string {
  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((row) => visibleLength(row[col.key] ?? ''))),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell + ' '.repeat(Math.max(0, widths[i] - visibleLength(cell))))
      .join('  ')
      .trimEnd();
  const header = line(columns.map((c) => c.header.toUpperCase()));
  const body = rows.map((row) => line(columns.map((c) => row[c.key] ?? '')));
  return [color(header, 'dim'), ...body].join('\n');
}

/** Length without ANSI escapes, so colored cells align correctly. */
function visibleLength(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, '').length;
}

/** Render a single resource as aligned `key: value` lines, skipping blanks. */
export function renderKv(pairs: [string, string | null | undefined][]): string {
  const kept = pairs.filter(([, v]) => v !== null && v !== undefined && v !== '') as [
    string,
    string,
  ][];
  const width = Math.max(...kept.map(([k]) => k.length));
  return kept.map(([k, v]) => `${color(`${k}:`.padEnd(width + 1), 'dim')} ${v}`).join('\n');
}

/** "3m ago" / "2h ago" / "5d ago" from an epoch-ms timestamp. */
export function formatRelativeTime(epochMs: number, now = Date.now()): string {
  const seconds = Math.round((now - epochMs) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
