/**
 * Context references generalize agent-run references (see
 * `agent-reference.ts`) to any external "thing" a plugin can pull into a
 * prompt: a GitHub pull request, a Linear ticket, a Sentry issue. In the
 * composer the reference is compact, readable text — `@[<title>](<kind>:<id>)`
 * — so the chat shows a tidy chip, not a wall of context. Server-side, every
 * marker is expanded by the contributing plugin's resolver into a delimited
 * `<referenced-context>` block right before the prompt reaches the agent, so
 * the agent receives the real information while the displayed prompt stays
 * compact.
 *
 * The `kind` names the resolver (e.g. `github-pr`, `linear-issue`). It is a
 * lowercase slug that must contain a hyphen, which keeps the marker pattern
 * from colliding with prose that happens to contain `](word:...)` — URLs
 * (`http:`, `mailto:`) have no hyphen — while `agent-run` markers stay owned
 * by `agent-reference.ts` and are explicitly excluded here.
 *
 * This module is the single source of truth for the marker format, shared by
 * the web composer (which builds markers) and the server (which parses and
 * expands them).
 */

/**
 * A context kind: lowercase slug with at least one hyphen (`github-pr`,
 * `linear-issue`). The hyphen requirement is what keeps `@[x](http://…)` and
 * other colon-bearing prose from parsing as a reference.
 */
export const CONTEXT_REFERENCE_KIND_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

/** The agent-run kind is owned by `agent-reference.ts`, never parsed here. */
const AGENT_RUN_KIND = 'agent-run';

// One marker: `@[` + readable label + `](<kind>:<encoded id>)`. Both the label
// and the id are length-bounded for the same polynomial-ReDoS reason as
// AGENT_RUN_REFERENCE in agent-reference.ts: every `@[` in a user-controlled
// prompt is a start anchor, so unbounded scans cost O(n^2).
const CONTEXT_REFERENCE =
  /@\[([^\]\n]{0,512})\]\(([a-z][a-z0-9]*(?:-[a-z0-9]+)+):([^\s)]{1,512})\)/g;

/** Strip characters that would break the marker's `[title](...)` framing. */
export function sanitizeContextRefTitle(title: string): string {
  return title
    .replace(/[[\]()\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Encode an id for embedding in a marker: ids may contain `/`, `#`, `@` (repo
 * slugs, branch names) but must not contain whitespace or `)` — those would
 * end the marker early — nor `"`, `<`, `>`, which would break the expanded
 * block's `id="…"` attribute framing (branch names may legally contain them).
 * Only the unsafe characters are escaped so the common ids stay
 * human-readable in copied text.
 */
export function encodeContextRefId(id: string): string {
  return id.replace(
    /[%\s)"<>]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}

/** Inverse of {@link encodeContextRefId}. Malformed escapes decode to themselves. */
export function decodeContextRefId(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

/**
 * Build the composer token for a referenced context item. Throws on a kind
 * that does not match {@link CONTEXT_REFERENCE_KIND_PATTERN} (a programmer
 * error in the contributing plugin, not user input).
 */
export function buildContextReference(kind: string, id: string, title: string): string {
  if (!CONTEXT_REFERENCE_KIND_PATTERN.test(kind) || kind === AGENT_RUN_KIND) {
    throw new Error(`Invalid context reference kind: ${JSON.stringify(kind)}`);
  }
  const label = sanitizeContextRefTitle(title) || kind;
  return `@[${label}](${kind}:${encodeContextRefId(id)})`;
}

export interface ContextReference {
  /** The full matched marker text. */
  raw: string;
  /** The resolver kind (e.g. `github-pr`). */
  kind: string;
  /** The referenced item's id, decoded. */
  id: string;
  /** The marker's readable label. */
  title: string;
  /** Index of the marker in the source string. */
  index: number;
}

/** Find every context reference marker in a string, in order. */
export function parseContextReferences(text: string): ContextReference[] {
  const out: ContextReference[] = [];
  for (const match of text.matchAll(CONTEXT_REFERENCE)) {
    if (match[2] === AGENT_RUN_KIND) continue;
    out.push({
      raw: match[0],
      kind: match[2],
      id: decodeContextRefId(match[3]),
      title: match[1],
      index: match.index ?? 0,
    });
  }
  return out;
}

/** Whether a string contains at least one context reference marker. */
export function hasContextReference(text: string): boolean {
  return parseContextReferences(text).length > 0;
}

// The server replaces a marker with a delimited context block so the agent
// receives the resolved content inline. The web chat collapses the same block
// back into a chip, so this wrapper is the shared contract. The id attribute
// carries the encoded id (attribute-safe: whitespace, quotes and angle
// brackets never survive encoding).
//
// The body is UNTRUSTED third-party content (ticket comments, PR bodies,
// stack traces). A body that could emit `referenced-context` or
// `referenced-agent-run` tags would let external content close the block
// early and forge chips in the chat — or unbalance the block into a wall of
// raw text — so those tag openers are neutralized before wrapping.
const REFERENCE_TAG_OPENER = /<(?=\/?referenced-(?:context|agent-run)\b)/g;

/** Wrap resolved context in the delimited block the chat knows. */
export function wrapContextRefContext(
  kind: string,
  id: string,
  title: string,
  body: string,
): string {
  const safeBody = body.replace(REFERENCE_TAG_OPENER, '&lt;');
  return `<referenced-context kind="${kind}" id="${encodeContextRefId(id)}" title=${JSON.stringify(
    title,
  )}>\n${safeBody}\n</referenced-context>`;
}

export type ContextRefSegment =
  | { type: 'text'; value: string }
  | { type: 'context'; kind: string; id: string; title: string };

/**
 * Split text into plain-text segments and compact `@[title](kind:id)` markers.
 * Used to re-hydrate a saved prompt string back into composer chips.
 */
export function splitContextRefMarkers(text: string): ContextRefSegment[] {
  const segments: ContextRefSegment[] = [];
  let cursor = 0;
  for (const ref of parseContextReferences(text)) {
    if (ref.index > cursor) segments.push({ type: 'text', value: text.slice(cursor, ref.index) });
    segments.push({ type: 'context', kind: ref.kind, id: ref.id, title: ref.title });
    cursor = ref.index + ref.raw.length;
  }
  if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor) });
  return segments.length > 0 ? segments : [{ type: 'text', value: text }];
}

// Any opening or closing referenced-context tag, used to find the *balanced*
// close of an outer block (a resolved body could itself quote such a block).
const REFERENCED_CONTEXT_TAG = /<(\/?)referenced-context\b[^>]*>/g;
const REFERENCED_CONTEXT_OPEN_ATTRS =
  /kind="([a-z][a-z0-9]*(?:-[a-z0-9]+)+)"\s+id="([^"\s]*)"\s+title="((?:[^"\\]|\\.)*)"/;

/**
 * Split text into plain-text segments and referenced-context blocks, so a
 * renderer can show each block as a chip instead of a wall of context.
 * Nesting-aware: matches each outer block to its balanced close. Returns a
 * single text segment when there are no blocks.
 */
export function splitContextRefBlocks(text: string): ContextRefSegment[] {
  const segments: ContextRefSegment[] = [];
  let cursor = 0;
  const tag = new RegExp(REFERENCED_CONTEXT_TAG);
  let match: RegExpExecArray | null;
  while ((match = tag.exec(text)) !== null) {
    if (match[1]) continue; // a closing tag with no matching open we tracked
    const attrs = match[0].match(REFERENCED_CONTEXT_OPEN_ATTRS);
    if (!attrs) continue; // malformed opening tag
    // Find the balanced close, counting nested opens.
    const scan = new RegExp(REFERENCED_CONTEXT_TAG);
    scan.lastIndex = tag.lastIndex;
    let depth = 1;
    let closeEnd = -1;
    let inner: RegExpExecArray | null;
    while ((inner = scan.exec(text)) !== null) {
      depth += inner[1] ? -1 : 1;
      if (depth === 0) {
        closeEnd = scan.lastIndex;
        break;
      }
    }
    if (closeEnd === -1) continue; // unbalanced — leave as text
    if (match.index > cursor)
      segments.push({ type: 'text', value: text.slice(cursor, match.index) });
    let title = attrs[3];
    try {
      title = JSON.parse(`"${attrs[3]}"`) as string;
    } catch {
      // Leave the raw (escaped) title if it isn't valid JSON string content.
    }
    segments.push({
      type: 'context',
      kind: attrs[1],
      id: decodeContextRefId(attrs[2]),
      title,
    });
    cursor = closeEnd;
    tag.lastIndex = closeEnd; // resume after the whole (balanced) block
  }
  if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor) });
  return segments.length > 0 ? segments : [{ type: 'text', value: text }];
}

/**
 * Replace every context reference marker using `resolve(kind, id)`. Each
 * unique (kind, id) pair is resolved once. When `resolve` returns `null` (no
 * resolver for the kind, not found, or the caller is not authorized) the
 * original marker is left untouched. Async so the server can call external
 * APIs.
 */
export async function expandContextReferences(
  text: string,
  resolve: (kind: string, id: string) => Promise<string | null>,
): Promise<string> {
  const refs = parseContextReferences(text);
  if (refs.length === 0) return text;

  const resolved = new Map<string, string | null>();
  await Promise.all(
    [...new Map(refs.map((r) => [`${r.kind}:${r.id}`, r])).values()].map(async (ref) => {
      resolved.set(`${ref.kind}:${ref.id}`, await resolve(ref.kind, ref.id));
    }),
  );

  // Rebuild left-to-right so each splice keeps the remaining indices valid.
  let out = '';
  let cursor = 0;
  for (const ref of refs) {
    out += text.slice(cursor, ref.index);
    out += resolved.get(`${ref.kind}:${ref.id}`) ?? ref.raw;
    cursor = ref.index + ref.raw.length;
  }
  return out + text.slice(cursor);
}
