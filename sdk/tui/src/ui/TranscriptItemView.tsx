import { Box, Text } from 'ink';
import type { SetupItem, ToolItem, TranscriptItem } from '../chat/transcript.js';
import {
  editSummary,
  formatDurationSecs,
  outputSummary,
  toolHeadline,
  clip,
} from '../chat/format.js';
import { Markdown } from './Markdown.js';

/** Max output lines shown under a tool call. */
const TOOL_OUTPUT_LINES = 4;
/** Max trailing lines of a still-streaming text block kept on screen. */
const LIVE_TEXT_TAIL_LINES = 12;

const TONE_COLORS = { info: 'gray', success: 'green', warn: 'yellow', error: 'red' } as const;

interface TranscriptItemViewProps {
  item: TranscriptItem;
  /** True when the item renders in the live tail (enables spinners/clipping). */
  live?: boolean;
  spinnerFrame?: string;
}

/**
 * One transcript item as terminal lines. Finalized items render exactly once
 * through `<Static>`, so everything here must look right frozen in scrollback.
 */
export function TranscriptItemView({ item, live, spinnerFrame = '⠿' }: TranscriptItemViewProps) {
  switch (item.kind) {
    case 'user':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Box gap={1}>
            <Text color="cyan" bold>
              ❯
            </Text>
            <Text wrap="wrap">{item.text}</Text>
          </Box>
          {item.attachments.map((name) => (
            <Text key={name} dimColor>
              {'  ⎘ '}
              {name}
            </Text>
          ))}
        </Box>
      );

    case 'text': {
      if (!item.text.trim()) return null;
      const text = live && !item.final ? tailLines(item.text, LIVE_TEXT_TAIL_LINES) : item.text;
      // While streaming, markdown is often mid-token (an unclosed ``` fence, a
      // half-written table); render it as plain text and only parse once final.
      return (
        <Box gap={1} marginTop={1}>
          <Text color="white">●</Text>
          <Box flexGrow={1}>
            {item.final ? <Markdown>{text}</Markdown> : <Text wrap="wrap">{text}</Text>}
          </Box>
        </Box>
      );
    }

    case 'thinking': {
      if (!item.final) {
        return (
          <Box gap={1} marginTop={1}>
            <Text color="gray">✳</Text>
            <Box flexGrow={1}>
              <Text dimColor italic wrap="wrap">
                Thinking… {tailLines(item.text, 3)}
              </Text>
            </Box>
          </Box>
        );
      }
      return (
        <Box gap={1}>
          <Text color="gray">✳</Text>
          <Text dimColor italic>
            {item.durationSecs !== null && item.durationSecs > 0
              ? `Thought for ${formatDurationSecs(item.durationSecs)}`
              : 'Thought'}
          </Text>
        </Box>
      );
    }

    case 'tool':
      return <ToolItemView item={item} spinnerFrame={spinnerFrame} />;

    case 'plan':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>☰ Plan</Text>
          {item.entries.map((entry, i) => (
            <Box key={i} gap={1}>
              <Text
                color={
                  entry.status === 'completed'
                    ? 'green'
                    : entry.status === 'in_progress'
                      ? 'cyan'
                      : 'gray'
                }
              >
                {entry.status === 'completed' ? '☑' : entry.status === 'in_progress' ? '◐' : '☐'}
              </Text>
              <Text
                dimColor={entry.status !== 'in_progress'}
                strikethrough={entry.status === 'completed'}
                wrap="truncate-end"
              >
                {entry.content}
              </Text>
            </Box>
          ))}
        </Box>
      );

    case 'question': {
      if (!item.outcome) return null; // pending questions render as the prompt, not inline
      const { status, answers } = item.outcome;
      if (status !== 'answered') {
        const label =
          status === 'skipped' ? 'Skipped' : status === 'dismissed' ? 'Dismissed' : 'Expired';
        return (
          <Box gap={1}>
            <Text color="yellow">?</Text>
            <Text dimColor>
              {label}: {clip(item.questions[0]?.question ?? 'question')}
            </Text>
          </Box>
        );
      }
      return (
        <Box flexDirection="column">
          {item.questions.map((q, i) => (
            <Box key={i} gap={1}>
              <Text color="green">?</Text>
              <Text wrap="wrap">
                <Text dimColor>{clip(q.question, 60)} → </Text>
                <Text color="green">{answers[q.question] ?? 'skipped'}</Text>
              </Text>
            </Box>
          ))}
        </Box>
      );
    }

    case 'permission': {
      if (!item.decision) return null; // pending renders as the prompt
      const allowed = item.decision === 'allowed' || item.decision === 'allowed-always';
      const label = allowed
        ? item.decision === 'allowed-always'
          ? 'Allowed (session)'
          : 'Allowed'
        : item.decision === 'expired'
          ? 'Expired'
          : item.decision === 'interrupted'
            ? 'Denied + interrupted'
            : 'Denied';
      return (
        <Box gap={1}>
          <Text color={allowed ? 'green' : item.decision === 'expired' ? 'gray' : 'red'}>
            {allowed ? '✓' : '✗'}
          </Text>
          <Text dimColor>
            {label}: {toolHeadline(item.toolName ?? 'tool', item.input)}
          </Text>
        </Box>
      );
    }

    case 'init':
      return (
        <Text dimColor>
          ⚙{' '}
          {[
            item.version ? `Claude Code v${item.version}` : 'Claude Code',
            item.model,
            item.cwd,
            item.permissionMode && item.permissionMode !== 'default'
              ? `mode: ${item.permissionMode}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      );

    case 'setup':
      return <SetupItemView item={item} spinnerFrame={spinnerFrame} />;

    case 'banner':
      return (
        <Box flexDirection="column" marginTop={1}>
          <Box gap={1}>
            <Text color={TONE_COLORS[item.tone]}>◆</Text>
            <Text
              color={item.tone === 'info' ? undefined : TONE_COLORS[item.tone]}
              dimColor={item.tone === 'info'}
            >
              {item.label}
            </Text>
          </Box>
          {item.detail ? (
            <Box marginLeft={2}>
              <Text dimColor wrap="wrap">
                {tailLines(item.detail, 3)}
              </Text>
            </Box>
          ) : null}
        </Box>
      );

    case 'log':
      return (
        <Text dimColor wrap="truncate-end">
          {'  │ '}
          {item.text}
        </Text>
      );

    case 'turn-end':
      if (item.cancelled) {
        return (
          <Box gap={1} marginTop={1}>
            <Text color="yellow">⊘</Text>
            <Text color="yellow">Interrupted</Text>
          </Box>
        );
      }
      return (
        <Box flexDirection="column" marginTop={1}>
          <Box gap={1}>
            <Text color="red">✗</Text>
            <Text color="red">Turn failed</Text>
          </Box>
          {item.detail ? (
            <Box marginLeft={2}>
              <Text dimColor wrap="wrap">
                {tailLines(item.detail, 3)}
              </Text>
            </Box>
          ) : null}
        </Box>
      );
  }
}

function ToolItemView({ item, spinnerFrame }: { item: ToolItem; spinnerFrame: string }) {
  const running = item.status === 'running' || item.status === 'pending';
  const glyph = running
    ? spinnerFrame
    : item.status === 'completed'
      ? '✓'
      : item.status === 'cancelled'
        ? '⊘'
        : '✗';
  const glyphColor = running
    ? 'cyan'
    : item.status === 'completed'
      ? 'green'
      : item.status === 'cancelled'
        ? 'yellow'
        : 'red';

  const change = editSummary(item.name, item.input);
  const resultLines: string[] = [];
  let hidden = 0;
  if (item.output && !change) {
    const summary = outputSummary(item.output, TOOL_OUTPUT_LINES);
    resultLines.push(...summary.lines);
    hidden = summary.hiddenCount;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box gap={1}>
        <Text color={glyphColor}>{glyph}</Text>
        <Text wrap="truncate-end">
          <Text bold>{toolHeadline(item.name, item.input)}</Text>
          {item.durationSecs !== null && item.durationSecs > 0 ? (
            <Text dimColor> ({formatDurationSecs(item.durationSecs)})</Text>
          ) : null}
        </Text>
      </Box>
      {change ? (
        <Text dimColor>
          {'  ⎿ '}
          {change}
        </Text>
      ) : null}
      {resultLines.map((line, i) => (
        <Text key={i} dimColor wrap="truncate-end">
          {i === 0 ? '  ⎿ ' : '    '}
          {line}
        </Text>
      ))}
      {hidden > 0 ? <Text dimColor>{`    … +${hidden} lines`}</Text> : null}
    </Box>
  );
}

function SetupItemView({ item, spinnerFrame }: { item: SetupItem; spinnerFrame: string }) {
  if (item.final) {
    const failed = item.steps.filter((s) => s.status === 'failed');
    const elapsed =
      item.completedAt !== null
        ? formatDurationSecs(Math.round((item.completedAt - item.startedAt) / 1000))
        : null;
    return (
      <Box gap={1}>
        <Text color={failed.length > 0 ? 'yellow' : 'green'}>{failed.length > 0 ? '⚠' : '✓'}</Text>
        <Text dimColor>
          Devbox ready
          {elapsed ? ` in ${elapsed}` : ''} · {item.steps.length} setup steps
          {failed.length > 0
            ? ` · ${failed.length} failed (${failed.map((f) => f.label).join(', ')})`
            : ''}
        </Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box gap={1}>
        <Text color="cyan">{spinnerFrame}</Text>
        <Text>Setting up devbox…</Text>
      </Box>
      {item.steps.map((step) => (
        <Box key={step.id} gap={1} marginLeft={2}>
          <Text
            color={step.status === 'done' ? 'green' : step.status === 'failed' ? 'red' : 'cyan'}
          >
            {step.status === 'done' ? '✓' : step.status === 'failed' ? '✗' : spinnerFrame}
          </Text>
          <Text dimColor wrap="truncate-end">
            {step.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/** Last `max` lines of a block of text, with an ellipsis marker when clipped. */
function tailLines(text: string, max: number): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length <= max) return text;
  return `…\n${lines.slice(-max).join('\n')}`;
}
