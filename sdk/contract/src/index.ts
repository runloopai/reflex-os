/**
 * @runloop/reflex-contract — the parts of the Reflex contract that are not
 * expressible as generated API types.
 *
 * `@runloop/reflex-client` covers request and response shapes: it is generated
 * from Reflex's public OpenAPI document, so it never drifts from the running
 * API. What it cannot express is the behavior around those shapes — how a set
 * of files becomes the content blocks of a launch request, which bytes count
 * as an inline image, how a legacy `blueprintId` folds into structured sandbox
 * options. Those rules have to agree between the server and every client, so
 * they live here as one implementation rather than as prose each client
 * reimplements.
 *
 * This package is the source of truth for these definitions. The Reflex
 * server, its web app and its plugins import it directly, so they see exactly
 * what a published client sees.
 *
 * Its only dependency is `zod`.
 *
 * This file is the package's public API. Most modules are re-exported whole,
 * because everything in them is contract. The three attachment modules are
 * listed symbol by symbol instead: they carry private helpers (mime sniffing,
 * base64 sizing, the server's publish-payload guard) that callers should not
 * build on, and `export *` would have made those permanent API.
 */

export * from './ids.js';
export * from './agent-reference.js';

export {
  ATTACHMENTS_REQUEST_BODY_LIMIT,
  AttachmentSchema,
  MAX_ATTACHMENTS_COUNT,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_FILE_BYTES,
  SUPPORTED_INLINE_IMAGE_MIME_TYPES,
  UserContentBlockSchema,
  UserContentBlocksSchema,
  assertPublishPayloadWithinLimit,
  buildContentBlocks,
  formatBytes,
} from './attachments.js';
export type { Attachment, UserContentBlock } from './attachments.js';

export {
  IMAGE_EXTENSIONS,
  SNIFF_BYTES,
  TEXT_EXTENSIONS,
  classifyAttachmentBytes,
} from './attachment-classifier.js';
export type { Classification, ClassifyArgs } from './attachment-classifier.js';

export { formatFileEnvelope, parseFileEnvelopes } from './attachment-envelope.js';
export type { ParsedEnvelopeText, ParsedFileEnvelope } from './attachment-envelope.js';
export * from './agent-queue.js';
export * from './custom-sandbox-size.js';
export * from './resource-size.js';
export * from './sandbox-options.js';
export * from './plugin-attachments.js';
export * from './ask-user-question.js';
