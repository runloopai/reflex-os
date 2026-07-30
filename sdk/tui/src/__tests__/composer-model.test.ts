import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '../chat/transcript.js';
import {
  EMPTY_HISTORY,
  historyEntries,
  moveVertical,
  nextCodePoint,
  prevCodePoint,
  resolveEnter,
  stepHistory,
} from '../ui/composer-model.js';

describe('resolveEnter', () => {
  it('submits a plain draft', () => {
    expect(resolveEnter('ship it', 7)).toEqual({ kind: 'submit' });
    expect(resolveEnter('', 0)).toEqual({ kind: 'submit' });
  });

  it('consumes a backslash before the cursor into a newline', () => {
    expect(resolveEnter('line one\\', 9)).toEqual({
      kind: 'newline',
      value: 'line one\n',
      cursor: 9,
    });
  });

  it('continues mid-string, keeping the tail after the cursor', () => {
    expect(resolveEnter('head\\tail', 5)).toEqual({
      kind: 'newline',
      value: 'head\ntail',
      cursor: 5,
    });
  });

  it('only looks at the character immediately before the cursor', () => {
    expect(resolveEnter('has \\ inside', 12)).toEqual({ kind: 'submit' });
  });
});

describe('moveVertical', () => {
  //           0123 456789 (offsets; newlines at 4 and 10)
  const text = 'abcd\nefghi\nz';

  it('moves between lines keeping the column', () => {
    expect(moveVertical(text, 7, 'up')).toBe(2); // col 2 of "efghi" → col 2 of "abcd"
    expect(moveVertical(text, 2, 'down')).toBe(7);
  });

  it('clamps the column to the target line length', () => {
    expect(moveVertical(text, 9, 'up')).toBe(4); // col 4 → end of the 4-char "abcd"
    expect(moveVertical(text, 9, 'down')).toBe(12); // col 4 → end of the 1-char "z"
  });

  it('returns null at the boundary lines', () => {
    expect(moveVertical(text, 2, 'up')).toBeNull();
    expect(moveVertical(text, 12, 'down')).toBeNull();
    expect(moveVertical('single', 3, 'up')).toBeNull();
    expect(moveVertical('single', 3, 'down')).toBeNull();
  });

  it('treats a cursor at a line end as that line', () => {
    expect(moveVertical(text, 4, 'down')).toBe(9); // end of "abcd" → col 4 of "efghi"
  });

  it('never lands mid-surrogate-pair when clamping columns', () => {
    // "xy" over "a👍" — moving down from col 2 would land inside the pair.
    expect(moveVertical('xy\na👍', 2, 'down')).toBe(4);
  });
});

describe('code point stepping', () => {
  const value = 'a👍b'; // 👍 is a surrogate pair at offsets 1–2

  it('steps over surrogate pairs in both directions', () => {
    expect(nextCodePoint(value, 0)).toBe(1);
    expect(nextCodePoint(value, 1)).toBe(3);
    expect(prevCodePoint(value, 3)).toBe(1);
    expect(prevCodePoint(value, 1)).toBe(0);
  });

  it('clamps at the string ends', () => {
    expect(prevCodePoint(value, 0)).toBe(0);
    expect(nextCodePoint(value, value.length)).toBe(value.length);
  });

  it('steps single units through plain text', () => {
    expect(nextCodePoint('abc', 1)).toBe(2);
    expect(prevCodePoint('abc', 2)).toBe(1);
  });
});

function userItem(text: string): TranscriptItem {
  return { kind: 'user', id: `u-${text}`, final: true, text, attachments: [] } as TranscriptItem;
}
function textItem(text: string): TranscriptItem {
  return { kind: 'text', id: `t-${text}`, final: true, text } as TranscriptItem;
}

describe('historyEntries', () => {
  it('collects user messages newest first, skipping other items', () => {
    const items = [userItem('first'), textItem('reply'), userItem('second'), userItem('third')];
    expect(historyEntries(items)).toEqual(['third', 'second', 'first']);
  });

  it('drops blanks and consecutive duplicates', () => {
    const items = [userItem('a'), userItem('  '), userItem('a'), userItem('b')];
    expect(historyEntries(items)).toEqual(['b', 'a']);
  });
});

describe('stepHistory', () => {
  const entries = ['newest', 'middle', 'oldest'];

  it('stashes the draft and recalls the newest on the first step older', () => {
    expect(stepHistory(entries, EMPTY_HISTORY, 'older', 'typing…')).toEqual({
      history: { index: 0, stash: 'typing…' },
      draft: 'newest',
    });
  });

  it('walks older and stops at the oldest entry', () => {
    const at1 = stepHistory(entries, { index: 0, stash: '' }, 'older', 'newest');
    expect(at1?.draft).toBe('middle');
    const at2 = stepHistory(entries, at1!.history, 'older', 'middle');
    expect(at2?.draft).toBe('oldest');
    expect(stepHistory(entries, at2!.history, 'older', 'oldest')).toBeNull();
  });

  it('walks newer and restores the stashed draft past the newest', () => {
    const back = stepHistory(entries, { index: 1, stash: 'typing…' }, 'newer', 'middle');
    expect(back?.draft).toBe('newest');
    const out = stepHistory(entries, back!.history, 'newer', 'newest');
    expect(out).toEqual({ history: EMPTY_HISTORY, draft: 'typing…' });
  });

  it('is a no-op when not navigating or with no history', () => {
    expect(stepHistory([], EMPTY_HISTORY, 'older', 'x')).toBeNull();
    expect(stepHistory(entries, EMPTY_HISTORY, 'newer', 'x')).toBeNull();
  });
});
