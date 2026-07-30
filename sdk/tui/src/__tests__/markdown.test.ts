import { describe, expect, it } from 'vitest';
import { inlineToPlain, parseInline, parseMarkdown, type Block } from '../chat/markdown.js';

describe('parseInline', () => {
  it('parses plain text as a single node', () => {
    expect(parseInline('hello world')).toEqual([{ type: 'text', value: 'hello world' }]);
  });

  it('parses bold with ** and __', () => {
    expect(parseInline('a **b** c')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'strong', children: [{ type: 'text', value: 'b' }] },
      { type: 'text', value: ' c' },
    ]);
    expect(parseInline('__b__')).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'b' }] },
    ]);
  });

  it('parses italic without swallowing bold', () => {
    expect(parseInline('*i*')).toEqual([{ type: 'em', children: [{ type: 'text', value: 'i' }] }]);
    expect(parseInline('**b**')).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'b' }] },
    ]);
  });

  it('parses inline code verbatim, ignoring markup inside', () => {
    expect(parseInline('run `a **b**` now')).toEqual([
      { type: 'text', value: 'run ' },
      { type: 'code', value: 'a **b**' },
      { type: 'text', value: ' now' },
    ]);
  });

  it('parses strikethrough and links', () => {
    expect(parseInline('~~gone~~')).toEqual([
      { type: 'strike', children: [{ type: 'text', value: 'gone' }] },
    ]);
    expect(parseInline('[docs](https://x.dev)')).toEqual([
      { type: 'link', label: [{ type: 'text', value: 'docs' }], url: 'https://x.dev' },
    ]);
  });

  it('honors backslash escapes', () => {
    expect(parseInline('not \\*bold\\*')).toEqual([{ type: 'text', value: 'not *bold*' }]);
  });

  it('leaves unbalanced markers as literal text', () => {
    expect(parseInline('a * b')).toEqual([{ type: 'text', value: 'a * b' }]);
  });

  it('does not italicize intraword underscores', () => {
    expect(parseInline('flow_run_nodes')).toEqual([{ type: 'text', value: 'flow_run_nodes' }]);
    expect(parseInline('_emphasis_')).toEqual([
      { type: 'em', children: [{ type: 'text', value: 'emphasis' }] },
    ]);
  });

  it('flattens to plain text for measurement', () => {
    expect(inlineToPlain(parseInline('**bold** and `code`'))).toBe('bold and code');
  });
});

describe('parseMarkdown', () => {
  it('parses headings with their level', () => {
    const [block] = parseMarkdown('## Overall');
    expect(block).toEqual({
      type: 'heading',
      level: 2,
      inline: [{ type: 'text', value: 'Overall' }],
    });
  });

  it('groups wrapped lines into one paragraph', () => {
    const blocks = parseMarkdown('one\ntwo\n\nthree');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      inline: [{ type: 'text', value: 'one two' }],
    });
  });

  it('parses bullet and ordered lists with depth and ordinals', () => {
    const [list] = parseMarkdown('- a\n- b\n  - nested\n1. first\n2. second') as [
      Extract<Block, { type: 'list' }>,
    ];
    expect(list.type).toBe('list');
    expect(list.items.map((i) => ({ depth: i.depth, ordinal: i.ordinal }))).toEqual([
      { depth: 0, ordinal: null },
      { depth: 0, ordinal: null },
      { depth: 1, ordinal: null },
      { depth: 0, ordinal: 1 },
      { depth: 0, ordinal: 2 },
    ]);
  });

  it('parses fenced code blocks and keeps content literal', () => {
    const [block] = parseMarkdown('```ts\nconst x = **1**;\n```') as [
      Extract<Block, { type: 'code' }>,
    ];
    expect(block).toEqual({ type: 'code', lang: 'ts', lines: ['const x = **1**;'] });
  });

  it('parses a GitHub-style table', () => {
    const [table] = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |') as [
      Extract<Block, { type: 'table' }>,
    ];
    expect(table.type).toBe('table');
    expect(table.header.map(inlineToPlain)).toEqual(['A', 'B']);
    expect(table.rows.map((r) => r.map(inlineToPlain))).toEqual([['1', '2']]);
  });

  it('parses blockquotes and horizontal rules', () => {
    expect(parseMarkdown('> quoted')[0]).toEqual({
      type: 'quote',
      inline: [{ type: 'text', value: 'quoted' }],
    });
    expect(parseMarkdown('---')[0]).toEqual({ type: 'hr' });
  });

  it('separates a paragraph that runs straight into a list', () => {
    const blocks = parseMarkdown('Summary:\n- one\n- two');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'list']);
  });
});
