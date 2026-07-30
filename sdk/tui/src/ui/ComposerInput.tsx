import { Text } from 'ink';
import { useInput } from 'ink';
import { useEffect, useState } from 'react';
import { moveVertical, nextCodePoint, prevCodePoint, resolveEnter } from './composer-model.js';

interface ComposerInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  /**
   * Called when a multi-character chunk arrives (terminals deliver a paste as
   * one chunk). Return true to consume it (e.g. it was a file path that got
   * staged as an attachment) instead of inserting it into the value.
   */
  onPaste?: (text: string) => boolean;
  /**
   * Called when ↑/↓ is pressed on the draft's boundary line — inside a
   * multi-line draft the arrows move the cursor; only at the top/bottom do
   * they escape to the owner (the chat uses this for history recall).
   */
  onHistoryStep?: (direction: 'older' | 'newer') => void;
  placeholder?: string;
  focus?: boolean;
}

/**
 * Composer input, forked from ink-text-input v6 with the chat needs the
 * original rejects upstream:
 *
 * - ctrl/meta-modified keys are ignored instead of inserted, so shortcuts
 *   like ctrl+v (paste image) can be owned by the screen without a stray
 *   letter landing in the draft;
 * - multi-character chunks route through {@link ComposerInputProps.onPaste}
 *   first, which lets pasted/drag-dropped file paths become attachments;
 * - drafts can span lines, like Claude Code's terminal input: `\` + enter
 *   continues (the backslash is consumed), ctrl+j or option+enter inserts a
 *   newline directly, and multiline pastes keep their line breaks.
 */
export function ComposerInput({
  value: originalValue,
  onChange,
  onSubmit,
  onPaste,
  onHistoryStep,
  placeholder = '',
  focus = true,
}: ComposerInputProps) {
  const [cursorOffset, setCursorOffset] = useState((originalValue || '').length);

  useEffect(() => {
    setCursorOffset((previous) => {
      const newValue = originalValue || '';
      return previous > newValue.length - 1 ? newValue.length : previous;
    });
  }, [originalValue]);

  useInput(
    (input, key) => {
      // Newline inserts: ctrl+j arrives as a raw '\n' (legacy terminals) or
      // ctrl+'j' (kitty protocol); option+enter arrives as return+meta.
      if (input === '\n' || (key.ctrl && input === 'j') || (key.return && key.meta)) {
        const nextValue = `${originalValue.slice(0, cursorOffset)}\n${originalValue.slice(cursorOffset)}`;
        setCursorOffset(cursorOffset + 1);
        onChange(nextValue);
        return;
      }

      // Arrows move between draft lines; on the boundary line they escape
      // to the owner (history recall in the chat).
      if (key.upArrow || key.downArrow) {
        const next = moveVertical(originalValue, cursorOffset, key.upArrow ? 'up' : 'down');
        if (next !== null) setCursorOffset(next);
        else onHistoryStep?.(key.upArrow ? 'older' : 'newer');
        return;
      }

      if (key.ctrl || key.meta || key.tab || (key.shift && key.tab)) {
        return;
      }

      if (key.return) {
        const action = resolveEnter(originalValue, cursorOffset);
        if (action.kind === 'newline') {
          setCursorOffset(action.cursor);
          onChange(action.value);
          return;
        }
        onSubmit?.(originalValue);
        return;
      }

      let nextCursorOffset = cursorOffset;
      let nextValue = originalValue;

      if (key.leftArrow) {
        nextCursorOffset = prevCodePoint(originalValue, cursorOffset);
      } else if (key.rightArrow) {
        nextCursorOffset = nextCodePoint(originalValue, cursorOffset);
      } else if (key.backspace || key.delete) {
        if (cursorOffset > 0) {
          const from = prevCodePoint(originalValue, cursorOffset);
          nextValue = originalValue.slice(0, from) + originalValue.slice(cursorOffset);
          nextCursorOffset = from;
        }
      } else if (input.length > 0) {
        let insert = input;
        if (insert.length > 1) {
          if (onPaste?.(insert)) return;
          // Multiline pastes keep their line breaks; only normalize \r\n.
          insert = insert.replace(/\r\n?/g, '\n');
        }
        nextValue =
          originalValue.slice(0, cursorOffset) + insert + originalValue.slice(cursorOffset);
        nextCursorOffset += insert.length;
      }

      nextCursorOffset = Math.max(0, Math.min(nextCursorOffset, nextValue.length));
      setCursorOffset(nextCursorOffset);
      if (nextValue !== originalValue) onChange(nextValue);
    },
    { isActive: focus },
  );

  if (!focus) {
    return originalValue.length > 0 ? (
      <Text>{originalValue}</Text>
    ) : (
      <Text dimColor>{placeholder}</Text>
    );
  }

  // Fake cursor via inverse video, same approach as the original component.
  if (originalValue.length === 0) {
    return placeholder.length > 0 ? (
      <Text>
        <Text inverse>{placeholder[0]}</Text>
        <Text dimColor>{placeholder.slice(1)}</Text>
      </Text>
    ) : (
      <Text inverse> </Text>
    );
  }

  const beforeCursor = originalValue.slice(0, cursorOffset);
  // The cursor block spans a full code point, so emoji are not split.
  const cursorEnd = nextCodePoint(originalValue, cursorOffset);
  const atCursor =
    cursorOffset < originalValue.length ? originalValue.slice(cursorOffset, cursorEnd) : ' ';
  const afterCursor = cursorOffset < originalValue.length ? originalValue.slice(cursorEnd) : '';

  // A cursor sitting on a newline renders as an inverse space at the end of
  // its line; the newline itself still breaks the row.
  return (
    <Text>
      {beforeCursor}
      {atCursor === '\n' ? (
        <>
          <Text inverse> </Text>
          {'\n'}
        </>
      ) : (
        <Text inverse>{atCursor}</Text>
      )}
      {afterCursor}
    </Text>
  );
}
