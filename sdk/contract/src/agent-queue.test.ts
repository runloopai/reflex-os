import { describe, it, expect } from 'vitest';
import { EnqueueMessageRequestSchema, UpdateQueuedMessageRequestSchema } from './agent-queue.js';

const FILE_ATTACHMENT = {
  id: 'att-1',
  type: 'file',
  name: 'transcript.txt',
  mimeType: 'text/plain',
  data: 'SGVsbG8gd29ybGQ=',
} as const;

describe('EnqueueMessageRequestSchema', () => {
  it('accepts text-only payloads', () => {
    const result = EnqueueMessageRequestSchema.safeParse({ text: 'hello' });
    expect(result.success).toBe(true);
  });

  it('accepts attachment-only payloads (empty text)', () => {
    const result = EnqueueMessageRequestSchema.safeParse({
      text: '',
      attachments: [
        {
          id: 'att-1',
          type: 'file',
          name: 'transcript.txt',
          mimeType: 'text/plain',
          data: 'SGVsbG8gd29ybGQ=',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts text + attachments', () => {
    const result = EnqueueMessageRequestSchema.safeParse({
      text: 'see attached',
      attachments: [
        {
          id: 'att-1',
          type: 'file',
          name: 'transcript.txt',
          mimeType: 'text/plain',
          data: 'SGVsbG8gd29ybGQ=',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty text with no attachments', () => {
    const result = EnqueueMessageRequestSchema.safeParse({ text: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty text with an empty attachments array', () => {
    const result = EnqueueMessageRequestSchema.safeParse({ text: '', attachments: [] });
    expect(result.success).toBe(false);
  });
});

describe('UpdateQueuedMessageRequestSchema', () => {
  it('accepts a text-only edit that leaves attachments untouched', () => {
    const result = UpdateQueuedMessageRequestSchema.safeParse({ text: 'edited' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.attachments).toBeUndefined();
  });

  it('accepts a shorter attachment list', () => {
    const result = UpdateQueuedMessageRequestSchema.safeParse({
      text: 'see attached',
      attachments: [FILE_ATTACHMENT],
    });
    expect(result.success).toBe(true);
  });

  it('accepts clearing the attachments of a message that still has text', () => {
    const result = UpdateQueuedMessageRequestSchema.safeParse({ text: 'keep me', attachments: [] });
    expect(result.success).toBe(true);
  });

  it('accepts dropping the text of a message that still has attachments', () => {
    const result = UpdateQueuedMessageRequestSchema.safeParse({
      text: '',
      attachments: [FILE_ATTACHMENT],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an edit that would leave neither text nor attachments', () => {
    expect(UpdateQueuedMessageRequestSchema.safeParse({ text: '' }).success).toBe(false);
    expect(UpdateQueuedMessageRequestSchema.safeParse({ text: '', attachments: [] }).success).toBe(
      false,
    );
  });
});
