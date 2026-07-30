import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { PickOption } from '../launch/options.js';

interface SelectListProps {
  options: PickOption[];
  onPick: (option: PickOption) => void;
  /** Fires on esc — usually "go back one step". */
  onBack?: () => void;
  isActive?: boolean;
  /** Rows shown at once; the window scrolls with the cursor. */
  visibleRows?: number;
  initialValue?: string | null;
}

/**
 * Cursor-driven option list for wizard steps: ↑/↓ or j/k move, 1-9 jump-pick,
 * enter confirms, esc goes back. Scrolls when the list outgrows the window.
 */
export function SelectList({
  options,
  onPick,
  onBack,
  isActive = true,
  visibleRows = 8,
  initialValue,
}: SelectListProps) {
  const initialIdx = Math.max(
    0,
    options.findIndex((o) => o.value === initialValue),
  );
  const [cursor, setCursor] = useState(initialIdx);
  const clamped = Math.min(cursor, Math.max(0, options.length - 1));

  useInput(
    (input, key) => {
      if (key.escape) {
        onBack?.();
        return;
      }
      if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
      if (key.downArrow || input === 'j') setCursor((c) => Math.min(options.length - 1, c + 1));
      if (input >= '1' && input <= '9') {
        const index = Number(input) - 1;
        if (index < options.length) onPick(options[index]);
        return;
      }
      if (key.return && options[clamped]) onPick(options[clamped]);
    },
    { isActive },
  );

  const start = Math.max(
    0,
    Math.min(clamped - Math.floor(visibleRows / 2), options.length - visibleRows),
  );
  const visible = options.slice(start, start + visibleRows);

  return (
    <Box flexDirection="column" marginLeft={2}>
      {visible.map((option, i) => {
        const index = start + i;
        const selected = index === clamped;
        return (
          <Box key={`${option.value ?? 'null'}-${index}`} gap={1}>
            <Text color="cyan">{selected ? '›' : ' '}</Text>
            <Text bold={selected} wrap="truncate-end">
              {index + 1}. {option.label}
              {option.hint ? <Text dimColor> — {option.hint}</Text> : null}
            </Text>
          </Box>
        );
      })}
      {options.length > start + visibleRows ? (
        <Text dimColor>{`  … ${options.length - start - visibleRows} more`}</Text>
      ) : null}
    </Box>
  );
}
