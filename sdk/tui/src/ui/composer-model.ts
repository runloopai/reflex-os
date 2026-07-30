import type { TranscriptItem } from '../chat/transcript.js';

/**
 * What enter does in the composer: continue onto a new line when the
 * character before the cursor is a backslash (Claude-Code-style `\` +
 * enter, the backslash is consumed), otherwise submit.
 */
export type EnterAction = { kind: 'submit' } | { kind: 'newline'; value: string; cursor: number };

export function resolveEnter(value: string, cursor: number): EnterAction {
  if (cursor > 0 && value[cursor - 1] === '\\') {
    return {
      kind: 'newline',
      value: `${value.slice(0, cursor - 1)}\n${value.slice(cursor)}`,
      cursor,
    };
  }
  return { kind: 'submit' };
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Offset one code point before `offset`, so editing never splits a
 * surrogate pair (emoji and other astral characters are two UTF-16 units).
 */
export function prevCodePoint(value: string, offset: number): number {
  if (offset <= 1) return 0;
  const pair =
    isLowSurrogate(value.charCodeAt(offset - 1)) && isHighSurrogate(value.charCodeAt(offset - 2));
  return pair ? offset - 2 : offset - 1;
}

/** Offset one code point after `offset`; see {@link prevCodePoint}. */
export function nextCodePoint(value: string, offset: number): number {
  if (offset >= value.length) return value.length;
  const pair =
    isHighSurrogate(value.charCodeAt(offset)) && isLowSurrogate(value.charCodeAt(offset + 1));
  return Math.min(value.length, offset + (pair ? 2 : 1));
}

/** Nudge an offset off the middle of a surrogate pair (to its start). */
function snapToCodePoint(value: string, offset: number): number {
  if (
    offset > 0 &&
    offset < value.length &&
    isLowSurrogate(value.charCodeAt(offset)) &&
    isHighSurrogate(value.charCodeAt(offset - 1))
  ) {
    return offset - 1;
  }
  return offset;
}

/**
 * Cursor offset after moving one line up or down in a multi-line draft,
 * keeping the column where possible (clamped to the target line's length).
 * Returns null at the boundary line — the caller decides what a boundary
 * arrow press means (in the chat composer: history recall).
 */
export function moveVertical(
  value: string,
  cursor: number,
  direction: 'up' | 'down',
): number | null {
  const lines = value.split('\n');
  let start = 0;
  let line = 0;
  while (line < lines.length && cursor > start + lines[line].length) {
    start += lines[line].length + 1;
    line += 1;
  }
  const column = cursor - start;
  if (direction === 'up') {
    if (line === 0) return null;
    const prevStart = start - lines[line - 1].length - 1;
    return snapToCodePoint(value, prevStart + Math.min(column, lines[line - 1].length));
  }
  if (line >= lines.length - 1) return null;
  const nextStart = start + lines[line].length + 1;
  return snapToCodePoint(value, nextStart + Math.min(column, lines[line + 1].length));
}

/**
 * Shell-style recall state for the composer: `index` is the position in the
 * newest-first history while navigating (null when not), `stash` holds the
 * draft that was being typed when navigation started so stepping back past
 * the newest entry restores it.
 */
export interface ComposerHistory {
  index: number | null;
  stash: string;
}

export const EMPTY_HISTORY: ComposerHistory = { index: null, stash: '' };

/**
 * The user's previously sent messages, newest first, for up/down recall.
 * Sourced from the transcript so recall works across reconnects and for
 * messages sent from the web. Blank texts and consecutive duplicates are
 * dropped.
 */
export function historyEntries(items: readonly TranscriptItem[]): string[] {
  const entries: string[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== 'user' || !item.text.trim()) continue;
    if (entries[entries.length - 1] === item.text) continue;
    entries.push(item.text);
  }
  return entries;
}

/**
 * One up/down step through history. Returns null when the step is a no-op
 * (no history, already at the oldest, or stepping newer while not
 * navigating).
 */
export function stepHistory(
  entries: readonly string[],
  history: ComposerHistory,
  direction: 'older' | 'newer',
  draft: string,
): { history: ComposerHistory; draft: string } | null {
  if (direction === 'older') {
    if (history.index === null) {
      if (entries.length === 0) return null;
      return { history: { index: 0, stash: draft }, draft: entries[0] };
    }
    if (history.index >= entries.length - 1) return null;
    const index = history.index + 1;
    return { history: { ...history, index }, draft: entries[index] };
  }
  if (history.index === null) return null;
  if (history.index === 0) {
    return { history: EMPTY_HISTORY, draft: history.stash };
  }
  const index = history.index - 1;
  return { history: { ...history, index }, draft: entries[index] };
}
