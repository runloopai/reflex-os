import { describe, it, expect } from 'vitest';
import {
  IMAGE_EXTENSIONS,
  TEXT_EXTENSIONS,
  SNIFF_BYTES,
  classifyAttachmentBytes,
  getExtension,
  isImageByMime,
  isKnownTextMime,
  isPdfByMime,
  sniffIsTextBytes,
} from './attachment-classifier.js';

const enc = new TextEncoder();
const empty = new Uint8Array(0);

describe('SNIFF_BYTES', () => {
  it('is the 8 KB window the sniffer inspects', () => {
    expect(SNIFF_BYTES).toBe(8192);
  });
});

describe('extension sets', () => {
  it('includes the canonical image extensions', () => {
    expect(IMAGE_EXTENSIONS.has('.png')).toBe(true);
    expect(IMAGE_EXTENSIONS.has('.jpg')).toBe(true);
    expect(IMAGE_EXTENSIONS.has('.webp')).toBe(true);
    expect(IMAGE_EXTENSIONS.has('.svg')).toBe(false);
  });

  it('includes the canonical text extensions', () => {
    expect(TEXT_EXTENSIONS.has('.md')).toBe(true);
    expect(TEXT_EXTENSIONS.has('.ts')).toBe(true);
    expect(TEXT_EXTENSIONS.has('.json')).toBe(true);
    expect(TEXT_EXTENSIONS.has('.svg')).toBe(true);
  });
});

describe('getExtension', () => {
  it('returns the lower-cased extension with leading dot', () => {
    expect(getExtension('foo.PNG')).toBe('.png');
    expect(getExtension('a/b/c.tar.gz')).toBe('.gz');
    expect(getExtension('Dockerfile')).toBe('');
    expect(getExtension('.env')).toBe('');
    expect(getExtension('bare')).toBe('');
  });

  it('handles backslash separators', () => {
    expect(getExtension('C:\\users\\me\\file.TXT')).toBe('.txt');
  });
});

describe('mime helpers', () => {
  it('isImageByMime', () => {
    expect(isImageByMime('image/png')).toBe(true);
    expect(isImageByMime('image/svg+xml')).toBe(false);
    expect(isImageByMime('text/plain')).toBe(false);
    expect(isImageByMime('')).toBe(false);
  });

  it('isPdfByMime', () => {
    expect(isPdfByMime('application/pdf')).toBe(true);
    expect(isPdfByMime('application/x-pdf')).toBe(false);
  });

  it('isKnownTextMime', () => {
    expect(isKnownTextMime('text/plain')).toBe(true);
    expect(isKnownTextMime('text/markdown')).toBe(true);
    expect(isKnownTextMime('application/json')).toBe(true);
    expect(isKnownTextMime('application/xml')).toBe(true);
    expect(isKnownTextMime('image/svg+xml')).toBe(true);
    expect(isKnownTextMime('application/octet-stream')).toBe(false);
    expect(isKnownTextMime('')).toBe(false);
  });
});

describe('sniffIsTextBytes', () => {
  it('treats ASCII text as text', () => {
    expect(sniffIsTextBytes(enc.encode('hello world\nthis is a patch'))).toBe(true);
  });

  it('treats UTF-8 multi-byte chars as text', () => {
    expect(sniffIsTextBytes(enc.encode('héllo — 你好 🚀'))).toBe(true);
  });

  it('rejects buffers containing NUL bytes', () => {
    const bytes = new Uint8Array([0x68, 0x69, 0x00, 0x21]);
    expect(sniffIsTextBytes(bytes)).toBe(false);
  });

  it('rejects invalid UTF-8 sequences', () => {
    // 0xC3 starts a 2-byte sequence; 0x28 is not a valid continuation byte.
    const bytes = new Uint8Array([0xc3, 0x28, 0x41, 0x42]);
    expect(sniffIsTextBytes(bytes)).toBe(false);
  });

  it('treats an empty buffer as text (nothing to disqualify)', () => {
    expect(sniffIsTextBytes(empty)).toBe(true);
  });
});

describe('classifyAttachmentBytes', () => {
  it('classifies image MIME as image', () => {
    const result = classifyAttachmentBytes({
      name: 'photo.png',
      mimeType: 'image/png',
      head: empty,
    });
    expect(result).toEqual({ kind: 'image', mimeType: 'image/png' });
  });

  it('falls back to image extension when MIME is empty', () => {
    const result = classifyAttachmentBytes({
      name: 'photo.JPG',
      mimeType: '',
      head: empty,
    });
    expect(result).toEqual({ kind: 'image', mimeType: 'image/jpeg' });
  });

  it('classifies application/pdf MIME as pdf', () => {
    const result = classifyAttachmentBytes({
      name: 'report.pdf',
      mimeType: 'application/pdf',
      head: empty,
    });
    expect(result).toEqual({ kind: 'pdf', mimeType: 'application/pdf' });
  });

  it('falls back to .pdf extension when MIME is empty', () => {
    const result = classifyAttachmentBytes({
      name: 'no-mime.pdf',
      mimeType: '',
      head: empty,
    });
    expect(result).toEqual({ kind: 'pdf', mimeType: 'application/pdf' });
  });

  it('preserves a known text MIME without sniffing', () => {
    const result = classifyAttachmentBytes({
      name: 'note.md',
      mimeType: 'text/markdown',
      head: enc.encode('# hi'),
    });
    expect(result).toEqual({ kind: 'text', mimeType: 'text/markdown' });
  });

  it('uses the text-extension fast path with empty MIME', () => {
    const result = classifyAttachmentBytes({
      name: 'app.ts',
      mimeType: '',
      head: enc.encode('export const x = 1;'),
    });
    expect(result).toEqual({ kind: 'text', mimeType: 'text/plain' });
  });

  it('classifies SVG as text rather than an image content block', () => {
    const result = classifyAttachmentBytes({
      name: 'diagram.svg',
      mimeType: 'image/svg+xml',
      head: enc.encode('<svg />'),
    });
    expect(result).toEqual({ kind: 'text', mimeType: 'image/svg+xml' });
  });

  it('classifies .patch via the sniff path with normalized MIME', () => {
    const patch = `--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-const x = 1;\n+const x = 2;\n`;
    const result = classifyAttachmentBytes({
      name: 'fix.patch',
      mimeType: '',
      head: enc.encode(patch),
    });
    expect(result).toEqual({ kind: 'text', mimeType: 'text/plain' });
  });

  it('classifies Dockerfile (no extension) via sniffing', () => {
    const result = classifyAttachmentBytes({
      name: 'Dockerfile',
      mimeType: '',
      head: enc.encode('FROM node:20\nWORKDIR /app\n'),
    });
    expect(result).toEqual({ kind: 'text', mimeType: 'text/plain' });
  });

  it('rejects bytes containing a NUL as binary', () => {
    // PNG magic header — has a NUL within the first few bytes.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
    const result = classifyAttachmentBytes({
      name: 'mystery',
      mimeType: '',
      head: png,
    });
    expect(result).toEqual({ kind: 'rejected', reason: 'binary' });
  });

  it('rejects bytes that are not valid UTF-8', () => {
    const result = classifyAttachmentBytes({
      name: 'noext',
      mimeType: '',
      head: new Uint8Array([0xc3, 0x28, 0x41]),
    });
    expect(result).toEqual({ kind: 'rejected', reason: 'invalid-utf8' });
  });

  it('rejects empty unknown files as unknown', () => {
    const result = classifyAttachmentBytes({
      name: 'mystery',
      mimeType: '',
      head: empty,
    });
    expect(result).toEqual({ kind: 'rejected', reason: 'unknown' });
  });
});
