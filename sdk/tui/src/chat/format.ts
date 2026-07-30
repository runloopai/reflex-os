/**
 * Display formatting for transcript items: single-line tool headlines in the
 * `Name(primary argument)` style Claude Code uses, plus small shared helpers.
 */

const MAX_HEADLINE_ARG = 80;

export function clip(text: string, max = MAX_HEADLINE_ARG): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The one argument worth showing inline for a tool call — command for shells,
 * path for file tools, pattern for searches — mirroring the web chat's input
 * summaries.
 */
export function toolPrimaryArg(input: Record<string, unknown> | null): string | null {
  if (!input) return null;
  for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return clip(value);
  }
  return null;
}

export function toolHeadline(name: string, input: Record<string, unknown> | null): string {
  const arg = toolPrimaryArg(input);
  return arg ? `${name}(${arg})` : name;
}

/**
 * Compact summary of a tool's output: its first line plus a `+N lines` tail
 * marker, in the spirit of Claude Code's `⎿` result rows.
 */
export function outputSummary(
  output: string,
  maxLines = 4,
): { lines: string[]; hiddenCount: number } {
  const all = output.replace(/\r\n/g, '\n').split('\n');
  while (all.length > 0 && !all[all.length - 1].trim()) all.pop();
  const lines = all.slice(0, maxLines).map((line) => clip(line, 120));
  return { lines, hiddenCount: Math.max(0, all.length - lines.length) };
}

/** `+12 lines` / `-3 +5` style change summary for Write/Edit tool inputs. */
export function editSummary(name: string, input: Record<string, unknown> | null): string | null {
  if (!input) return null;
  const countLines = (text: unknown): number | null =>
    typeof text === 'string' ? text.split('\n').length : null;
  if (name === 'Write') {
    const added = countLines(input.content) ?? countLines(input.contents);
    return added !== null ? `+${added} lines` : null;
  }
  if (name === 'Edit' || name === 'StrReplace') {
    const removed = countLines(input.old_string);
    const added = countLines(input.new_string);
    if (removed !== null && added !== null) return `-${removed} +${added} lines`;
  }
  return null;
}

export function formatDurationSecs(secs: number): string {
  if (secs < 60) return `${secs % 1 === 0 ? secs.toFixed(0) : secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const rest = Math.round(secs % 60);
  return `${mins}m ${rest}s`;
}

export function formatElapsedMs(ms: number): string {
  return formatDurationSecs(Math.round(ms / 1000));
}
