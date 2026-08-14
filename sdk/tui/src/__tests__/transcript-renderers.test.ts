import { createElement } from 'react';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import type { FileChange } from '../chat/format.js';
import { renderTranscriptItem } from '../chat/render-text.js';
import type { ToolItem } from '../chat/transcript.js';
import { TranscriptItemView } from '../ui/TranscriptItemView.js';

function writeItem(fileChange: FileChange): ToolItem {
  return {
    kind: 'tool',
    id: 'tool-1',
    final: true,
    toolCallId: 'tool-use-1',
    name: 'Write',
    input: { file_path: '/repo/empty.py', content: '' },
    status: 'completed',
    output:
      fileChange !== 'unknown' && fileChange.operation === 'update'
        ? 'The file /repo/empty.py has been updated successfully.'
        : 'File created successfully at: /repo/empty.py',
    startedAt: 0,
    durationSecs: 0,
    backgroundTaskId: null,
    fileChange,
  };
}

const renderers: Array<{ name: string; render: (item: ToolItem) => string }> = [
  {
    name: 'plain-text renderer',
    render: (item) => renderTranscriptItem(item) ?? '',
  },
  {
    name: 'interactive renderer',
    render: (item) => renderToString(createElement(TranscriptItemView, { item })),
  },
];

describe.each(renderers)('$name', ({ render }) => {
  it('identifies an empty file creation', () => {
    const output = render(writeItem({ operation: 'create', added: 0, removed: 0 }));

    expect(output).toContain('created empty file');
    expect(output).not.toContain('no change');
  });

  it('keeps no-change wording for an empty update', () => {
    const output = render(writeItem({ operation: 'update', added: 0, removed: 0 }));

    expect(output).toContain('no change');
    expect(output).not.toContain('created empty file');
  });
});
