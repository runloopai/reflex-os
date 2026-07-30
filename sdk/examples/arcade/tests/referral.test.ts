/**
 * First-touch attribution: the shared link a visitor arrived through has
 * to survive the several pages they browse before they pick a name, or the
 * join that finally happens is credited to nobody.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arrivalSource, captureSource } from '../web/src/lib/referral.ts';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('window', { sessionStorage: fakeStorage(), location: { search: '' } });
});

afterEach(() => vi.unstubAllGlobals());

describe('captureSource', () => {
  it('remembers the source a shared link arrived with', () => {
    captureSource('?utm_source=x&utm_medium=social');
    expect(arrivalSource()).toBe('x');
  });

  it('keeps the FIRST source, so a later click cannot steal the credit', () => {
    captureSource('?utm_source=bluesky');
    captureSource('?utm_source=x');
    expect(arrivalSource()).toBe('bluesky');
  });

  it('reports nothing for a direct visit', () => {
    captureSource('?panel=chat');
    expect(arrivalSource()).toBeNull();
  });

  it('refuses a crafted source rather than storing it', () => {
    // The value reaches the database, so only the shape our own links emit
    // is accepted — no punctuation, no markup, no unbounded length.
    captureSource('?utm_source=<script>alert(1)</script>');
    expect(arrivalSource()).toBeNull();
    captureSource(`?utm_source=${'x'.repeat(64)}`);
    expect(arrivalSource()).toBeNull();
  });

  it('normalises case, so X and x are one source', () => {
    captureSource('?utm_source=BlueSky');
    expect(arrivalSource()).toBe('bluesky');
  });

  it('survives storage being blocked', () => {
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('blocked');
      },
      location: { search: '' },
    });
    expect(() => captureSource('?utm_source=x')).not.toThrow();
    expect(arrivalSource()).toBeNull();
  });
});
