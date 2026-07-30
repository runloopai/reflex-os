import { describe, expect, it } from 'vitest';
import { parseOsascriptPngHex } from '../clipboard.js';

describe('parseOsascriptPngHex', () => {
  it('decodes the AppleScript «data PNGf…» literal to bytes', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const stdout = `«data PNGf${png.toString('hex').toUpperCase()}»\n`;
    expect(parseOsascriptPngHex(stdout)?.equals(png)).toBe(true);
  });

  it('returns null for non-image clipboard output', () => {
    expect(parseOsascriptPngHex('')).toBeNull();
    expect(parseOsascriptPngHex('some text on the clipboard')).toBeNull();
    expect(parseOsascriptPngHex('«data PNGf»')).toBeNull();
  });
});
