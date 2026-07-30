import { describe, expect, it } from 'vitest';
import { highlightCode, type CodeSpan } from '../chat/highlight.js';

const flat = (spans: CodeSpan[]) => spans.map((s) => s.text).join('');
const byText = (spans: CodeSpan[], text: string) => spans.find((s) => s.text === text);

describe('highlightCode', () => {
  it('leaves unknown languages as the plain gray rendering', () => {
    expect(highlightCode(['anything at all'], 'brainfuck')).toEqual([
      [{ text: 'anything at all', color: 'gray' }],
    ]);
    expect(highlightCode(['plain'], null)).toEqual([[{ text: 'plain', color: 'gray' }]]);
  });

  it('reassembles to the exact source text', () => {
    const lines = ['const n = 42; // answer', 'if (n) return "done";'];
    for (const [i, spans] of highlightCode(lines, 'ts').entries()) {
      expect(flat(spans)).toBe(lines[i]);
    }
  });

  it('colors keywords, strings, numbers, and comments in ts', () => {
    const [spans] = highlightCode(['const n = 42; // answer'], 'ts');
    expect(byText(spans, 'const')).toMatchObject({ color: 'magenta' });
    expect(byText(spans, '42')).toMatchObject({ color: 'yellow' });
    expect(byText(spans, '// answer')).toMatchObject({ dim: true });
    const [strings] = highlightCode(['x = "hi \\" there"'], 'ts');
    expect(byText(strings, '"hi \\" there"')).toMatchObject({ color: 'green' });
  });

  it('does not color keyword-looking words inside identifiers', () => {
    const [spans] = highlightCode(['constant_return_if = 1'], 'ts');
    expect(flat(spans)).toBe('constant_return_if = 1');
    expect(spans.some((s) => s.color === 'magenta')).toBe(false);
  });

  it('carries block comments across lines', () => {
    const [first, second, third] = highlightCode(['a; /* start', 'middle', 'end */ b;'], 'ts');
    expect(byText(first, '/*')).toMatchObject({ dim: true });
    expect(second).toEqual([{ text: 'middle', dim: true }]);
    expect(byText(third, 'end */')).toMatchObject({ dim: true });
    expect(byText(third, ' b;')).toBeDefined();
  });

  it('carries template strings across lines', () => {
    const [first, second] = highlightCode(['const s = `one', 'two`;'], 'ts');
    expect(byText(first, '`one')).toMatchObject({ color: 'green' });
    expect(byText(second, 'two`')).toMatchObject({ color: 'green' });
  });

  it('matches sql keywords case-insensitively', () => {
    const [spans] = highlightCode(["SELECT name FROM users WHERE id = 'u_1';"], 'sql');
    expect(byText(spans, 'SELECT')).toMatchObject({ color: 'magenta' });
    expect(byText(spans, 'WHERE')).toMatchObject({ color: 'magenta' });
    expect(byText(spans, "'u_1'")).toMatchObject({ color: 'green' });
  });

  it('colors json and yaml object keys distinctly from string values', () => {
    const [json] = highlightCode(['{ "name": "reflex", "count": 2 }'], 'json');
    expect(byText(json, '"name"')).toMatchObject({ color: 'cyan' });
    expect(byText(json, '"reflex"')).toMatchObject({ color: 'green' });
    const [yaml] = highlightCode(['replicas: 3 # small'], 'yaml');
    expect(byText(yaml, 'replicas')).toMatchObject({ color: 'cyan' });
    expect(byText(yaml, '# small')).toMatchObject({ dim: true });
  });

  it('colors diff lines by their marker', () => {
    const [add, del, hunk, ctx] = highlightCode(['+new', '-old', '@@ -1 +1 @@', ' same'], 'diff');
    expect(add[0]).toMatchObject({ color: 'green' });
    expect(del[0]).toMatchObject({ color: 'red' });
    expect(hunk[0]).toMatchObject({ color: 'cyan' });
    expect(ctx[0]).toEqual({ text: ' same' });
  });

  it('treats # as a comment in python and shell but not in ts', () => {
    const [py] = highlightCode(['x = 1  # note'], 'python');
    expect(byText(py, '# note')).toMatchObject({ dim: true });
    const [sh] = highlightCode(['echo hi # note'], 'bash');
    expect(byText(sh, '# note')).toMatchObject({ dim: true });
    expect(byText(sh, 'echo')).toMatchObject({ color: 'magenta' });
    const [ts] = highlightCode(['const tag = id # nope'], 'ts');
    expect(ts.some((s) => s.dim)).toBe(false);
  });
});
