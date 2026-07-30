import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildContentBlocks, MAX_ATTACHMENTS_COUNT, type Attachment } from '@reflex/shared';
import {
  assertAttachmentLimits,
  attachmentFromBytes,
  extractPastedPath,
  loadAttachment,
} from '../attachments.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'reflex-cli-att-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Smallest valid PNG header — enough for extension/mime classification.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('loadAttachment', () => {
  it('loads a text file as a file attachment with base64 data', async () => {
    const filePath = path.join(dir, 'notes.md');
    writeFileSync(filePath, '# hello\n');
    const attachment = await loadAttachment(filePath);
    expect(attachment.type).toBe('file');
    expect(attachment.name).toBe('notes.md');
    expect(Buffer.from(attachment.data!, 'base64').toString()).toBe('# hello\n');
    // The same attachment feeds the shared content-block builder unchanged.
    const blocks = buildContentBlocks('see file', [attachment]);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ type: 'file', name: 'notes.md' });
  });

  it('classifies images as image attachments', async () => {
    const filePath = path.join(dir, 'pixel.png');
    writeFileSync(filePath, PNG_BYTES);
    const attachment = await loadAttachment(filePath);
    expect(attachment.type).toBe('image');
    expect(attachment.mimeType).toBe('image/png');
  });

  it('rejects directories and missing files', async () => {
    await expect(loadAttachment(dir)).rejects.toThrow(/Not a file/);
    await expect(loadAttachment(path.join(dir, 'missing.txt'))).rejects.toThrow(/Not a file/);
  });
});

describe('assertAttachmentLimits', () => {
  const att = (size: number): Attachment => ({
    id: `a${size}`,
    type: 'file',
    name: 'x.txt',
    size,
  });

  it('enforces the shared per-message count cap', () => {
    const existing = Array.from({ length: MAX_ATTACHMENTS_COUNT }, () => att(1));
    expect(() => assertAttachmentLimits(existing, att(1))).toThrow(/At most/);
  });

  it('enforces the shared combined-size cap', () => {
    expect(() => assertAttachmentLimits([att(2_000_000)], att(2_000_000))).toThrow(
      /combined limit/,
    );
    expect(() => assertAttachmentLimits([att(100)], att(100))).not.toThrow();
  });
});

describe('attachmentFromBytes', () => {
  it('classifies clipboard PNG bytes as an image attachment', () => {
    const attachment = attachmentFromBytes('pasted-image-1.png', PNG_BYTES);
    expect(attachment).toMatchObject({
      type: 'image',
      name: 'pasted-image-1.png',
      mimeType: 'image/png',
      size: PNG_BYTES.byteLength,
    });
    expect(Buffer.from(attachment.data!, 'base64').equals(PNG_BYTES)).toBe(true);
  });
});

describe('extractPastedPath', () => {
  const exists = (candidate: string) => candidate === '/tmp/shot 1.png';

  it('resolves plain, quoted, and backslash-escaped drag-drop paths', () => {
    expect(extractPastedPath('/tmp/shot 1.png', exists)).toBe('/tmp/shot 1.png');
    expect(extractPastedPath("'/tmp/shot 1.png'", exists)).toBe('/tmp/shot 1.png');
    expect(extractPastedPath('"/tmp/shot 1.png"', exists)).toBe('/tmp/shot 1.png');
    expect(extractPastedPath('/tmp/shot\\ 1.png ', exists)).toBe('/tmp/shot 1.png');
  });

  it('expands ~ against the home directory', () => {
    expect(
      extractPastedPath(
        '~/shot 1.png',
        (c) => c === '/home/me/shot 1.png',
        () => '/home/me',
      ),
    ).toBe('/home/me/shot 1.png');
  });

  it('rejects prose, multiline pastes, missing files, and bare words', () => {
    expect(extractPastedPath('just some pasted text', exists)).toBeNull();
    expect(extractPastedPath('/tmp/shot 1.png\n/tmp/other.png', exists)).toBeNull();
    expect(extractPastedPath('/tmp/nope.png', exists)).toBeNull();
    // A bare word never counts as a path even if a matching file exists.
    expect(extractPastedPath('readme', () => true)).toBeNull();
  });
});
