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

/**
 * What a file-editing tool's result says it changed on disk: line counts when
 * the result is specific enough to give them, `'unknown'` when it isn't.
 *
 * `Write` is why the second case exists. Its input is the same whether it
 * creates a file or replaces one, so counting its content as added lines is
 * only true for a new file. When the result says the file already existed but
 * carries nothing about what it held, no honest count exists and the row says
 * nothing rather than claiming the whole file changed.
 */
export type FileChange =
  | {
      operation: 'create' | 'update';
      added: number;
      removed: number;
    }
  | 'unknown';

/**
 * `+12 lines` / `-3 +5 lines` style change summary for a file-editing tool
 * call, or null when there is nothing trustworthy to say yet.
 *
 * `Edit` and `StrReplace` carry both sides in their input, so their summary is
 * available the moment the call starts. `Write` has to wait for `fileChange`,
 * which the transcript fills in from the tool result.
 */
export function editSummary(
  name: string,
  input: Record<string, unknown> | null,
  fileChange?: FileChange | null,
): string | null {
  const countLines = (text: unknown): number | null =>
    typeof text === 'string' ? text.split('\n').length : null;
  if (name === 'Write') {
    if (!fileChange || fileChange === 'unknown') return null;
    const { operation, added, removed } = fileChange;
    if (added === 0 && removed === 0) {
      return operation === 'create' ? 'created empty file' : 'no change';
    }
    return removed === 0 ? `+${added} lines` : `-${removed} +${added} lines`;
  }
  if (!input) return null;
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
