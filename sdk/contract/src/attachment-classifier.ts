/**
 * Hybrid file classifier shared between client and server.
 *
 * The chat attachment pipeline only emits content the providers can actually
 * use: raster images (Claude + OpenCode native), PDFs (Claude native; OpenCode
 * degrades to a name-only mention), and text/code (both providers inline as
 * a text block when the MIME starts with `text/` or is `application/json` /
 * `application/xml`). SVG is treated as XML text because Anthropic's image
 * source block does not accept `image/svg+xml`.
 *
 * Browsers don't set a useful MIME for many text formats (`.patch`, `.diff`,
 * `Dockerfile`, `.editorconfig`, etc. — `file.type` is often `''`). Rather
 * than maintain an exhaustive extension allowlist, we sniff the first 8 KB
 * of the file using the same heuristic Git's `is_binary()` uses (NUL-byte
 * check + strict UTF-8 decode) and normalize unknown text MIMEs to
 * `text/plain` so the providers' existing text-inlining branch fires.
 */

import { SUPPORTED_INLINE_IMAGE_MIME_TYPES } from './attachments.js';

export const IMAGE_EXTENSIONS = new Set<string>(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

export const TEXT_EXTENSIONS = new Set<string>([
  '.txt',
  '.md',
  '.json',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.rs',
  '.go',
  '.yaml',
  '.yml',
  '.toml',
  '.csv',
  '.log',
  '.sh',
  '.bash',
  '.html',
  '.css',
  '.xml',
  '.svg',
  '.sql',
  '.env',
  '.cfg',
  '.ini',
  '.conf',
]);

export const TEXT_MIME_PREFIXES = ['text/'] as const;
export const TEXT_MIME_EXACT = new Set<string>([
  'application/json',
  'application/xml',
  'image/svg+xml',
]);

/** Number of leading bytes the sniffer inspects. Mirrors Git's 8000-byte window. */
export const SNIFF_BYTES = 8192;

/**
 * Lower-case file extension including the leading dot, or `''` if the name
 * has no extension. Matches the behaviour of Node's `path.extname` on a
 * basename, but works in any JS runtime without needing `node:path`.
 */
export function getExtension(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const base = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

export function isImageByMime(mime: string): boolean {
  return SUPPORTED_INLINE_IMAGE_MIME_TYPES.has(mime.toLowerCase());
}

export function isPdfByMime(mime: string): boolean {
  return mime === 'application/pdf';
}

export function isKnownTextMime(mime: string): boolean {
  if (!mime) return false;
  for (const prefix of TEXT_MIME_PREFIXES) {
    if (mime.startsWith(prefix)) return true;
  }
  return TEXT_MIME_EXACT.has(mime);
}

/**
 * Decide if a Uint8Array slice (first {@link SNIFF_BYTES} of the file) looks
 * like UTF-8 text. Mirrors Git's `is_binary()` check: any NUL byte in the
 * window is a strong binary signal, and we additionally require the bytes
 * to decode cleanly as UTF-8.
 */
export function sniffIsTextBytes(head: Uint8Array): boolean {
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return true;
  } catch {
    return false;
  }
}

export type Classification =
  | { kind: 'image'; mimeType: string }
  | { kind: 'pdf'; mimeType: 'application/pdf' }
  | { kind: 'text'; mimeType: string }
  | { kind: 'rejected'; reason: 'binary' | 'invalid-utf8' | 'unknown' };

export interface ClassifyArgs {
  /** File name (used for extension fallback when the MIME is empty/unknown). */
  name: string;
  /** Browser-provided `file.type`. May be `''`. */
  mimeType: string;
  /** First {@link SNIFF_BYTES} bytes of the file. */
  head: Uint8Array;
}

/**
 * Classify a file by its name, MIME, and head bytes.
 *
 * - Supported raster image MIME or known raster image extension → `image`.
 * - PDF MIME or `.pdf` extension → `pdf`.
 * - Known text MIME or extension → `text` (preserves the original MIME).
 * - Unknown MIME but bytes sniff as UTF-8 text → `text` with normalized
 *   `text/plain` MIME, so the providers' `isTextMimeType` branch fires.
 * - NUL byte in head → `rejected: binary`.
 * - Bytes don't decode as UTF-8 → `rejected: invalid-utf8`.
 * - Otherwise → `rejected: unknown`.
 */
export function classifyAttachmentBytes(args: ClassifyArgs): Classification {
  const ext = getExtension(args.name);
  const mime = args.mimeType ?? '';

  if (isImageByMime(mime) || IMAGE_EXTENSIONS.has(ext)) {
    return { kind: 'image', mimeType: mime || extensionToImageMime(ext) };
  }

  if (isPdfByMime(mime) || ext === '.pdf') {
    return { kind: 'pdf', mimeType: 'application/pdf' };
  }

  if (isKnownTextMime(mime)) {
    return { kind: 'text', mimeType: mime };
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    return { kind: 'text', mimeType: mime || 'text/plain' };
  }

  // Unknown extension and unknown MIME — sniff the bytes.
  if (args.head.length === 0) {
    return { kind: 'rejected', reason: 'unknown' };
  }
  for (let i = 0; i < args.head.length; i++) {
    if (args.head[i] === 0) {
      return { kind: 'rejected', reason: 'binary' };
    }
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(args.head);
  } catch {
    return { kind: 'rejected', reason: 'invalid-utf8' };
  }
  return { kind: 'text', mimeType: 'text/plain' };
}

function extensionToImageMime(ext: string): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}
