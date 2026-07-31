import { describe, it, expect } from 'vitest';
import { parseFileEnvelopes, formatFileEnvelope } from './attachment-envelope.js';

describe('parseFileEnvelopes', () => {
  it('extracts a single envelope and trims the surrounding prose', () => {
    const text = `Look at this\n${formatFileEnvelope('a.ts', 'text/x-typescript', 'export const x = 1;')}`;
    expect(parseFileEnvelopes(text)).toEqual({
      cleanedText: 'Look at this',
      files: [{ name: 'a.ts', mimeType: 'text/x-typescript', content: 'export const x = 1;' }],
    });
  });

  it('extracts multiple envelopes left to right', () => {
    const a = formatFileEnvelope('a.txt', 'text/plain', 'AAA');
    const b = formatFileEnvelope('b.txt', 'text/plain', 'BBB');
    const result = parseFileEnvelopes(`${a}\nmiddle\n${b}`);
    expect(result.files).toEqual([
      { name: 'a.txt', mimeType: 'text/plain', content: 'AAA' },
      { name: 'b.txt', mimeType: 'text/plain', content: 'BBB' },
    ]);
    expect(result.cleanedText).toBe('middle');
  });

  it('does not let a stray end marker for another name terminate content early', () => {
    const content = 'line 1\n[End of file: other.txt]\nline 2';
    const result = parseFileEnvelopes(formatFileEnvelope('a.txt', 'text/plain', content));
    expect(result.files).toEqual([{ name: 'a.txt', mimeType: 'text/plain', content }]);
  });

  it('handles an empty-content envelope', () => {
    const result = parseFileEnvelopes(formatFileEnvelope('empty.txt', 'text/plain', ''));
    expect(result.files).toEqual([{ name: 'empty.txt', mimeType: 'text/plain', content: '' }]);
  });

  it('finds a real envelope nested after a fake open marker on the same line', () => {
    const text = `${'[File: '}${formatFileEnvelope('a', 'text/plain', 'body')}`;
    expect(parseFileEnvelopes(text).files).toEqual([
      { name: 'a', mimeType: 'text/plain', content: 'body' },
    ]);
  });

  it('returns the text unchanged when there is no envelope', () => {
    expect(parseFileEnvelopes('just some prose')).toEqual({
      cleanedText: 'just some prose',
      files: [],
    });
  });

  it('leaves an open marker with no closing marker in place', () => {
    const text = 'before [File: a.txt (text/plain)]\ncontent with no end';
    expect(parseFileEnvelopes(text)).toEqual({ cleanedText: text, files: [] });
  });

  it('ignores a header that does not end in ")]"', () => {
    const text = '[File: a (text/plain) extra]\nbody\n[End of file: a]';
    expect(parseFileEnvelopes(text).files).toEqual([]);
  });

  // The following inputs are catastrophic for a backtracking regex but linear
  // for the indexOf scanner. They assert correctness; completing at all (no
  // suite timeout) is itself the ReDoS guard.
  describe('is linear on adversarial input', () => {
    it('many bare open markers with no closing marker', () => {
      const evil = '[File: '.repeat(200_000);
      expect(parseFileEnvelopes(evil)).toEqual({ cleanedText: evil, files: [] });
    });

    it('open markers with newlines but no "("', () => {
      const evil = '[File: \n'.repeat(200_000);
      expect(parseFileEnvelopes(evil)).toEqual({ cleanedText: evil, files: [] });
    });

    it('many well-formed headers but no closing marker', () => {
      const evil = '[File: a (t)]\n'.repeat(200_000);
      expect(parseFileEnvelopes(evil)).toEqual({ cleanedText: evil, files: [] });
    });

    it('a large run of complete envelopes', () => {
      const many = Array.from({ length: 50_000 }, () =>
        formatFileEnvelope('a', 'text/plain', 'x'),
      ).join('\n');
      expect(parseFileEnvelopes(many).files).toHaveLength(50_000);
    });
  });
});
