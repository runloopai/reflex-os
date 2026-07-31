import { z } from 'zod';

/**
 * TEMPORARY: maximum size, in bytes, of a single Axon publish payload accepted
 * by the Runloop publish endpoint (`POST /v1/axons/{id}/publish`), mirroring
 * the server-side gRPC decode cap (4 MiB / tonic's default).
 *
 * Reflex inlines attachments as base64 JSON in the published event payload, so
 * every attachment-bearing publish must fit under this cap. All of the
 * attachment limits below are deliberately derived from it (base64 inflates by
 * ~4/3, so the raw attachment budget is ~3 MB) and are therefore much smaller
 * than what the product wants.
 *
 * This is a temporary regression: the intended end state raises the server gRPC
 * decode limit (see the rolled-back "Axon publish oversize fix" work) so these
 * caps can be loosened again. When the server cap is raised, bump this constant
 * and the derived limits below in lockstep.
 */
export const MAX_AXON_PUBLISH_PAYLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Attachment size limits shared by the web client and the API server so both
 * sides agree on what a single launch/message request may carry. Attachments
 * are inlined as base64 inside the JSON request body, so the server body limit
 * must allow for the ~33% base64 inflation plus prompt/config overhead.
 *
 * TEMPORARY: every limit below is sized so a request fits under
 * {@link MAX_AXON_PUBLISH_PAYLOAD_BYTES} (4 MiB) once base64 encoded. They are
 * intentionally far below the product targets and should be raised together
 * with {@link MAX_AXON_PUBLISH_PAYLOAD_BYTES} once the server gRPC decode cap
 * is increased again.
 */
/**
 * TEMPORARY: maximum size of a single attachment, in bytes (2.5 MB). Capped so
 * one attachment, once base64 encoded (~3.3 MB), still fits under
 * {@link MAX_AXON_PUBLISH_PAYLOAD_BYTES} with headroom for the prompt/envelope.
 */
export const MAX_ATTACHMENT_FILE_BYTES = 2.5 * 1024 * 1024;
/**
 * TEMPORARY: maximum size of a single image, in bytes (2.5 MB). Anthropic's API
 * rejects any image larger than 5 MB, but the binding constraint here is the
 * 4 MiB Axon publish cap, so oversized images are downscaled client-side toward
 * this smaller target before they are attached. Images that still exceed it
 * after compression, or that exceed {@link MAX_ATTACHMENT_FILE_BYTES} outright,
 * are rejected.
 */
export const MAX_IMAGE_FILE_BYTES = 2.5 * 1024 * 1024;
/**
 * Maximum pixel size of either edge of an image. Anthropic rejects images
 * larger than 8000x8000 px regardless of byte size, so larger images are
 * downscaled client-side to fit within this bound on their longest edge.
 */
export const MAX_IMAGE_DIMENSION = 8000;
/** Maximum number of attachments per request. */
export const MAX_ATTACHMENTS_COUNT = 20;
/**
 * TEMPORARY: maximum combined raw size of all attachments per request, in bytes
 * (2.5 MB). Sized so the combined payload, once base64 encoded (~3.3 MB), fits
 * under {@link MAX_AXON_PUBLISH_PAYLOAD_BYTES} with headroom for the
 * prompt/envelope.
 */
export const MAX_ATTACHMENTS_TOTAL_BYTES = 2.5 * 1024 * 1024;
/**
 * TEMPORARY: server-side Fastify `bodyLimit` for attachment-bearing routes, in
 * bytes (4 MB). Covers {@link MAX_ATTACHMENTS_TOTAL_BYTES} raw (~3.3 MB once
 * base64 encoded) plus the prompt, env vars, and other config fields, while
 * staying aligned with the {@link MAX_AXON_PUBLISH_PAYLOAD_BYTES} publish cap.
 */
export const ATTACHMENTS_REQUEST_BODY_LIMIT = 4 * 1024 * 1024;
/**
 * Error thrown when a serialized Axon publish payload exceeds
 * {@link MAX_AXON_PUBLISH_PAYLOAD_BYTES}. Surfaced so the publish path can fail
 * fast with an actionable message (rather than a generic upstream error) when a
 * request slips past the per-attachment/total checks but still overflows the
 * 4 MiB publish cap once serialized.
 */
export class PayloadTooLargeError extends Error {
  /** Size of the offending payload, in bytes. */
  readonly payloadBytes: number;
  /** The maximum allowed payload size, in bytes. */
  readonly maxBytes: number;

  constructor(payloadBytes: number, maxBytes: number = MAX_AXON_PUBLISH_PAYLOAD_BYTES) {
    super(
      `Axon publish payload is too large: ${payloadBytes} bytes exceeds the ${maxBytes} byte ` +
        'limit. Reduce the request size (e.g. fewer or smaller attachments).',
    );
    this.name = 'PayloadTooLargeError';
    this.payloadBytes = payloadBytes;
    this.maxBytes = maxBytes;
  }
}

/** Type guard for {@link PayloadTooLargeError}. */
export function isPayloadTooLargeError(error: unknown): error is PayloadTooLargeError {
  return error instanceof PayloadTooLargeError;
}

/** UTF-8 byte length of a string, usable in both the browser and Node. */
const utf8Encoder = new TextEncoder();

/**
 * Throw a {@link PayloadTooLargeError} if `payload` exceeds
 * {@link MAX_AXON_PUBLISH_PAYLOAD_BYTES} when encoded as UTF-8.
 *
 * @param payload - The serialized publish payload string.
 * @throws {PayloadTooLargeError} If the payload is too large.
 */
export function assertPublishPayloadWithinLimit(payload: string): void {
  const payloadBytes = utf8Encoder.encode(payload).length;
  if (payloadBytes > MAX_AXON_PUBLISH_PAYLOAD_BYTES) {
    throw new PayloadTooLargeError(payloadBytes);
  }
}

/** Image MIME types accepted by Anthropic's image content block. */
export const SUPPORTED_INLINE_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/**
 * Format a byte count as a short human-readable string (`512 B`, `3.4 KB`,
 * `1.2 MB`). Used by attachment chips and the running-total indicator.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const AttachmentSchema = z.object({
  id: z.string(),
  type: z.enum(['file', 'image', 'link']),
  name: z.string(),
  url: z.string().optional(),
  path: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
  storageObjectId: z.string().optional(),
  /** Inline base64-encoded data for images read client-side. */
  data: z.string().optional(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const UserContentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image'), mimeType: z.string(), data: z.string() }),
  /**
   * Non-image file attachment with inline base64-encoded content.
   * Providers decide how to forward this to the LLM (PDFs → document block,
   * text-like files → inlined as a text block, other binaries → name-only mention).
   */
  z.object({
    type: z.literal('file'),
    name: z.string(),
    mimeType: z.string(),
    data: z.string(),
  }),
]);
export type UserContentBlock = z.infer<typeof UserContentBlockSchema>;

/**
 * Estimate the decoded byte size of a base64 payload without allocating the
 * decoded buffer. The client sends raw base64 strings, not data URLs.
 */
export function decodedBase64ByteLength(data: string): number {
  const normalized = data.replace(/\s/g, '');
  if (normalized.length === 0) return 0;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function validateUserContentBlocks(blocks: UserContentBlock[], ctx: z.RefinementCtx): void {
  let attachmentCount = 0;
  let totalBytes = 0;

  blocks.forEach((block, index) => {
    if (block.type === 'text') return;
    attachmentCount += 1;
    const decodedBytes = decodedBase64ByteLength(block.data);
    totalBytes += decodedBytes;

    if (block.type === 'image') {
      const mimeType = block.mimeType.toLowerCase();
      if (!SUPPORTED_INLINE_IMAGE_MIME_TYPES.has(mimeType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'mimeType'],
          message: 'Unsupported image MIME type',
        });
      }
      if (decodedBytes > MAX_IMAGE_FILE_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'data'],
          message: `Image attachments must be ${formatBytes(MAX_IMAGE_FILE_BYTES)} or smaller`,
        });
      }
      return;
    }

    if (decodedBytes > MAX_ATTACHMENT_FILE_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'data'],
        message: `File attachments must be ${formatBytes(MAX_ATTACHMENT_FILE_BYTES)} or smaller`,
      });
    }
  });

  if (attachmentCount > MAX_ATTACHMENTS_COUNT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `At most ${MAX_ATTACHMENTS_COUNT} attachments are allowed`,
    });
  }

  if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Inline attachments must total ${formatBytes(MAX_ATTACHMENTS_TOTAL_BYTES)} or less`,
    });
  }
}

export const UserContentBlocksSchema = z
  .array(UserContentBlockSchema)
  .superRefine(validateUserContentBlocks);

/**
 * Build a content block array from a text message and optional attachments.
 * Attachments with inline `data` are included:
 *   - `type === 'image'` → emitted as `image` blocks
 *   - `type === 'file'`  → emitted as `file` blocks (providers inline/convert per mime type)
 */
export function buildContentBlocks(
  message: string,
  attachments?: Attachment[],
): UserContentBlock[] {
  const blocks: UserContentBlock[] = [];
  if (message) {
    blocks.push({ type: 'text', text: message });
  }
  if (attachments) {
    for (const att of attachments) {
      if (!att.data || !att.mimeType) continue;
      if (att.type === 'image') {
        blocks.push({ type: 'image', mimeType: att.mimeType, data: att.data });
      } else if (att.type === 'file') {
        blocks.push({
          type: 'file',
          name: att.name,
          mimeType: att.mimeType,
          data: att.data,
        });
      }
    }
  }
  return blocks;
}
