import { color } from '../output/table.js';
import { clip, editSummary, formatDurationSecs, outputSummary, toolHeadline } from './format.js';
import { inlineToPlain, parseMarkdown, type Block } from './markdown.js';
import type { ToolItem, TranscriptItem } from './transcript.js';

/**
 * Transcript items as plain terminal text, for `watch` and `run`. The exact
 * plain-text counterpart of `ui/TranscriptItemView.tsx`: same glyphs, same
 * headline/summary helpers from `format.ts`, markdown flattened through the
 * chat markdown parser. Color follows `output/table.ts` rules (TTY only,
 * `NO_COLOR` respected), so piped output stays clean.
 */

/** Max output lines shown under a tool call (view parity). */
const TOOL_OUTPUT_LINES = 4;

const TONE_COLORS = { info: 'dim', success: 'green', warn: 'yellow', error: 'red' } as const;

/**
 * Render one finalized transcript item, or null for items with no printable
 * form (pending questions/permissions render nothing until resolved). Items
 * that open a new block start with a blank line, matching the TUI's spacing.
 */
export function renderTranscriptItem(item: TranscriptItem): string | null {
  switch (item.kind) {
    case 'user': {
      const lines = [`\n${color('❯', 'cyan')} ${indentContinuation(item.text)}`];
      for (const name of item.attachments) lines.push(color(`  ⎘ ${name}`, 'dim'));
      return lines.join('\n');
    }

    case 'text':
      if (!item.text.trim()) return null;
      return `\n● ${indentContinuation(markdownToText(item.text))}`;

    case 'thinking':
      return color(
        `✳ ${
          item.durationSecs !== null && item.durationSecs > 0
            ? `Thought for ${formatDurationSecs(item.durationSecs)}`
            : 'Thought'
        }`,
        'dim',
      );

    case 'tool':
      return renderTool(item);

    case 'plan': {
      const lines = [`\n${color('☰ Plan', 'dim')}`];
      for (const entry of item.entries) {
        const glyph =
          entry.status === 'completed'
            ? color('☑', 'green')
            : entry.status === 'in_progress'
              ? color('◐', 'cyan')
              : color('☐', 'dim');
        const text = entry.status === 'in_progress' ? entry.content : color(entry.content, 'dim');
        lines.push(`  ${glyph} ${text}`);
      }
      return lines.join('\n');
    }

    case 'question': {
      if (!item.outcome) return null; // pending; the watch prints a waiting notice instead
      const { status, answers } = item.outcome;
      if (status !== 'answered') {
        const label =
          status === 'skipped' ? 'Skipped' : status === 'dismissed' ? 'Dismissed' : 'Expired';
        return `${color('?', 'yellow')} ${color(`${label}: ${clip(item.questions[0]?.question ?? 'question')}`, 'dim')}`;
      }
      return item.questions
        .map(
          (q) =>
            `${color('?', 'green')} ${color(`${clip(q.question, 60)} →`, 'dim')} ${color(
              answers[q.question] ?? 'skipped',
              'green',
            )}`,
        )
        .join('\n');
    }

    case 'permission': {
      if (!item.decision) return null; // pending
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
      const glyph = allowed
        ? color('✓', 'green')
        : item.decision === 'expired'
          ? color('✗', 'dim')
          : color('✗', 'red');
      return `${glyph} ${color(`${label}: ${toolHeadline(item.toolName ?? 'tool', item.input)}`, 'dim')}`;
    }

    case 'init':
      return color(
        `⚙ ${[
          item.version ? `Claude Code v${item.version}` : 'Claude Code',
          item.model,
          item.cwd,
          item.permissionMode && item.permissionMode !== 'default'
            ? `mode: ${item.permissionMode}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}`,
        'dim',
      );

    case 'setup': {
      const failed = item.steps.filter((s) => s.status === 'failed');
      const elapsed =
        item.completedAt !== null
          ? formatDurationSecs(Math.round((item.completedAt - item.startedAt) / 1000))
          : null;
      const glyph = failed.length > 0 ? color('⚠', 'yellow') : color('✓', 'green');
      return `${glyph} ${color(
        `Devbox ready${elapsed ? ` in ${elapsed}` : ''} · ${item.steps.length} setup steps` +
          (failed.length > 0
            ? ` · ${failed.length} failed (${failed.map((f) => f.label).join(', ')})`
            : ''),
        'dim',
      )}`;
    }

    case 'banner': {
      const tone = TONE_COLORS[item.tone];
      const lines = [`\n${color('◆', tone)} ${color(item.label, tone)}`];
      if (item.detail) lines.push(color(indent(item.detail, '  '), 'dim'));
      return lines.join('\n');
    }

    case 'log':
      return color(`  │ ${clip(item.text, 120)}`, 'dim');

    case 'turn-end': {
      if (item.cancelled) return `\n${color('⊘ Interrupted', 'yellow')}`;
      const lines = [`\n${color('✗ Turn failed', 'red')}`];
      if (item.detail) lines.push(color(indent(item.detail, '  '), 'dim'));
      return lines.join('\n');
    }
  }
}

function renderTool(item: ToolItem): string {
  const glyph =
    item.status === 'completed'
      ? color('✓', 'green')
      : item.status === 'cancelled'
        ? color('⊘', 'yellow')
        : item.status === 'failed'
          ? color('✗', 'red')
          : color('●', 'cyan');
  const duration =
    item.durationSecs !== null && item.durationSecs > 0
      ? color(` (${formatDurationSecs(item.durationSecs)})`, 'dim')
      : '';
  const lines = [`\n${glyph} ${toolHeadline(item.name, item.input)}${duration}`];

  const change = editSummary(item.name, item.input, item.fileChange);
  if (change) {
    lines.push(color(`  ⎿ ${change}`, 'dim'));
  } else if (item.output) {
    const summary = outputSummary(item.output, TOOL_OUTPUT_LINES);
    summary.lines.forEach((line, i) => {
      lines.push(color(`${i === 0 ? '  ⎿ ' : '    '}${line}`, 'dim'));
    });
    if (summary.hiddenCount > 0) lines.push(color(`    … +${summary.hiddenCount} lines`, 'dim'));
  }
  return lines.join('\n');
}

/** Flatten agent markdown into readable plain text (no ANSI styling). */
export function markdownToText(src: string): string {
  return parseMarkdown(src).map(blockToText).join('\n');
}

function blockToText(block: Block): string {
  switch (block.type) {
    case 'heading':
      return inlineToPlain(block.inline);
    case 'paragraph':
      return inlineToPlain(block.inline);
    case 'code':
      return block.lines.map((line) => `  ${line}`).join('\n');
    case 'list':
      return block.items
        .map(
          (item) =>
            `${'  '.repeat(item.depth)}${item.ordinal !== null ? `${item.ordinal}.` : '-'} ${inlineToPlain(item.inline)}`,
        )
        .join('\n');
    case 'quote':
      return `> ${inlineToPlain(block.inline)}`;
    case 'hr':
      return '───';
    case 'table': {
      const rows = [block.header, ...block.rows];
      return rows.map((row) => row.map(inlineToPlain).join(' | ')).join('\n');
    }
  }
}

/** Indent every line after the first so multi-line text hangs under its glyph. */
function indentContinuation(text: string): string {
  return text.replace(/\n/g, '\n  ');
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}
