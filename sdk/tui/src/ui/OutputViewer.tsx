import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { formatDurationSecs, toolHeadline } from '../chat/format.js';
import type { ToolItem } from '../chat/transcript.js';
import { SelectList } from './SelectList.js';
import { stepScroll } from './pager-model.js';
import { useTerminalSize } from './useTerminalSize.js';

interface OutputViewerProps {
  /** Tool calls with output, newest first. */
  tools: ToolItem[];
  onClose: () => void;
}

/**
 * ctrl+t viewer for full tool output. The transcript clips every result to a
 * few `⎿` lines and, once printed to scrollback, can never re-render — so
 * this overlay lives in the live region instead: pick a call, then page
 * through its complete output. Long lines are truncated, not wrapped, so
 * the window geometry stays stable.
 */
export function OutputViewer({ tools, onClose }: OutputViewerProps) {
  const [selected, setSelected] = useState<ToolItem | null>(tools.length === 1 ? tools[0] : null);
  const [top, setTop] = useState(0);

  if (!selected) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
        <Text color="cyan" bold>
          Tool output
        </Text>
        <SelectList
          options={tools.map((tool) => ({
            value: tool.toolCallId,
            label: toolHeadline(tool.name, tool.input),
            hint: [
              `${splitLines(tool.output ?? '').length} lines`,
              tool.durationSecs !== null && tool.durationSecs > 0
                ? formatDurationSecs(tool.durationSecs)
                : null,
              tool.status !== 'completed' ? tool.status : null,
            ]
              .filter(Boolean)
              .join(' · '),
          }))}
          onPick={(option) => {
            const tool = tools.find((t) => t.toolCallId === option.value);
            if (tool) {
              setSelected(tool);
              setTop(0);
            }
          }}
          onBack={onClose}
        />
        <Text dimColor>enter view · esc close</Text>
      </Box>
    );
  }

  return (
    <Pager
      tool={selected}
      top={top}
      onScroll={setTop}
      onBack={() => (tools.length === 1 ? onClose() : setSelected(null))}
    />
  );
}

function Pager({
  tool,
  top,
  onScroll,
  onBack,
}: {
  tool: ToolItem;
  top: number;
  onScroll: (top: number) => void;
  onBack: () => void;
}) {
  const { rows } = useTerminalSize();
  // Leave headroom for the transcript tail, border, title, and footer.
  const viewRows = Math.max(6, Math.min(24, rows - 12));
  const lines = splitLines(tool.output ?? '');
  const total = lines.length;

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onBack();
      return;
    }
    const action = key.upArrow
      ? ('up' as const)
      : key.downArrow
        ? ('down' as const)
        : key.pageUp || input === 'u'
          ? ('page-up' as const)
          : key.pageDown || input === 'd'
            ? ('page-down' as const)
            : input === 'g'
              ? ('top' as const)
              : input === 'G'
                ? ('bottom' as const)
                : null;
    if (action) onScroll(stepScroll(top, total, viewRows, action));
  });

  const clampedTop = Math.min(top, Math.max(0, total - viewRows));
  const visible = lines.slice(clampedTop, clampedTop + viewRows);
  const end = clampedTop + visible.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text color="cyan" bold wrap="truncate-end">
        {toolHeadline(tool.name, tool.input)}
      </Text>
      {visible.map((line, i) => (
        <Text key={clampedTop + i} wrap="truncate-end">
          {line.length > 0 ? line : ' '}
        </Text>
      ))}
      <Text dimColor>
        {clampedTop + 1}–{end} of {total} · ↑/↓ scroll · u/d page · g/G ends · esc back
      </Text>
    </Box>
  );
}

function splitLines(output: string): string[] {
  const lines = output.replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}
