/**
 * Dependency-free syntax highlighting for fenced code blocks, in the spirit
 * of the hand-rolled Markdown parser next door: a small line scanner with
 * per-language keyword sets, not a grammar engine. Known languages get
 * colored comments/strings/numbers/keywords; unknown languages keep the
 * plain gray rendering they had before.
 */

export interface CodeSpan {
  text: string;
  color?: string;
  dim?: boolean;
}

const COMMENT = { dim: true } as const;
const STRING = { color: 'green' } as const;
const NUMBER = { color: 'yellow' } as const;
const KEYWORD = { color: 'magenta' } as const;
const KEY = { color: 'cyan' } as const;

interface LangConfig {
  lineComments: string[];
  blockComment: [string, string] | null;
  /** String delimiters, longest first; entries in `multiline` may span lines. */
  stringDelims: string[];
  multiline: string[];
  keywords: Set<string>;
  caseInsensitiveKeywords?: boolean;
  /** Color `"key":` / `key:` object keys (json, yaml). */
  colonKeys?: boolean;
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const JS_TS: LangConfig = {
  lineComments: ['//'],
  blockComment: ['/*', '*/'],
  stringDelims: ['`', '"', "'"],
  multiline: ['`'],
  keywords: words(
    'abstract any as async await break case catch class const continue debugger default delete do ' +
      'else enum export extends false finally for from function if implements import in instanceof ' +
      'interface keyof let namespace never new null of private protected public readonly return ' +
      'satisfies static super switch this throw true try type typeof undefined unknown var void while yield',
  ),
};

const C_LIKE: LangConfig = {
  lineComments: ['//'],
  blockComment: ['/*', '*/'],
  stringDelims: ['"', "'"],
  multiline: [],
  keywords: words(
    'auto bool break case catch char class const continue default delete do double else enum extern ' +
      'false final float for goto if inline int long namespace new nullptr override private protected ' +
      'public return short signed sizeof static struct switch template this throw true try typedef ' +
      'union unsigned using virtual void volatile while',
  ),
};

const PYTHON: LangConfig = {
  lineComments: ['#'],
  blockComment: null,
  stringDelims: ['"""', "'''", '"', "'"],
  multiline: ['"""', "'''"],
  keywords: words(
    'False None True and as assert async await break class continue def del elif else except finally ' +
      'for from global if import in is lambda match nonlocal not or pass raise return self try while with yield',
  ),
};

const SHELL: LangConfig = {
  lineComments: ['#'],
  blockComment: null,
  stringDelims: ['"', "'"],
  multiline: [],
  keywords: words(
    'alias case cd do done echo elif else esac exit export fi for function if in local read readonly ' +
      'return select set shift source then trap unset until while',
  ),
};

const SQL: LangConfig = {
  lineComments: ['--'],
  blockComment: ['/*', '*/'],
  stringDelims: ["'"],
  multiline: [],
  caseInsensitiveKeywords: true,
  keywords: words(
    'add all alter analyze and as asc avg begin between by case cascade column commit count create cross ' +
      'default delete desc distinct drop else end exists explain foreign from full grant group having in ' +
      'index inner insert into is join key left like limit max min not null offset on or order outer ' +
      'primary references revoke rollback select set sum table then truncate union unique update using ' +
      'vacuum values view when where with',
  ),
};

const GO: LangConfig = {
  lineComments: ['//'],
  blockComment: ['/*', '*/'],
  stringDelims: ['`', '"', "'"],
  multiline: ['`'],
  keywords: words(
    'break case chan const continue default defer else fallthrough false for func go goto if import ' +
      'interface map nil package range return select struct switch true type var',
  ),
};

const RUST: LangConfig = {
  lineComments: ['//'],
  blockComment: ['/*', '*/'],
  stringDelims: ['"'],
  multiline: [],
  keywords: words(
    'as async await break const continue crate dyn else enum extern false fn for if impl in let loop ' +
      'match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  ),
};

const JSON_LANG: LangConfig = {
  lineComments: [],
  blockComment: null,
  stringDelims: ['"'],
  multiline: [],
  colonKeys: true,
  keywords: words('true false null'),
};

const YAML: LangConfig = {
  lineComments: ['#'],
  blockComment: null,
  stringDelims: ['"', "'"],
  multiline: [],
  colonKeys: true,
  keywords: words('true false null yes no'),
};

const LANGS: Record<string, LangConfig> = {
  js: JS_TS,
  jsx: JS_TS,
  ts: JS_TS,
  tsx: JS_TS,
  javascript: JS_TS,
  typescript: JS_TS,
  mjs: JS_TS,
  cjs: JS_TS,
  c: C_LIKE,
  h: C_LIKE,
  cpp: C_LIKE,
  hpp: C_LIKE,
  java: C_LIKE,
  kotlin: C_LIKE,
  kt: C_LIKE,
  cs: C_LIKE,
  csharp: C_LIKE,
  swift: C_LIKE,
  py: PYTHON,
  python: PYTHON,
  sh: SHELL,
  bash: SHELL,
  shell: SHELL,
  zsh: SHELL,
  console: SHELL,
  sql: SQL,
  psql: SQL,
  postgres: SQL,
  postgresql: SQL,
  mysql: SQL,
  sqlite: SQL,
  go: GO,
  golang: GO,
  rs: RUST,
  rust: RUST,
  json: JSON_LANG,
  jsonc: JSON_LANG,
  yaml: YAML,
  yml: YAML,
};

/** Scanner state carried across lines (block comments, template strings). */
interface ScanState {
  inBlockComment: boolean;
  stringDelim: string | null;
}

/**
 * Highlight a fenced code block. Returns one span array per input line;
 * unknown or absent languages come back as single gray spans (the previous
 * rendering), diff/patch gets per-line +/- coloring.
 */
export function highlightCode(lines: readonly string[], lang: string | null): CodeSpan[][] {
  const normalized = lang?.toLowerCase() ?? '';
  if (normalized === 'diff' || normalized === 'patch') {
    return lines.map((line) => [diffSpan(line)]);
  }
  const config = LANGS[normalized];
  if (!config) return lines.map((line) => [{ text: line, color: 'gray' }]);
  const state: ScanState = { inBlockComment: false, stringDelim: null };
  return lines.map((line) => scanLine(line, config, state));
}

function diffSpan(line: string): CodeSpan {
  if (line.startsWith('+++') || line.startsWith('---')) return { text: line, dim: true };
  if (line.startsWith('@@')) return { text: line, color: 'cyan' };
  if (line.startsWith('+')) return { text: line, color: 'green' };
  if (line.startsWith('-')) return { text: line, color: 'red' };
  return { text: line };
}

function scanLine(line: string, config: LangConfig, state: ScanState): CodeSpan[] {
  const spans: CodeSpan[] = [];
  let plain = '';
  const flush = () => {
    if (plain) {
      spans.push({ text: plain });
      plain = '';
    }
  };
  const push = (text: string, style: { color?: string; dim?: boolean }) => {
    flush();
    spans.push({ text, ...style });
  };

  let i = 0;
  while (i < line.length) {
    // Continue an open block comment from a previous line/segment.
    if (state.inBlockComment) {
      const close = config.blockComment ? line.indexOf(config.blockComment[1], i) : -1;
      if (close === -1) {
        push(line.slice(i), COMMENT);
        return spans;
      }
      const end = close + (config.blockComment?.[1].length ?? 0);
      push(line.slice(i, end), COMMENT);
      state.inBlockComment = false;
      i = end;
      continue;
    }
    // Continue an open multi-line string.
    if (state.stringDelim) {
      const close = findStringEnd(line, i, state.stringDelim);
      if (close === -1) {
        push(line.slice(i), STRING);
        return spans;
      }
      push(line.slice(i, close), STRING);
      state.stringDelim = null;
      i = close;
      continue;
    }

    const rest = line.slice(i);
    const lineComment = config.lineComments.find((marker) => rest.startsWith(marker));
    if (lineComment) {
      push(rest, COMMENT);
      return spans;
    }
    if (config.blockComment && rest.startsWith(config.blockComment[0])) {
      state.inBlockComment = true;
      push(line.slice(i, i + config.blockComment[0].length), COMMENT);
      i += config.blockComment[0].length;
      continue;
    }
    const delim = config.stringDelims.find((d) => rest.startsWith(d));
    if (delim) {
      const close = findStringEnd(line, i + delim.length, delim);
      if (close === -1) {
        push(line.slice(i), STRING);
        if (config.multiline.includes(delim)) state.stringDelim = delim;
        return spans;
      }
      const style = config.colonKeys && isColonKey(line, close) ? KEY : STRING;
      push(line.slice(i, close), style);
      i = close;
      continue;
    }
    const char = line[i];
    if (/\d/.test(char) && !/[\w$]/.test(line[i - 1] ?? '')) {
      const match = /^[\d][\w.]*/.exec(rest);
      if (match) {
        push(match[0], NUMBER);
        i += match[0].length;
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(char)) {
      const match = /^[\w$]+/.exec(rest);
      if (match) {
        const word = config.caseInsensitiveKeywords ? match[0].toLowerCase() : match[0];
        if (config.keywords.has(word)) {
          push(match[0], KEYWORD);
        } else if (config.colonKeys && isColonKey(line, i + match[0].length)) {
          push(match[0], KEY);
        } else {
          plain += match[0];
        }
        i += match[0].length;
        continue;
      }
    }
    plain += char;
    i += 1;
  }
  flush();
  return spans;
}

/** Index just past the closing delimiter, honoring backslash escapes; -1 if unterminated. */
function findStringEnd(line: string, from: number, delim: string): number {
  let i = from;
  while (i < line.length) {
    if (line[i] === '\\') {
      i += 2;
      continue;
    }
    if (line.startsWith(delim, i)) return i + delim.length;
    i += 1;
  }
  return -1;
}

/** True when the token ending at `end` is followed by a colon (an object key). */
function isColonKey(line: string, end: number): boolean {
  return /^\s*:/.test(line.slice(end));
}
