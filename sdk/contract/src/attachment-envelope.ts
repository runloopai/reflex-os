/**
 * Text envelope used by chat agent providers to inline non-image, non-PDF
 * file attachments (e.g. `.patch`, `.md`, `.diff`, source files) into a
 * Claude/OpenCode user message as a single text block. The format is shared
 * between the providers (which produce it) and the chat renderer (which
 * detects it and collapses the inlined content into a chip in the user
 * bubble), so a regex change in one place doesn't silently break the other.
 *
 * Format:
 *
 *   [File: <name> (<mimeType>)]\n<content>\n[End of file: <name>]
 *
 * Notes on parsing:
 *
 * - Parsing is a single linear forward scan (`indexOf`), not a regex, so it
 *   cannot backtrack and is safe to run on untrusted, attacker-controlled
 *   text (no ReDoS).
 * - The close marker must match the exact `name` in the open marker. This
 *   means an envelope whose `content` happens to contain
 *   `[End of file: other-name]` won't terminate prematurely.
 * - Multiple envelopes in one text are extracted left-to-right.
 * - Whitespace around removed envelopes is collapsed: runs of three or more
 *   newlines become two, and the result is trimmed.
 */

export const FILE_ENVELOPE_OPEN_PREFIX = '[File: ';
export const FILE_ENVELOPE_CLOSE_PREFIX = '[End of file: ';

/** Build a text envelope around an inlined file's UTF-8 content. */
export function formatFileEnvelope(name: string, mimeType: string, content: string): string {
  return `${FILE_ENVELOPE_OPEN_PREFIX}${name} (${mimeType})]\n${content}\n${FILE_ENVELOPE_CLOSE_PREFIX}${name}]`;
}

export interface ParsedFileEnvelope {
  name: string;
  mimeType: string;
  content: string;
}

export interface ParsedEnvelopeText {
  /**
   * The original text with all matched envelopes removed and surrounding
   * whitespace collapsed/trimmed. Use this when displaying the user's typed
   * portion of a message in the UI.
   */
  cleanedText: string;
  /** All envelopes extracted from the text, in document order. */
  files: ParsedFileEnvelope[];
}

interface ParsedEnvelopeAt extends ParsedFileEnvelope {
  /** Index in the source string just past the close marker. */
  end: number;
}

/**
 * Parse one envelope whose `[File: ` open marker is at `openIdx` and whose
 * header line ends at `headerNewline` (the index of the `\n` after the
 * header). Returns `null` when the bytes are not a well-formed envelope, so the
 * caller can treat a literal `[File: ` in prose as plain text.
 *
 * Header parsing is bounded to the single header line (so it can never scan the
 * whole string looking for a `(` or `)` that isn't there), and the body is
 * located with one forward `indexOf` for the exact close marker. There is no
 * regex and no backtracking, so this is safe on untrusted text.
 *
 * Field rules mirror the historical regex: `name` excludes `(` and newlines,
 * `mimeType` excludes `)` and newlines, the header ends in `)]`, and the close
 * marker `\n[End of file: <name>]` must repeat the exact same `name`.
 */
function parseEnvelopeAt(
  text: string,
  openIdx: number,
  headerNewline: number,
): ParsedEnvelopeAt | null {
  const nameStart = openIdx + FILE_ENVELOPE_OPEN_PREFIX.length;
  // Header content between `[File: ` and the line's newline: "name (mimeType)]".
  // Slicing bounds every search below to this one line.
  const header = text.slice(nameStart, headerNewline);

  // name: up to the first ` (`, with no `(` of its own.
  const sep = header.indexOf(' (');
  if (sep === -1) return null;
  const name = header.slice(0, sep);
  if (name.length === 0 || name.includes('(')) return null;

  // mimeType: between `(` and the first `)`, which must be the second-to-last
  // header char, immediately before the closing `]`.
  const mimeStart = sep + 2;
  const closeParen = header.indexOf(')', mimeStart);
  if (closeParen === -1) return null;
  const mimeType = header.slice(mimeStart, closeParen);
  if (mimeType.length === 0) return null;
  if (closeParen + 2 !== header.length || header[closeParen + 1] !== ']') return null;

  // content: everything up to the matching close marker (lazily — the first
  // occurrence). Embedding `name` in the needle enforces the same-name rule.
  const contentStart = headerNewline + 1;
  const closeMarker = `\n${FILE_ENVELOPE_CLOSE_PREFIX}${name}]`;
  const closeIdx = text.indexOf(closeMarker, contentStart);
  if (closeIdx === -1) return null;

  return {
    name,
    mimeType,
    content: text.slice(contentStart, closeIdx),
    end: closeIdx + closeMarker.length,
  };
}

/**
 * Extract every {@link formatFileEnvelope} block from a string.
 *
 * Returns the cleaned text (with envelopes removed) plus a list of parsed
 * `{ name, mimeType, content }` records. If `text` contains no envelopes the
 * cleaned text is the input unchanged.
 */
export function parseFileEnvelopes(text: string): ParsedEnvelopeText {
  // Fast paths: an envelope needs both markers, so if either is absent there is
  // nothing to extract. Bailing here also keeps inputs full of bare `[File: `
  // markers (with no closing marker) linear rather than rescanned per marker.
  if (!text.includes(FILE_ENVELOPE_OPEN_PREFIX) || !text.includes(FILE_ENVELOPE_CLOSE_PREFIX)) {
    return { cleanedText: text, files: [] };
  }

  const files: ParsedFileEnvelope[] = [];
  const pieces: string[] = [];
  // `cursor` tracks consumed text (kept in the output); `searchFrom` tracks
  // where to look for the next open marker. They diverge only when a `[File: `
  // turns out not to be a real envelope — we skip past it to keep scanning but
  // leave its text in place.
  let cursor = 0;
  let searchFrom = 0;

  for (;;) {
    const openIdx = text.indexOf(FILE_ENVELOPE_OPEN_PREFIX, searchFrom);
    if (openIdx === -1) break;

    // Every envelope needs a newline ending its header. If none remains after
    // this marker, no further envelope can complete — stop scanning. This also
    // bounds the header search below to a single line.
    const headerNewline = text.indexOf('\n', openIdx + FILE_ENVELOPE_OPEN_PREFIX.length);
    if (headerNewline === -1) break;

    const envelope = parseEnvelopeAt(text, openIdx, headerNewline);
    if (!envelope) {
      searchFrom = openIdx + FILE_ENVELOPE_OPEN_PREFIX.length;
      continue;
    }

    pieces.push(text.slice(cursor, openIdx));
    files.push({ name: envelope.name, mimeType: envelope.mimeType, content: envelope.content });
    cursor = envelope.end;
    searchFrom = envelope.end;
  }

  if (files.length === 0) {
    return { cleanedText: text, files: [] };
  }
  pieces.push(text.slice(cursor));

  // Collapse the whitespace gap left behind when an envelope was removed
  // mid-text (typical case: `"hi\n[File: ...]"` → `"hi\n"` → trim → `"hi"`).
  const cleanedText = pieces
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { cleanedText, files };
}
