import { existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_ATTACHMENTS_COUNT,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  MAX_ATTACHMENT_FILE_BYTES,
  classifyAttachmentBytes,
  type Attachment,
} from '@reflex/shared';

/**
 * Chat attachments, the same mechanism the web composer uses: files are
 * classified with the shared sniffer, base64-inlined onto `Attachment`
 * objects, and sent as `UserContentBlock[]` via `buildContentBlocks` —
 * so the server and providers treat TUI attachments exactly like web ones.
 */

let nextLocalId = 0;

export async function loadAttachment(filePath: string): Promise<Attachment> {
  const abs = path.resolve(filePath);
  // Stat and read through one file descriptor so the size check and the read
  // can't disagree about which file they touched (TOCTOU).
  const handle = await open(abs, 'r').catch(() => null);
  if (!handle) throw new Error(`Not a file: ${filePath}`);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`Not a file: ${filePath}`);
    if (info.size > MAX_ATTACHMENT_FILE_BYTES) {
      throw new Error(
        `${path.basename(abs)} is ${info.size} bytes; the limit is ${MAX_ATTACHMENT_FILE_BYTES}`,
      );
    }
    const bytes = await handle.readFile();
    return attachmentFromBytes(path.basename(abs), bytes);
  } finally {
    await handle.close();
  }
}

/**
 * Build an attachment from in-memory bytes (clipboard images, generated
 * content) with the same shared classification file paths go through.
 */
export function attachmentFromBytes(name: string, bytes: Buffer): Attachment {
  if (bytes.byteLength > MAX_ATTACHMENT_FILE_BYTES) {
    throw new Error(
      `${name} is ${bytes.byteLength} bytes; the limit is ${MAX_ATTACHMENT_FILE_BYTES}`,
    );
  }
  const classification = classifyAttachmentBytes({ name, mimeType: '', head: bytes });
  if (classification.kind === 'rejected') {
    throw new Error(`${name} is not attachable (${classification.reason})`);
  }
  return {
    id: `local-${++nextLocalId}`,
    type: classification.kind === 'image' ? 'image' : 'file',
    name,
    mimeType: classification.mimeType,
    size: bytes.byteLength,
    data: bytes.toString('base64'),
  };
}

/**
 * When a pasted chunk is the path of an existing file — a drag-drop onto the
 * terminal pastes the (possibly quoted or backslash-escaped) path — return
 * the resolved path so the composer stages the file instead of inserting the
 * text. Anything else returns null and pastes normally.
 */
export function extractPastedPath(
  pasted: string,
  exists: (candidate: string) => boolean = existsSync,
  homedir: () => string = os.homedir,
): string | null {
  const trimmed = pasted.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;
  let candidate = trimmed;
  if (
    candidate.length > 1 &&
    ((candidate.startsWith("'") && candidate.endsWith("'")) ||
      (candidate.startsWith('"') && candidate.endsWith('"')))
  ) {
    candidate = candidate.slice(1, -1);
  }
  candidate = candidate.replace(/\\ /g, ' ');
  if (candidate === '~' || candidate.startsWith('~/')) {
    candidate = path.join(homedir(), candidate.slice(1));
  }
  // Require a path-shaped string (contains a separator) so a pasted word that
  // happens to match a file in the cwd doesn't silently become an attachment.
  if (!candidate.includes('/') && !candidate.includes(path.sep)) return null;
  return exists(candidate) ? candidate : null;
}

/** Throws with a user-facing message when adding `next` would break shared limits. */
export function assertAttachmentLimits(existing: Attachment[], next: Attachment): void {
  if (existing.length + 1 > MAX_ATTACHMENTS_COUNT) {
    throw new Error(`At most ${MAX_ATTACHMENTS_COUNT} attachments per message`);
  }
  const total = existing.reduce((sum, a) => sum + (a.size ?? 0), 0) + (next.size ?? 0);
  if (total > MAX_ATTACHMENTS_TOTAL_BYTES) {
    throw new Error(
      `Attachments exceed the combined limit of ${MAX_ATTACHMENTS_TOTAL_BYTES} bytes`,
    );
  }
}
