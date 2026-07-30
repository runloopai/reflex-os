/**
 * A small CommonMark-ish parser sized for the terminal chat.
 *
 * The agent streams Markdown (headings, bold/italic, inline code, fenced code,
 * lists, blockquotes, tables, links) and the raw source reads badly in a TUI —
 * asterisks and pipes clutter the prose. This turns a block of Markdown into a
 * flat block/inline AST that `ui/Markdown.tsx` maps onto Ink `<Text>` styling.
 *
 * It is deliberately a subset: no nested block quotes, no setext headings, no
 * reference links, no HTML. The goal is legible chat output, not spec
 * compliance. Kept framework-free (like `format.ts`) so it is unit-testable.
 */

// --- AST ---

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'strike'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; label: InlineNode[]; url: string };

export interface ListItemNode {
  inline: InlineNode[];
  /** Indentation depth (0 = top level), one step per two source spaces. */
  depth: number;
  /** Ordinal for ordered items, `null` for bullets. */
  ordinal: number | null;
}

export type Block =
  | { type: 'heading'; level: number; inline: InlineNode[] }
  | { type: 'paragraph'; inline: InlineNode[] }
  | { type: 'code'; lang: string | null; lines: string[] }
  | { type: 'list'; items: ListItemNode[] }
  | { type: 'quote'; inline: InlineNode[] }
  | { type: 'hr' }
  | { type: 'table'; header: InlineNode[][]; rows: InlineNode[][][] };

// --- Block parsing ---

const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^(\s*)(```+|~~~+)(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE = /^\s*>/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)+\|?\s*$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').replace(/\t/g, '  ').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const closer = fence[2][0] === '`' ? /^\s*`{3,}\s*$/ : /^\s*~{3,}\s*$/;
      const body: string[] = [];
      i++;
      while (i < lines.length && !closer.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (or EOF)
      blocks.push({ type: 'code', lang: fence[3].trim() || null, lines: body });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const text = heading[2].replace(/\s+#+\s*$/, ''); // strip closing ###
      blocks.push({ type: 'heading', level: heading[1].length, inline: parseInline(text) });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', inline: parseInline(quoted.join(' ').trim()) });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const header = splitRow(line).map(parseInline);
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const items: ListItemNode[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (m) {
          const indent = m[1].length;
          const ordered = /\d/.test(m[2]);
          items.push({
            inline: parseInline(m[3]),
            depth: Math.floor(indent / 2),
            ordinal: ordered ? Number.parseInt(m[2], 10) : null,
          });
          i++;
          continue;
        }
        // Indented, non-blank line with no marker: a continuation of the last item.
        if (items.length > 0 && lines[i].trim() && /^\s+\S/.test(lines[i])) {
          const last = items[items.length - 1];
          last.inline.push({ type: 'text', value: ' ' }, ...parseInline(lines[i].trim()));
          i++;
          continue;
        }
        break;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // Paragraph: gather consecutive lines until a blank line or a new block.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'paragraph', inline: parseInline(para.join(' ')) });
  }

  return blocks;
}

/** Whether `line` begins a non-paragraph block, so a paragraph run must stop. */
function startsBlock(line: string, next: string | undefined): boolean {
  if (HEADING.test(line) || HR.test(line) || FENCE.test(line)) return true;
  if (QUOTE.test(line) || LIST_ITEM.test(line)) return true;
  if (line.includes('|') && next !== undefined && TABLE_SEP.test(next)) return true;
  return false;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((cell) => cell.trim());
}

// --- Inline parsing ---

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      nodes.push({ type: 'text', value: buf });
      buf = '';
    }
  };

  while (i < text.length) {
    const ch = text[i];
    const rest = text.slice(i);

    if (ch === '\\' && i + 1 < text.length) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === '`') {
      const code = /^(`+)([\s\S]*?)\1(?!`)/.exec(rest);
      if (code) {
        flush();
        nodes.push({ type: 'code', value: code[2].trim() });
        i += code[0].length;
        continue;
      }
    }

    if (rest.startsWith('**') || rest.startsWith('__')) {
      const delim = rest.slice(0, 2);
      const close = text.indexOf(delim, i + 2);
      if (close > i + 1) {
        flush();
        nodes.push({ type: 'strong', children: parseInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if (rest.startsWith('~~')) {
      const close = text.indexOf('~~', i + 2);
      if (close > i + 1) {
        flush();
        nodes.push({ type: 'strike', children: parseInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    // `_` never opens emphasis mid-word (so `flow_run_nodes` stays literal);
    // `*` may, matching CommonMark's intraword rule.
    if (ch === '*' || (ch === '_' && !isWord(text[i - 1]))) {
      const close = closeSingle(text, i + 1, ch);
      if (close > i + 1) {
        flush();
        nodes.push({ type: 'em', children: parseInline(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    if (ch === '[') {
      const link = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
      if (link) {
        flush();
        nodes.push({ type: 'link', label: parseInline(link[1]), url: link[2] });
        i += link[0].length;
        continue;
      }
    }

    buf += ch;
    i++;
  }

  flush();
  return nodes;
}

/** Index of the next lone `ch` (not part of a doubled `**`/`__`) at or after `from`. */
function closeSingle(text: string, from: number, ch: string): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] !== ch || text[j + 1] === ch || text[j - 1] === ch) continue;
    // An underscore can't close emphasis mid-word either.
    if (ch === '_' && isWord(text[j + 1])) continue;
    return j;
  }
  return -1;
}

function isWord(ch: string | undefined): boolean {
  return ch !== undefined && /\w/.test(ch);
}

/** Plain-text width of an inline run, for table column sizing. */
export function inlineWidth(nodes: InlineNode[]): number {
  return inlineToPlain(nodes).length;
}

export function inlineToPlain(nodes: InlineNode[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'code':
        out += node.value;
        break;
      case 'strong':
      case 'em':
      case 'strike':
        out += inlineToPlain(node.children);
        break;
      case 'link':
        out += inlineToPlain(node.label);
        break;
    }
  }
  return out;
}
