import { describe, it, expect } from 'vitest';
import {
  ATTACHMENTS_REQUEST_BODY_LIMIT,
  MAX_ATTACHMENTS_COUNT,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_AXON_PUBLISH_PAYLOAD_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_FILE_BYTES,
  PayloadTooLargeError,
  SUPPORTED_INLINE_IMAGE_MIME_TYPES,
  UserContentBlocksSchema,
  assertPublishPayloadWithinLimit,
  decodedBase64ByteLength,
  formatBytes,
  isPayloadTooLargeError,
} from './attachments.js';

describe('attachment size limits', () => {
  it('caps a single file at 2.5 MB (temporary 4 MiB publish-cap regression)', () => {
    expect(MAX_ATTACHMENT_FILE_BYTES).toBe(2.5 * 1024 * 1024);
  });

  it('caps the attachment count at 20', () => {
    expect(MAX_ATTACHMENTS_COUNT).toBe(20);
  });

  it('caps the combined raw size at 2.5 MB (temporary 4 MiB publish-cap regression)', () => {
    expect(MAX_ATTACHMENTS_TOTAL_BYTES).toBe(2.5 * 1024 * 1024);
  });

  it('leaves the server body limit above the total raw size plus base64 inflation', () => {
    // Base64 inflates by ~4/3; the body limit must hold the encoded payload
    // plus prompt/config overhead.
    expect(ATTACHMENTS_REQUEST_BODY_LIMIT).toBeGreaterThan(
      Math.ceil(MAX_ATTACHMENTS_TOTAL_BYTES * (4 / 3)),
    );
  });

  it('allows a single max-size file to fit within the total budget', () => {
    expect(MAX_ATTACHMENT_FILE_BYTES).toBeLessThanOrEqual(MAX_ATTACHMENTS_TOTAL_BYTES);
  });

  it('caps a single image at 2.5 MB (temporary 4 MiB publish-cap regression)', () => {
    expect(MAX_IMAGE_FILE_BYTES).toBe(2.5 * 1024 * 1024);
  });

  it('keeps the image target within the hard per-file ceiling', () => {
    expect(MAX_IMAGE_FILE_BYTES).toBeLessThanOrEqual(MAX_ATTACHMENT_FILE_BYTES);
  });

  it('caps image dimensions at 8000 px', () => {
    expect(MAX_IMAGE_DIMENSION).toBe(8000);
  });

  it('caps the Axon publish payload at the server gRPC decode limit (4 MiB)', () => {
    expect(MAX_AXON_PUBLISH_PAYLOAD_BYTES).toBe(4 * 1024 * 1024);
  });

  it('keeps the base64-inflated total attachment budget under the publish cap', () => {
    // Base64 inflates by ~4/3; the encoded total (plus prompt/envelope) must fit
    // under the 4 MiB publish cap.
    expect(Math.ceil(MAX_ATTACHMENTS_TOTAL_BYTES * (4 / 3))).toBeLessThan(
      MAX_AXON_PUBLISH_PAYLOAD_BYTES,
    );
  });

  it('documents the image MIME types accepted by inline image blocks', () => {
    expect([...SUPPORTED_INLINE_IMAGE_MIME_TYPES].sort()).toEqual([
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });
});

describe('formatBytes', () => {
  it('formats bytes under 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes with one decimal', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(Math.round(2.5 * 1024 * 1024))).toBe('2.5 MB');
  });
});

describe('decodedBase64ByteLength', () => {
  it('computes decoded bytes without decoding the payload', () => {
    expect(decodedBase64ByteLength('')).toBe(0);
    expect(decodedBase64ByteLength('YQ==')).toBe(1);
    expect(decodedBase64ByteLength('YWI=')).toBe(2);
    expect(decodedBase64ByteLength('YWJj')).toBe(3);
    expect(decodedBase64ByteLength('YW Jj\n')).toBe(3);
  });
});

describe('assertPublishPayloadWithinLimit', () => {
  it('does not throw for a payload at the limit', () => {
    const payload = 'a'.repeat(MAX_AXON_PUBLISH_PAYLOAD_BYTES);
    expect(() => assertPublishPayloadWithinLimit(payload)).not.toThrow();
  });

  it('throws PayloadTooLargeError when the payload exceeds the limit', () => {
    const payload = 'a'.repeat(MAX_AXON_PUBLISH_PAYLOAD_BYTES + 1);
    expect(() => assertPublishPayloadWithinLimit(payload)).toThrow(PayloadTooLargeError);
  });

  it('counts UTF-8 byte length, not character length', () => {
    // Each "€" is 3 bytes in UTF-8, so (cap / 3 + 1) chars exceed the byte cap
    // while staying well under it by character count.
    const charCount = Math.floor(MAX_AXON_PUBLISH_PAYLOAD_BYTES / 3) + 1;
    const payload = '€'.repeat(charCount);
    expect(payload.length).toBeLessThan(MAX_AXON_PUBLISH_PAYLOAD_BYTES);
    expect(() => assertPublishPayloadWithinLimit(payload)).toThrow(PayloadTooLargeError);
  });

  it('reports the payload and max sizes on the thrown error', () => {
    const payload = 'a'.repeat(MAX_AXON_PUBLISH_PAYLOAD_BYTES + 10);
    try {
      assertPublishPayloadWithinLimit(payload);
      expect.unreachable('expected assertPublishPayloadWithinLimit to throw');
    } catch (err) {
      expect(isPayloadTooLargeError(err)).toBe(true);
      const typed = err as PayloadTooLargeError;
      expect(typed.payloadBytes).toBe(MAX_AXON_PUBLISH_PAYLOAD_BYTES + 10);
      expect(typed.maxBytes).toBe(MAX_AXON_PUBLISH_PAYLOAD_BYTES);
    }
  });
});

describe('UserContentBlocksSchema limits', () => {
  function base64ForDecodedBytes(bytes: number): string {
    return 'A'.repeat(Math.ceil(bytes / 3) * 4);
  }

  it('accepts inline attachments within the shared limits', () => {
    const result = UserContentBlocksSchema.safeParse([
      { type: 'text', text: 'see attached' },
      {
        type: 'image',
        mimeType: 'image/png',
        data: base64ForDecodedBytes(1024),
      },
      {
        type: 'file',
        name: 'notes.txt',
        mimeType: 'text/plain',
        data: base64ForDecodedBytes(2048),
      },
    ]);

    expect(result.success).toBe(true);
  });

  it('rejects unsupported image MIME types before they reach providers', () => {
    const result = UserContentBlocksSchema.safeParse([
      { type: 'image', mimeType: 'image/svg+xml', data: base64ForDecodedBytes(1024) },
    ]);

    expect(result.success).toBe(false);
  });

  it('rejects images over the Anthropic per-image byte limit', () => {
    const result = UserContentBlocksSchema.safeParse([
      {
        type: 'image',
        mimeType: 'image/png',
        data: base64ForDecodedBytes(MAX_IMAGE_FILE_BYTES + 1),
      },
    ]);

    expect(result.success).toBe(false);
  });

  it('rejects files over the shared per-file byte limit', () => {
    const result = UserContentBlocksSchema.safeParse([
      {
        type: 'file',
        name: 'large.txt',
        mimeType: 'text/plain',
        data: base64ForDecodedBytes(MAX_ATTACHMENT_FILE_BYTES + 1),
      },
    ]);

    expect(result.success).toBe(false);
  });

  it('rejects more than the allowed number of inline attachments', () => {
    const result = UserContentBlocksSchema.safeParse(
      Array.from({ length: MAX_ATTACHMENTS_COUNT + 1 }, (_, index) => ({
        type: 'image' as const,
        mimeType: 'image/png',
        data: base64ForDecodedBytes(index + 1),
      })),
    );

    expect(result.success).toBe(false);
  });

  it('rejects combined inline attachments over the total byte limit', () => {
    const result = UserContentBlocksSchema.safeParse([
      {
        type: 'file',
        name: 'a.txt',
        mimeType: 'text/plain',
        data: base64ForDecodedBytes(MAX_ATTACHMENT_FILE_BYTES),
      },
      {
        type: 'file',
        name: 'b.txt',
        mimeType: 'text/plain',
        data: base64ForDecodedBytes(MAX_ATTACHMENT_FILE_BYTES),
      },
      {
        type: 'file',
        name: 'c.txt',
        mimeType: 'text/plain',
        data: base64ForDecodedBytes(1),
      },
    ]);

    expect(result.success).toBe(false);
  });
});
